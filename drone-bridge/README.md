# drone-bridge

A local WebSocket-to-UDP relay between the Spectacles `spectacles-drone-control`
Lens and a real DJI/Ryze Tello drone.

**Run this on a laptop. Do not deploy it anywhere** — it needs to be on the
same Wi-Fi network as the Tello, which is a local, ad-hoc, non-internet-
routable network in the common case (the Tello's own hotspot).

## Why this exists

Spectacles/Lens Studio has no raw UDP socket support (confirmed against
Lens Studio's own docs) — only WebSocket. Tello's entire SDK 2.0 control
protocol is UDP-only. This script is the only piece of the whole feature
that speaks real UDP to the drone.

## Setup

1. **Network topology** — pick one:
   - **Simplest**: connect both this laptop *and* the Spectacles glasses to
     the Tello's own Wi-Fi hotspot (SSID like `TELLO-XXXXXX`). Neither will
     have internet access while connected — expected, not a bug.
   - **Alternative**: put the Tello into station mode on your home router
     (per Ryze's own instructions) and join the laptop + glasses to that
     same router instead.
2. Install and run:
   ```bash
   npm install
   npm start
   ```
3. Find this laptop's IP address **on that shared network** (`ipconfig` /
   `ifconfig`), e.g. `192.168.10.2`.
4. In the Lens Studio project, set `DroneBridgeClient.bridgeUrl` to
   `wss://<that-ip>:8765` (or `ws://` — see the TLS note below) and push
   the Lens to the glasses.

## TLS (wss://)

Lens Studio's docs say secure WebSocket (`wss://`) is required "on most
platforms" — plain `ws://` may work in Lens Studio's desktop preview but
be rejected on real hardware. This script auto-detects: if `cert.pem` +
`key.pem` exist in this folder, it serves `wss://`; otherwise it falls
back to plain `ws://`.

Generate a quick self-signed pair for testing:
```bash
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 365 -subj "/CN=drone-bridge"
```
The glasses will be talking to a self-signed cert — if the platform
validates certs strictly, this may need a real cert or a tunnel service
(e.g. `ngrok`) instead. Not verified against real hardware yet.

## Protocol

The Lens sends JSON command objects; this relay translates them to Tello's
plaintext protocol and sends them over UDP to `192.168.10.1:8889` (override
with the `TELLO_IP` env var if using station mode with a different IP):

| Lens sends (JSON `type`) | Tello receives |
|---|---|
| `takeoff` | `takeoff` |
| `land` | `land` |
| `emergency` | `emergency` |
| `goto` (`x`,`y`,`z`,`speed`) | `go <x> <y> <z> <speed>` |
| `battery_query` | `battery?` |
| `voice_command` (`text`) | interpreted by an LLM into one of the above (except `emergency` — see below), then sent the same way |

Tello's own periodic telemetry (arriving unprompted on UDP port 8890 once
in SDK mode) is parsed for `bat` (battery %) and `h` (height, cm) and
pushed to every connected Lens as `{"type":"state","batteryPercent":...,
"heightCm":...}`.

Any response that resulted from a `voice_command` also carries a
`spokenText` field (e.g. `{"type":"ack","raw":"ok","spokenText":"Taking
off now."}`) — `DroneVoiceResponder.ts` on the Lens speaks it aloud. Plain
gesture-triggered responses never carry `spokenText`, so gesture flows stay
silent.

## Voice control (B5, optional)

Set `GROQ_API_KEY` in this process's own environment before `npm start` —
**not** in the Lens, and never committed to git. This is the actual
advantage of interpreting voice server-side rather than on the glasses (as
`spectacles-voice-memory`'s `OpenEndedQAClient` has to, for lack of any
other option in Lens Studio's sandboxed TS runtime): the key never leaves
this machine.

```bash
GROQ_API_KEY=gsk_... npm start
```

`GROQ_MODEL` optionally overrides the default (`llama-3.1-8b-instant`).
Without a key set, `voice_command` messages are rejected with a spoken
error ("Sorry, I couldn't understand that.") and gesture control is
unaffected.

**`emergency` is deliberately not reachable by voice at all** — the LLM's
system prompt explicitly excludes it, and even if it somehow returned that
type, this relay's grammar-checking would still route it through the same
`toTelloCommandString` switch as any other type, but the prompt is written
so it can only ever produce `takeoff`/`land`/`goto`/`battery_query`/
`unknown`. A misheard or ambiguously-parsed voice command should never be
able to cut the motors mid-flight — that stays a dedicated two-fist gesture
in `HandCommandController.ts` only.

`goto` offsets from voice are re-clamped here (`clampGoVector` in
`server.js`) to Tello's real constraint (each axis 0 or |value| >= 20cm,
max 500cm) independently of the Lens-side `TelloGoVector.ts` clamp, since
voice-originated commands never pass through that file.

## Known limitations

- One command in flight at a time, matching Tello's own expectation —
  a second command sent before the first is acked/timed-out is rejected
  by this relay, not queued.
- No reconnect/retry logic if the Tello drops off Wi-Fi mid-flight.
- Never tested against a real Tello in this session — built directly from
  Ryze's published Tello SDK 2.0 documentation. Verify the exact IP/port
  values and the `go` command's argument order against your specific
  firmware before a real flight.
- **Fixed while wiring voice control:** the ack/error check used to assume
  every Tello reply was literally `"ok"` — but `battery?` replies with a
  plain number (e.g. `"87"`), so a real battery query would have been
  misreported as an error. `battery_query` now checks for a numeric reply
  instead. This path was never actually exercised before voice control
  (nothing wired `battery_query` to a gesture), so the bug was latent, not
  previously live-verified as fixed.
- The Groq call is one blocking round-trip per voice command (typically
  well under a second for an 8B model, but not instant) — the wearer will
  feel a brief pause between finishing speaking and the drone reacting.
  Not addressed: no loading/thinking indicator is spoken or shown yet.
