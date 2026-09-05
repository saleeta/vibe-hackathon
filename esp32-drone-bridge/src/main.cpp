/**
 * ESP32-S3 <-> Tello UDP bridge, BLE GATT peripheral side.
 *
 * Same job as drone-bridge/server.js (relay a text command to the Tello's
 * real UDP SDK 2.0 protocol, relay the reply back), but reachable over BLE
 * instead of WebSocket/WiFi-from-the-central's-side. WiFi is used ONLY to
 * reach the Tello (station mode, joining the Tello's own hotspot) — BLE and
 * WiFi run concurrently on the same radio via the ESP32-S3's standard
 * WiFi/BLE coexistence, no special handling needed for that here.
 *
 * Phase 1 (this file, right now): tested from a PC running a Python
 * (bleak) BLE-central script — proves the ESP32 firmware itself works
 * before touching Spectacles at all.
 * Phase 2 (later, separate work): the exact same GATT service/
 * characteristics, driven instead by a Spectacles Lens via
 * BluetoothCentralModule (startScan -> connectGatt -> getCharacteristic ->
 * writeValue/registerNotifications) — confirmed to be a generic BLE-central
 * API, not gated behind Snap's separate Spectacles Mobile Kit SDK.
 *
 * GATT protocol (custom, both ends written by us — no dependency on any
 * third-party device profile):
 *   Service:                 12345678-1234-5678-1234-56789abc0000
 *     Command characteristic (WRITE):   12345678-1234-5678-1234-56789abc0001
 *       Central writes the exact same plaintext Tello SDK 2.0 command
 *       string drone-bridge/server.js's toTelloCommandString() would have
 *       produced (e.g. "takeoff", "land", "go 0 50 0 40", "battery?").
 *     Response characteristic (NOTIFY): 12345678-1234-5678-1234-56789abc0002
 *       This device writes the Tello's raw reply ("ok", "87", or an error)
 *       here and notifies once a command finishes (or times out).
 *
 * TODO(verify once on real Spectacles hardware): BluetoothCentralModule's
 * writeValue() takes a Uint8Array, not a JS string directly — the Phase 2
 * Lens script will need to UTF-8-encode/decode explicitly. Not a concern
 * for Phase 1's Python test client (bleak handles bytes natively).
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <NimBLEDevice.h>

// This is the Tello unit's actual SSID, confirmed stable across many
// power-cycles during today's testing session (not randomized per boot).
// Open network, no password.
static const char* TELLO_SSID = "TELLO-E91C60";
static const char* TELLO_PASSWORD = "";
static const IPAddress TELLO_IP(192, 168, 10, 1);
static const uint16_t TELLO_CMD_PORT = 8889;
static const uint16_t LOCAL_UDP_PORT = 9100;
static const uint32_t TELLO_REPLY_TIMEOUT_MS = 7000;

static const char* SERVICE_UUID = "12345678-1234-5678-1234-56789abc0000";
static const char* COMMAND_CHAR_UUID = "12345678-1234-5678-1234-56789abc0001";
static const char* RESPONSE_CHAR_UUID = "12345678-1234-5678-1234-56789abc0002";

WiFiUDP telloUdp;
NimBLECharacteristic* responseCharacteristic = nullptr;

// Guards telloUdp: the periodic keepalive (Arduino main task, loop()) and a
// BLE-triggered command (NimBLE host task, via onWrite()) can both call
// sendTelloCommand() from different FreeRTOS tasks. WiFiUDP isn't
// thread-safe -- two overlapping send/receive calls on the same socket can
// corrupt or steal each other's packets. Real, reproduced bug (not just a
// theoretical risk): a 'takeoff' sent right after a successful 'battery?'
// silently never reached the drone at all -- consistent with the keepalive
// firing at the same moment and the two calls interfering.
static SemaphoreHandle_t udpMutex = nullptr;

/** Sends one command to the Tello over UDP and blocks (up to TELLO_REPLY_TIMEOUT_MS) for its reply. */
String sendTelloCommand(const String& command) {
  xSemaphoreTake(udpMutex, portMAX_DELAY);

  // Drain anything stale left over from a previous exchange before sending.
  while (telloUdp.parsePacket() > 0) {
    uint8_t discard[64];
    telloUdp.read(discard, sizeof(discard));
  }

  telloUdp.beginPacket(TELLO_IP, TELLO_CMD_PORT);
  telloUdp.write((const uint8_t*)command.c_str(), command.length());
  telloUdp.endPacket();
  Serial.printf("[Tello] Sent: %s\n", command.c_str());

  String result = "error: timeout";
  const uint32_t start = millis();
  while (millis() - start < TELLO_REPLY_TIMEOUT_MS) {
    const int packetSize = telloUdp.parsePacket();
    if (packetSize > 0) {
      char buf[256] = {0};
      const int len = telloUdp.read(buf, sizeof(buf) - 1);
      String reply(buf, len > 0 ? len : 0);
      reply.trim();
      Serial.printf("[Tello] Reply: %s\n", reply.c_str());
      result = reply;
      break;
    }
    delay(10);
  }
  if (result == "error: timeout") {
    Serial.println("[Tello] Timed out waiting for reply.");
  }

  xSemaphoreGive(udpMutex);
  return result;
}

