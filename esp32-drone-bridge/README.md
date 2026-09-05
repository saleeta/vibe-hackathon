# ESP32-S3 <-> Tello Bridge (BLE side)

An alternative to `drone-bridge/` (the Node.js WebSocket relay): same job
(speak the Tello's real UDP SDK 2.0 protocol on its behalf, since neither
a laptop's browser sandbox nor — critically — Spectacles itself can open a
raw UDP socket), but reachable over **Bluetooth LE** instead of WebSocket,
using dedicated ESP32-S3 hardware instead of a laptop.

## Why this exists

Spectacles/Lens Studio's scripting sandbox has no raw UDP socket support —
confirmed, and true regardless of which protocol the Lens speaks (HTTP or
WebSocket). Some external device with real OS-level socket access is
mandatory. `drone-bridge/` solves this with a laptop; this folder is the
same idea with dedicated hardware instead, using Lens Studio's
`BluetoothCentralModule` — confirmed to be a **generic BLE-central API**
(`startScan`/`connectGatt`/`getCharacteristic`/`writeValue`/
`registerNotifications`), not gated behind Snap's separate, SDK-only
Spectacles Mobile Kit — so a Lens can talk to a custom BLE peripheral we
fully control both ends of.

```
Lens (BluetoothCentralModule) <--BLE--> ESP32-S3 (this firmware) <--WiFi/UDP--> Tello
```

The ESP32-S3's WiFi and BLE radios coexist on the same chip (standard
Espressif time-slicing, not experimental) — this device is simultaneously
a WiFi *station* joined to the Tello's own hotspot, and a BLE *peripheral*
advertising a GATT service for a central (a phone, this project's Python
test client, or eventually a Spectacles Lens) to connect to.

## Status — what's actually been verified (2026-09-05)

**Phase 1 (this device + a Python test client standing in for the Lens) —
fully verified on real hardware, including real flight:**
- ESP32-S3 connects to the real Tello's WiFi and speaks its UDP SDK 2.0
  protocol correctly (`command` -> `ok`, `battery?` -> real percentage).
- Full BLE round-trip confirmed via `test_ble_client.py` (a stand-in for
  what a Spectacles Lens will do in Phase 2): write a command to the
  Command characteristic, the ESP32 relays it to the Tello over UDP, the
  reply comes back over BLE via a notification on the Response
  characteristic.
- **Real `takeoff` -> `land` flight cycle executed and visually confirmed**
  end-to-end through this exact path (Python BLE write -> ESP32 -> UDP ->
  Tello actually flew -> UDP reply -> BLE notify -> Python).

**Phase 2 (a real Spectacles Lens using `BluetoothCentralModule` instead
of the Python test client) — NOT yet started.** Everything above proves
the ESP32 firmware and the GATT protocol work; what's left is writing the
Lens-side TypeScript component. Since `BluetoothCentralModule`'s
`writeValue()` takes a `Uint8Array`, that component will need to
UTF-8-encode/decode explicitly (the Python client uses `bleak`, which
handles bytes-vs-string more transparently) — flagged as a TODO(verify)
once Lens Studio's connection is back and this can actually be tested;
BLE does not work in Lens Studio Preview at all, so this can only be
verified on real Spectacles hardware, same as the rest of this project's
hardware-only findings.

## Two real bugs found and fixed while getting Phase 1 working

1. **`NimBLECharacteristic::setValue(reply.c_str())` sent the pointer, not
   the string.** `c_str()` returns a `const char*`; passing it directly
   matched NimBLE's generic templated `setValue(T&)` overload (which
   `memcpy`s `sizeof(T)` bytes — i.e. the 4-byte pointer value itself on
   this 32-bit chip), not the intended string-content overload. Confirmed
   by the exact symptom: every response notification was 4 garbage-looking
   bytes, not the expected text. Fixed by explicitly casting to
   `(uint8_t*, length)` to force the correct overload.
2. **Unsynchronized shared UDP socket across FreeRTOS tasks.** The
   periodic keepalive (`loop()`, Arduino's main task) and a BLE-triggered
   command (`onWrite()`, the NimBLE host stack's own task) both called
   `sendTelloCommand()` against the same `WiFiUDP` object with no locking
   — a real, reproduced bug, not just a theoretical risk: a `takeoff` sent
   moments after a successful `battery?` silently never reached the drone
   at all. Fixed with a mutex around the actual UDP exchange, plus a
   non-blocking `sendKeepaliveIfIdle()` so the keepalive skips itself
   entirely (rather than blocking) whenever a real command might already
   hold the lock — a real gesture/flight command should never have to wait
   behind a keepalive's own up-to-7s timeout.

## GATT protocol (custom — both ends written for this project)

```
Service:                          12345678-1234-5678-1234-56789abc0000
  Command characteristic (WRITE):   12345678-1234-5678-1234-56789abc0001
  Response characteristic (NOTIFY): 12345678-1234-5678-1234-56789abc0002
```

Write the exact plaintext Tello SDK 2.0 command string to the Command
characteristic (`"takeoff"`, `"land"`, `"go 0 50 0 40"`, `"battery?"`,
etc. — the same strings `drone-bridge/server.js`'s `toTelloCommandString()`
already produces for the WebSocket path). Subscribe to the Response
characteristic to receive the Tello's raw reply once the exchange
completes (or `"error: timeout"` after `TELLO_REPLY_TIMEOUT_MS`, currently
7s).

## Build & flash

Requires [PlatformIO](https://platformio.org/) (`pip install platformio`
or the VS Code extension) and the ESP32-S3 connected via USB.

```
cd esp32-drone-bridge
pio run --target upload   # builds and flashes over the board's USB port
```

`platformio.ini`'s `upload_port`/`monitor_port` are hardcoded to `COM17` —
change to match your machine. The `ARDUINO_USB_CDC_ON_BOOT` build flag is
required for `Serial.print()` output to actually reach the USB port on
this board (ESP32-S3's native USB peripheral needs this explicitly —
without it, flashing still works via the ROM bootloader's own USB-CDC
mode, but the *application's* Serial output goes nowhere visible after
boot, which cost real debugging time before being found).

`TELLO_SSID` in `src/main.cpp` is hardcoded to this project's actual Tello
unit's SSID (confirmed stable across many power-cycles this session, not
randomized per boot) — change if using a different drone.

## Testing without Spectacles (Phase 1)

```
pip install bleak
python test_ble_client.py takeoff
python test_ble_client.py land
python test_ble_client.py "battery?"
python test_ble_client.py "go 0 50 0 40"
```

Each run scans for the device, connects, sends one command, prints the
reply, then disconnects — a minimal stand-in for what the real Lens script
will do continuously in Phase 2.
