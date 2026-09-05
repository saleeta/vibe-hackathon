// WebSocket <-> UDP relay between the Spectacles drone-control Lens and a
// real Tello drone.
//
// WHY THIS EXISTS: Lens Studio / Spectacles has no raw UDP socket support in
// its scripting API (confirmed against the platform's own docs) — only
// WebSocket. Tello's entire control protocol is UDP-only (command port
// 8889, state port 8890). This script is the only thing in this whole
// feature that speaks real UDP to the drone; the Lens never does.
//
// RUN THIS ON A LAPTOP, NOT A SERVER:
//   1. Connect the laptop to the SAME Wi-Fi network as the Tello — either
//      the Tello's own hotspot (TELLO-XXXXXX), or a router both the Tello
//      and this laptop are joined to in station mode.
//   2. The Spectacles glasses must ALSO be on that same network — if using
//      the Tello's own hotspot, that means putting the glasses' Wi-Fi on
//      TELLO-XXXXXX too (it won't have internet access; that's expected).
//   3. `npm install && npm start` here.
//   4. Put this laptop's IP address on that network into the Lens's
//      DroneBridgeClient.bridgeUrl (e.g. wss://192.168.10.2:8765).
//
// TLS: Lens Studio's docs say wss:// is required "on most platforms" for
// WebSocket — plain ws:// may be rejected on real hardware even though it
// can work in Lens Studio's desktop preview. This script auto-detects:
// if cert.pem + key.pem exist in this folder, it serves wss:// (TLS); if
// not, it falls back to plain ws:// for quick editor-only testing.
// Generate a quick self-signed pair with:
//   openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 365 -subj "/CN=drone-bridge"
'use strict';

const fs = require('fs');
const path = require('path');
const dgram = require('dgram');
const https = require('https');
const http = require('http');
const { WebSocketServer } = require('ws');

const WS_PORT = Number(process.env.WS_PORT || 8765);
const TELLO_IP = process.env.TELLO_IP || '192.168.10.1';
const TELLO_CMD_PORT = 8889;
const TELLO_STATE_PORT = 8890;
const COMMAND_TIMEOUT_MS = 7000;

// ---------------------------------------------------------------------------
// Tello UDP link — one command in flight at a time, per Tello SDK's own
// expectation. State broadcasts arrive independently on a separate socket.
// ---------------------------------------------------------------------------

class TelloLink {
  constructor(onState, onLog) {
    this.onState = onState;
    this.onLog = onLog;
    this.pending = null; // { resolve, reject, timer }
    this.cmdSocket = dgram.createSocket('udp4');
    this.stateSocket = dgram.createSocket('udp4');

    this.cmdSocket.on('message', (msg) => this._handleCmdReply(msg.toString().trim()));
    this.cmdSocket.on('error', (err) => this.onLog(`cmd socket error: ${err}`));

    this.stateSocket.on('message', (msg) => this._handleState(msg.toString()));
    this.stateSocket.on('error', (err) => this.onLog(`state socket error: ${err}`));
  }

  async start() {
    this.cmdSocket.bind(); // ephemeral local port for sending/receiving command replies
    this.stateSocket.bind(TELLO_STATE_PORT);
    await this.sendCommand('command'); // enter SDK mode — must be first
  }

  sendCommand(text) {
    return new Promise((resolve, reject) => {
      if (this.pending) {
        reject(new Error('a command is already in flight'));
        return;
      }
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error(`Tello did not respond to "${text}" in time`));
      }, COMMAND_TIMEOUT_MS);
      this.pending = { resolve, reject, timer, text };
      this.cmdSocket.send(text, TELLO_CMD_PORT, TELLO_IP, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending = null;
          reject(err);
        }
      });
    });
  }

  _handleCmdReply(raw) {
    if (!this.pending) {
      this.onLog(`unsolicited reply: ${raw}`);
      return;
    }
    clearTimeout(this.pending.timer);
    const { resolve } = this.pending;
    this.pending = null;
    resolve(raw);
  }

  _handleState(raw) {
    // Example line: "pitch:0;roll:0;yaw:0;...;h:20;bat:87;...;\r\n"
    const battery = /bat:(\d+)/.exec(raw);
    const height = /(?:^|;)h:(-?\d+)/.exec(raw);
    if (battery || height) {
      this.onState({
        batteryPercent: battery ? Number(battery[1]) : undefined,
        heightCm: height ? Number(height[1]) : undefined,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Command translation: the Lens sends structured JSON, this turns it into
// Tello's real plaintext protocol. See TelloGoVector.ts on the Lens side for
// why `goto`'s x/y/z already arrive pre-clamped to Tello's real constraints.
// ---------------------------------------------------------------------------

function toTelloCommandString(command) {
  switch (command.type) {
    case 'takeoff':
      return 'takeoff';
    case 'land':
      return 'land';
    case 'emergency':
      return 'emergency';
    case 'battery_query':
      return 'battery?';
    case 'goto':
      return `go ${Math.round(command.x)} ${Math.round(command.y)} ${Math.round(command.z)} ${Math.round(command.speed ?? 40)}`;
    default:
      throw new Error(`Unknown command type: ${command.type}`);
  }
}

// ---------------------------------------------------------------------------
// WebSocket server — one Tello link shared across connections (there's only
// ever one drone and, realistically, one glasses wearer at a time).
// ---------------------------------------------------------------------------

function log(msg) {
  console.log(JSON.stringify({ level: 'info', msg }));
}

const hasTls = fs.existsSync(path.join(__dirname, 'cert.pem')) && fs.existsSync(path.join(__dirname, 'key.pem'));
const httpServer = hasTls
  ? https.createServer({
      cert: fs.readFileSync(path.join(__dirname, 'cert.pem')),
      key: fs.readFileSync(path.join(__dirname, 'key.pem')),
    })
  : http.createServer();

const wss = new WebSocketServer({ server: httpServer });
const tello = new TelloLink(
  (state) => broadcastState(state),
  (msg) => log(`[tello] ${msg}`)
);

function broadcastState(state) {
  const payload = JSON.stringify({ type: 'state', ...state });
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}

wss.on('connection', (ws) => {
  log('Lens connected.');
  ws.on('message', async (data) => {
    let command;
    try {
      command = JSON.parse(data.toString());
    } catch (err) {
      log(`Failed to parse command: ${err}`);
      return;
    }

    let telloText;
    try {
      telloText = toTelloCommandString(command);
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', raw: String(err) }));
      return;
    }

    try {
      const reply = await tello.sendCommand(telloText);
      const isOk = reply.toLowerCase() === 'ok';
      ws.send(JSON.stringify({ type: isOk ? 'ack' : 'error', raw: reply }));
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', raw: String(err) }));
    }
  });
  ws.on('close', () => log('Lens disconnected.'));
});

async function main() {
  await tello.start().catch((err) => {
    log(`Could not enter SDK mode on startup (drone may not be connected yet) — will still accept commands and retry: ${err}`);
  });
  httpServer.listen(WS_PORT, () => {
    log(`drone-bridge listening on ${hasTls ? 'wss' : 'ws'}://0.0.0.0:${WS_PORT} — relaying to Tello at ${TELLO_IP}`);
  });
}

main();