/**
 * Keepalive-only entry point: skips this cycle entirely (non-blocking) if
 * a real BLE-triggered command already holds the lock, instead of ever
 * making a real gesture command wait behind a keepalive's up-to-7s
 * timeout. Safe either way -- sendTelloCommand() itself still fully
 * serializes via the same mutex -- this is purely a responsiveness
 * optimization, not what prevents corruption.
 */
void sendKeepaliveIfIdle() {
  if (xSemaphoreTake(udpMutex, 0) != pdTRUE) {
    Serial.println("[Tello] Keepalive skipped — a real command is in flight.");
    return;
  }
  xSemaphoreGive(udpMutex);
  sendTelloCommand("command");
}

class CommandCallbacks : public NimBLECharacteristicCallbacks {
  // NimBLE-Arduino 1.4.x's callback signature (verified against the
  // installed library header — differs from 2.x's NimBLEConnInfo&).
  void onWrite(NimBLECharacteristic* characteristic) override {
    String command = String(characteristic->getValue().c_str());
    command.trim();
    if (command.length() == 0) return;

    Serial.printf("[BLE] Command received (%d bytes): %s\n", command.length(), command.c_str());
    const String reply = sendTelloCommand(command);

    if (responseCharacteristic != nullptr) {
      Serial.printf("[BLE] Setting response (%d bytes): %s\n", reply.length(), reply.c_str());
      responseCharacteristic->setValue((uint8_t*)reply.c_str(), reply.length());
      responseCharacteristic->notify();
      Serial.println("[BLE] notify() called.");
    }
  }
};

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n[ESP32] Starting drone-bridge (BLE <-> Tello UDP)...");

  udpMutex = xSemaphoreCreateMutex();

  // --- WiFi: join the Tello's own hotspot ---
  WiFi.mode(WIFI_STA);
  WiFi.begin(TELLO_SSID, TELLO_PASSWORD);
  Serial.printf("[WiFi] Connecting to %s", TELLO_SSID);
  uint32_t wifiStart = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - wifiStart < 20000) {
    delay(500);
    Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WiFi] Connected. IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\n[WiFi] Failed to connect within 20s — will keep BLE up regardless, retry WiFi in loop().");
  }
  telloUdp.begin(LOCAL_UDP_PORT);

  // Enter Tello SDK mode once at startup, same as drone-bridge/server.js's TelloLink.start().
  if (WiFi.status() == WL_CONNECTED) {
    sendTelloCommand("command");
  }

  // --- BLE: advertise the GATT peripheral this device implements ---
  NimBLEDevice::init("ESP32-Drone-Bridge");
  NimBLEServer* server = NimBLEDevice::createServer();
  NimBLEService* service = server->createService(SERVICE_UUID);

  NimBLECharacteristic* commandCharacteristic = service->createCharacteristic(
    COMMAND_CHAR_UUID,
    NIMBLE_PROPERTY::WRITE
  );
  commandCharacteristic->setCallbacks(new CommandCallbacks());

  responseCharacteristic = service->createCharacteristic(
    RESPONSE_CHAR_UUID,
    NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY
  );
  responseCharacteristic->setValue((uint8_t*)"ready", 5);

  service->start();

  NimBLEAdvertising* advertising = NimBLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->start();

  Serial.println("[BLE] Advertising as 'ESP32-Drone-Bridge'.");
}

void loop() {
  // Keep the Tello SDK session alive the same way drone-bridge/server.js
  // does — a real, confirmed 15s inactivity timeout on this exact drone
  // firmware (see drone-bridge/server.js's KEEPALIVE_INTERVAL_MS comment;
  // 'keepalive' itself is rejected by this firmware, plain 'command' works).
  static uint32_t lastKeepaliveMs = 0;
  const uint32_t now = millis();
  if (WiFi.status() == WL_CONNECTED && now - lastKeepaliveMs > 5000) {
    lastKeepaliveMs = now;
    sendKeepaliveIfIdle();
  } else if (WiFi.status() != WL_CONNECTED && now - lastKeepaliveMs > 5000) {
    lastKeepaliveMs = now;
    Serial.println("[WiFi] Not connected — retrying...");
    WiFi.begin(TELLO_SSID, TELLO_PASSWORD);
  }
  delay(50);
}
