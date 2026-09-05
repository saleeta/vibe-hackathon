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
const { spawn } = require('child_process');
const { WebSocketServer } = require('ws');

const WS_PORT = Number(process.env.WS_PORT || 8765);
const TELLO_IP = process.env.TELLO_IP || '192.168.10.1';
const TELLO_CMD_PORT = 8889;
const TELLO_STATE_PORT = 8890;
const TELLO_VIDEO_PORT = 11111;
const COMMAND_TIMEOUT_MS = Number(process.env.COMMAND_TIMEOUT_MS || 15000);
// The real Tello SDK has a genuine 15s inactivity timeout (confirmed
// against djitellopy's own send_keepalive() doc comment: "prevent the
// drone from landing after 15s") — official control apps stay connected by
// sending SOMETHING at least that often. 5s gives a comfortable margin
// without spamming the shared Tello Wi-Fi link.
//
// NOTE: djitellopy documents a dedicated 'keepalive' command for this, but
// live-tested against real hardware here it came back "unknown command:
// keepalive" — this drone's firmware doesn't support that verb. Re-sending
// plain 'command' instead: it's the one command guaranteed supported by
// every Tello SDK revision (required to enter SDK mode at all) and is
// idempotent to resend once already in SDK mode.
const KEEPALIVE_INTERVAL_MS = 5000;
// Kept low deliberately: this shares the same Tello Wi-Fi link that flight
// commands need low latency on, and it all has to fit through Lens Studio's
// WebSocket as base64 JSON (no raw binary video path on the Lens side).
// 480x360 keeps the Tello's native 4:3 aspect ratio; 5fps/quality 6 is
// enough for a "can I see roughly what the drone sees" HUD picture, not a
// smooth viewfinder — raise these only after confirming real Wi-Fi headroom
// on real hardware, per this project's established measure-first approach.
const VIDEO_FPS = Number(process.env.VIDEO_FPS || 5);
const VIDEO_WIDTH = Number(process.env.VIDEO_WIDTH || 480);
const VIDEO_HEIGHT = Number(process.env.VIDEO_HEIGHT || 360);
const VIDEO_JPEG_QUALITY = Number(process.env.VIDEO_JPEG_QUALITY || 6); // ffmpeg mjpeg scale: 1 (best/largest) - 31 (worst/smallest)
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
    this.keepaliveTimer = null;
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
    // Start the keepalive loop BEFORE awaiting the first 'command' below —
    // if the drone isn't reachable yet (not powered on, still booting,
    // Wi-Fi not joined yet), this loop is what keeps retrying entry into
    // SDK mode every KEEPALIVE_INTERVAL_MS instead of giving up after one
    // failed attempt at startup.
    this._startKeepalive();
    await this.sendCommand('command'); // enter SDK mode — must be first
  }

  // The real Tello SDK auto-lands/times out a session after 15s of no
  // commands at all — this is what real control apps do to hold the
  // connection open through idle periods (between gestures/voice commands,
  // or just while the wearer is standing still), not something specific to
  // testing. Also doubles as the startup retry loop (see start()) for
  // whenever SDK mode hasn't been entered yet — resending 'command' is safe
  // and correct in both cases (see KEEPALIVE_INTERVAL_MS's comment for why
  // it's 'command' and not djitellopy's 'keepalive'). Skips sending if a
  // real command is already in flight rather than competing with it
  // (sendCommand only allows one at a time).
  _startKeepalive() {
    if (this.keepaliveTimer) return;
    this.keepaliveTimer = setInterval(() => {
      if (this.pending) return; // a real command is already in flight — don't compete with it
      this.sendCommand('command').catch((err) => this.onLog(`keepalive failed (non-fatal): ${err}`));
    }, KEEPALIVE_INTERVAL_MS);
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
// Video relay — the Lens has no way to decode raw H.264 (confirmed: Lens
// Studio's scripting API has no video-decode primitive, only Texture from
// already-encoded still-image formats), so ffmpeg does the real decoding
// here and this just re-packages its output as a throttled JPEG sequence
// over the same WebSocket the flight commands use. Requires `ffmpeg` to be
// installed and on PATH on whatever machine runs this bridge — it is NOT an
// npm dependency of this project (avoids bundling a large native binary);
// see the README for install instructions.
//
// Gated behind explicit start()/stop() (driven by 'video_stream_start' /
// 'video_stream_stop' messages from the Lens) rather than always-on, so the
// shared Tello Wi-Fi link isn't spending bandwidth on video the wearer isn't
// currently looking at.
// ---------------------------------------------------------------------------

class VideoRelay {
  constructor(sendTelloCommand, onFrame, onLog) {
    this.sendTelloCommand = sendTelloCommand;
    this.onFrame = onFrame;
    this.onLog = onLog;
    this.ffmpeg = null;
    this.buffer = Buffer.alloc(0);
  }

  get isActive() {
    return this.ffmpeg !== null;
  }

  async start() {
    if (this.isActive) return;

    // Enter video mode on the drone itself first — ffmpeg has nothing to
    // decode until the Tello actually starts pushing H.264 to this port.
    await this.sendTelloCommand('streamon');

    const args = [
      '-f', 'h264',
      '-i', `udp://0.0.0.0:${TELLO_VIDEO_PORT}`,
      '-f', 'mjpeg',
      '-q:v', String(VIDEO_JPEG_QUALITY),
      '-r', String(VIDEO_FPS),
      '-s', `${VIDEO_WIDTH}x${VIDEO_HEIGHT}`,
      '-loglevel', 'error',
      'pipe:1',
    ];

    let proc;
    try {
      proc = spawn('ffmpeg', args);
    } catch (err) {
      throw new Error(`Failed to spawn ffmpeg (is it installed and on PATH?): ${err}`);
    }
    this.ffmpeg = proc;
    this.buffer = Buffer.alloc(0);

    proc.stdout.on('data', (chunk) => this._handleChunk(chunk));
    proc.stderr.on('data', (chunk) => this.onLog(`[ffmpeg] ${chunk.toString().trim()}`));
    proc.on('error', (err) => {
      this.onLog(`ffmpeg process error (is ffmpeg installed and on PATH?): ${err}`);
      this.ffmpeg = null;
    });
    proc.on('exit', (code, signal) => {
      this.onLog(`ffmpeg exited (code=${code}, signal=${signal})`);
      this.ffmpeg = null;
    });
  }

  async stop() {
    if (!this.isActive) return;
    const proc = this.ffmpeg;
    this.ffmpeg = null;
    this.buffer = Buffer.alloc(0);
    proc.kill('SIGKILL');
    // Best-effort — if the drone already disconnected there's nothing to
    // tell it to stop streaming to, and that's fine.
    await this.sendTelloCommand('streamoff').catch((err) => this.onLog(`streamoff failed (non-fatal): ${err}`));
  }

  // ffmpeg's mjpeg muxer writes back-to-back JPEGs with no framing of its
  // own beyond each image's own SOI (0xFFD8) / EOI (0xFFD9) markers — scan
  // for those directly rather than depending on any wrapping protocol.
  _handleChunk(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const start = this.buffer.indexOf(Buffer.from([0xff, 0xd8]));
      if (start === -1) {
        this.buffer = Buffer.alloc(0); // no frame start yet — drop any leading junk
        return;
      }
      const end = this.buffer.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
      if (end === -1) return; // frame not complete yet — wait for more data

      const frame = this.buffer.subarray(start, end + 2);
      this.buffer = this.buffer.subarray(end + 2);
      this.onFrame(frame);
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
const videoRelay = new VideoRelay(
  (cmd) => tello.sendCommand(cmd),
  (frame) => broadcastVideoFrame(frame),
  (msg) => log(`[video] ${msg}`)
);

function broadcastState(state) {
  const payload = JSON.stringify({ type: 'state', ...state });
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}

function broadcastVideoFrame(frame) {
  const payload = JSON.stringify({
    type: 'video_frame',
    jpegBase64: frame.toString('base64'),
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
    timestampMillis: Date.now(),
  });
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

    if (incoming.type === 'video_stream_start') {
      try {
        await videoRelay.start();
        ws.send(JSON.stringify({ type: 'ack', raw: 'video_stream_start' }));
      } catch (err) {
        log(`Failed to start video relay: ${err}`);
        ws.send(JSON.stringify({ type: 'error', raw: String(err) }));
      }
      return;
    }
    if (incoming.type === 'video_stream_stop') {
      await videoRelay.stop();
      ws.send(JSON.stringify({ type: 'ack', raw: 'video_stream_stop' }));
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
  ws.on('close', () => {
    log('Lens disconnected.');
    // Only ever one glasses wearer at a time realistically (same assumption
    // the rest of this file makes) — don't leave ffmpeg running, and the
    // Tello streaming, to nobody once they've gone.
    if (wss.clients.size === 0 && videoRelay.isActive) {
      videoRelay.stop().catch((err) => log(`Failed to stop video relay on disconnect: ${err}`));
    }
  });
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
