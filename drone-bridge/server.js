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
//
// VOICE CONTROL (optional, B5): set GROQ_API_KEY in this process's
// environment (never in the Lens, never committed to git — this is the one
// real advantage of interpreting voice server-side rather than on-device)
// to enable natural-language commands. Without it, voice_command messages
// are rejected with a spoken error and gesture control still works fine.
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
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
// Default confirmed working via a live test on real Spectacles hardware —
// llama-3.1-8b-instant returned a 404 from Groq's API despite being listed
// as current in Groq's own docs; llama-3.3-70b-versatile is what actually
// worked (see spectacles-voice-memory's OpenEndedQAClient.ts for the same
// finding). Groq's model catalog changes over time — check
// https://console.groq.com/docs/models if this starts 404ing again.
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

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
// why `goto`'s x/y/z already arrive pre-clamped to Tello's real constraints
// when the command came from a gesture flow (voice-originated commands are
// clamped again below, independently — see clampGoVector in this file).
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
// B5 (voice control): the Lens sends the raw spoken transcript instead of a
// structured command; an LLM call (Groq's OpenAI-compatible API) turns it
// into one of a small, voice-safe set of actions.
//
// `emergency` is deliberately NOT in this grammar — that stays a dedicated
// two-fist gesture (HandCommandController.ts) only. A misheard or
// ambiguously-parsed voice command should never be able to cut the motors
// mid-flight.
// ---------------------------------------------------------------------------

const VOICE_SYSTEM_PROMPT = `You translate a single spoken command for a Tello drone into JSON.
Respond with ONLY a JSON object, no other text, no markdown fences.
Shape: {"type": one of "takeoff"|"land"|"goto"|"battery_query"|"unknown", "x": number, "y": number, "z": number, "speed": number}
Only include x/y/z/speed for "goto". Axis meaning: x = forward(+)/back(-), y = left(+)/right(-), z = up(+)/down(-), all centimeters, magnitude 20-500 or exactly 0. speed is cm/s, 10-100 (use 40 if not stated).
"emergency"/"stop the motors" is NOT a supported type here — respond {"type":"unknown"} for anything like that.
If the command doesn't clearly map to takeoff, land, a relative move, or a battery check, respond {"type":"unknown"}.
Examples:
"take off" -> {"type":"takeoff"}
"land the drone" -> {"type":"land"}
"fly forward one meter" -> {"type":"goto","x":100,"y":0,"z":0,"speed":40}
"go left a bit" -> {"type":"goto","x":0,"y":50,"z":0,"speed":40}
"what's the battery" -> {"type":"battery_query"}
"do a backflip" -> {"type":"unknown"}`;

async function interpretVoiceCommand(text) {
  if (!GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not set on the drone-bridge process — voice control is disabled until it is.');
  }
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_API_KEY}` },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: VOICE_SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
      max_tokens: 80,
      temperature: 0,
    }),
  });
  if (!response.ok) {
    throw new Error(`Groq API returned ${response.status}`);
  }
  const json = await response.json();
  const raw = json?.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new Error('Groq API returned an empty reply');

  // Robust to any stray prose/markdown fences around the JSON, rather than
  // trusting the model followed "respond with ONLY JSON" exactly.
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Could not find JSON in LLM reply: ${raw}`);
  const parsed = JSON.parse(match[0]);

  if (parsed.type === 'goto') {
    const clamped = clampGoVector(Number(parsed.x) || 0, Number(parsed.y) || 0, Number(parsed.z) || 0);
    return { type: 'goto', x: clamped.x, y: clamped.y, z: clamped.z, speed: clampSpeed(parsed.speed) };
  }
  if (parsed.type === 'takeoff' || parsed.type === 'land' || parsed.type === 'battery_query') {
    return { type: parsed.type };
  }
  return { type: 'unknown' };
}

// Mirrors TelloGoVector.ts's clampGoVector on the Lens side. Voice-originated
// commands never pass through that file, so the same real Tello constraint
// (each axis is 0 or |value| >= 20cm, max 500cm) is re-applied here.
function clampGoVector(x, y, z) {
  return { x: clampAxis(x), y: clampAxis(y), z: clampAxis(z) };
}

function clampAxis(value) {
  const capped = Math.max(-500, Math.min(500, value));
  if (Math.abs(capped) < 1) return 0;
  if (Math.abs(capped) < 20) return capped < 0 ? -20 : 20;
  return Math.round(capped);
}

function clampSpeed(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 40;
  return Math.max(10, Math.min(100, Math.round(n)));
}

// Templated server-side, not asked of the LLM directly — avoids a
// hallucinated confirmation ("done!") for an action that hasn't actually
// happened yet. battery_query's spokenText is filled in after the real
// Tello reply instead (see the connection handler below).
function spokenTextFor(resolvedCommand) {
  switch (resolvedCommand.type) {
    case 'takeoff':
      return 'Taking off now.';
    case 'land':
      return 'Landing now.';
    case 'goto':
      return 'Flying now.';
    default:
      return null;
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
    let incoming;
    try {
      incoming = JSON.parse(data.toString());
    } catch (err) {
      log(`Failed to parse message: ${err}`);
      return;
    }

    const isVoice = incoming.type === 'voice_command';
    let command = incoming;
    let spokenText = null;

    if (isVoice) {
      try {
        command = await interpretVoiceCommand(incoming.text);
      } catch (err) {
        log(`Voice interpretation failed: ${err}`);
        ws.send(JSON.stringify({ type: 'error', raw: String(err), spokenText: "Sorry, I couldn't understand that." }));
        return;
      }
      if (command.type === 'unknown') {
        ws.send(JSON.stringify({ type: 'error', raw: 'unrecognized voice command', spokenText: "Sorry, I didn't catch a command in that." }));
        return;
      }
      spokenText = spokenTextFor(command);
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
      // Tello's own reply protocol isn't uniformly "ok"/"error" — battery?
      // replies with a plain number (e.g. "87"), not "ok". This was a
      // latent bug (battery_query was never actually exercised before
      // voice control) — fixed here rather than left in place.
      const isOk = command.type === 'battery_query' ? /^\d+$/.test(reply.trim()) : reply.toLowerCase() === 'ok';

      if (isVoice && command.type === 'battery_query' && isOk) {
        spokenText = `Battery is ${reply} percent.`;
      }

      const payload = { type: isOk ? 'ack' : 'error', raw: reply };
      if (spokenText) payload.spokenText = spokenText;
      ws.send(JSON.stringify(payload));
    } catch (err) {
      const payload = { type: 'error', raw: String(err) };
      if (isVoice) payload.spokenText = "Sorry, the drone didn't respond.";
      ws.send(JSON.stringify(payload));
    }
  });
  ws.on('close', () => log('Lens disconnected.'));
});

async function main() {
  await tello.start().catch((err) => {
    log(`Could not enter SDK mode on startup (drone may not be connected yet) — will still accept commands and retry: ${err}`);
  });
  httpServer.listen(WS_PORT, () => {
    log(`drone-bridge listening on ${hasTls ? 'wss' : 'ws'}://0.0.0.0:${WS_PORT} — relaying to Tello at ${TELLO_IP}${GROQ_API_KEY ? ', voice control enabled' : ', voice control disabled (no GROQ_API_KEY)'}`);
  });
}

main();
