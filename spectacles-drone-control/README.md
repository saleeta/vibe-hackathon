# Drone Control via Hand Gestures

Totally separate from `spectacles-perception` and `spectacles-voice-memory`
— no shared types, events, or scene objects. Flies a DJI/Ryze Tello drone
(confirmed against the actual unit — plain consumer Tello Boost Combo, not
Tello EDU, so no mission-pad/swarm commands apply): choose a destination
with your hand, then use distinct hand poses for takeoff/land/emergency-stop.

**Two destination-selection flows are built and both wired into the scene
at once, so you can A/B test which is more reliable for a live demo.**
Toggle between them with each component's own `enabled` checkbox in the
Lens Studio Inspector (`WaypointSelector` vs. `AnchorDestinationController`,
both on the `DroneControlModule` object) — run one at a time; both listening
at once means an ambiguous pinch could trigger either.

## Flow A (recommended for a demo): fixed waypoint markers — `WaypointSelector`

Three small glass-tile markers float in front of the wearer (`LEFT`,
`FORWARD`, `RIGHT`). Point your index finger near one and pinch — whichever
marker is nearest and within range wins, debounced, and fires immediately.
No two-step place-then-hold, no live anchor math, no arbitrary room-scale
geometry — each marker carries a pre-baked `(x, y, z)` offset in
centimeters that's sent straight to the drone.

```
Point at a marker, pinch  -> drone flies to that marker's pre-set offset
```

**Why this is the safer demo choice:** it sidesteps the two riskiest,
still-unverified parts of Flow B below — the `mat4.column3` translation
accessor and the "Spectacles world space vs. Tello body frame" rotation
mismatch (see Flow B's limitations). Trade-off: only the handful of
destinations you pre-calibrate are reachable, not "anywhere in the room."

Files: `WaypointMarker.ts` (one per marker: label, baked offset, glass-tile
display, brief highlight-on-select), `WaypointSelector.ts` (proximity +
pinch selection across up to 3 markers, wired via `waypoint1/2/3` — see
"Known TODOs" for why these are 3 separate inputs, not an array).

## Flow B (original design): live spatial-anchor placement — `AnchorDestinationController`

```
LEFT hand quick pinch   -> place/update the HOME anchor
                           (do this once, right after takeoff, at the
                           drone's actual position)
RIGHT hand quick pinch  -> place/update the DESTINATION anchor
RIGHT hand pinch, HELD  -> commit: fly to the destination
                           ("point where you want it to go, hold to commit")
```

Lets you point anywhere in the room rather than a fixed set of spots, using
the Spatial Anchors package's real `AnchorSession.createWorldAnchor()`. More
flexible, but carries more unverified risk — see "What's real vs. what's a
documented limitation" below.

## Flow B5 (optional, layered on top): natural-language voice control

```
LEFT hand pinch, HELD  -> listening (release to send)
"take off" / "land" / "fly forward one meter" / "go left a bit" /
"what's the battery" -> spoken to the drone-bridge relay, which calls an
                        LLM (Groq) to turn the transcript into an actual
                        command, then speaks a confirmation back
```

This is the third, independent way to drive the drone (on top of Flow A
and Flow B above) — see `drone-bridge/README.md` for the full setup
(`GROQ_API_KEY` env var, the exact prompt/grammar, and why `emergency` is
deliberately excluded from what voice can ever trigger). Files:
`DroneVoiceListener.ts` (push-to-talk ASR, ships the raw transcript — no
NLU on-device), `DroneVoiceResponder.ts` (speaks `spokenText` from any
bridge response, using the same "Sasha" TTS setup as
`spectacles-voice-memory`). Both fully standalone — neither imports
`spectacles-voice-memory`'s equivalents, even though the proven patterns
(push-to-talk via `GestureModule` pinch events, `AsrModule`/
`TextToSpeechModule` usage) are copied from there.

**Gesture collision note:** this uses LEFT-hand pinch for push-to-talk,
same hand Flow B uses for placing the home anchor. Disable whichever
flow(s) you're not demoing that moment — same `enabled`-checkbox discipline
as A vs. B above.

## Shared takeoff/land/emergency vocabulary (gesture flows)

```
Right hand open, raised above head, held   -> takeoff
Right hand open, lowered below head, held  -> land
Both hands closed into fists               -> emergency stop
```

Deliberately **discrete gestures, not continuous joystick control** — see
"What's a V2, not built" below. `emergency` is also the one action voice
control can never reach, by design (see Flow B5 above).

## Left/right/up/down (gesture flow, layered on top) — `DirectionalHandController`

```
Left hand open, raised above head, held    -> fly up
Left hand open, lowered below head, held   -> fly down
Left hand open, held out to the world-left of head, held  -> fly left
Left hand open, held out to the world-right of head, held -> fly right
```

Uses the LEFT hand specifically so it can't collide with takeoff/land
(right hand). Each fires one `go` command for a fixed step (`moveDistanceCm`,
default 50cm, at `speedCmPerSec` default 40) — same discrete, non-joystick
philosophy as takeoff/land, not a V2 continuous-control system.

**Left/right are world-space, not wearer-facing-relative** — compared
directly against the head's world X position, the same simple pattern
`HandCommandController` already uses for takeoff/land's world Y comparison.
"Left" is therefore a fixed world direction, not "whichever way the wearer
happens to be facing." Fine for a demo where the wearer stays roughly
facing one direction; wrong if they turn around mid-flight. The correct fix
needs the camera's actual facing/right vector, which would need verifying
against `WorldCameraFinderProvider`'s real API surface before using —
deliberately not guessed here (see this project's own established rule:
never trust an unverified Lens Studio API assumption). Revisit if this
becomes a real problem.

## Why there's a separate `drone-bridge/` folder at the repo root

**Confirmed against Lens Studio's own docs: Spectacles has no raw UDP socket
support — only WebSocket.** Tello's entire control protocol (SDK 2.0) is
UDP-only (command port 8889, state port 8890). Those two facts mean the Lens
*cannot* talk to a Tello directly, at all, full stop — there is no client-
side-only version of this feature. `drone-bridge/` is a small Node relay
that runs on a laptop on the same Wi-Fi as the drone: the Lens sends it
JSON over WebSocket, it speaks Tello's real UDP text protocol, and relays
state/acks back. See `drone-bridge/README.md` for exact setup — that step
is not optional, for either flow above.

## Folder layout

```
Scripts/
  Core/                       DroneCommand/DroneStatusMessage/VoiceCommandMessage types + event bus
  B1_SpatialDestination/       WaypointMarker.ts + WaypointSelector.ts (Flow A)
                                AnchorDestinationController.ts (Flow B)
                                TelloGoVector.ts (Tello's real x/y/z constraint, used by both flows)
  B2_GestureCommands/          open-hand-height / fist-pose detection -> takeoff/land/emergency
                                DirectionalHandController.ts -> left/right/up/down (left hand)
  B3_DroneBridge/               WebSocket client to drone-bridge
  B4_StatusUI/                  always-visible glass-tile status line (last action + battery)
  B5_VoiceControl/              DroneVoiceListener.ts + DroneVoiceResponder.ts (Flow B5)
  DebugDroneHarness.ts          exercise B2-B4 without a live drone
```

## Wiring into a scene

One root `DroneControlModule` object holding, alongside each other:
`WaypointSelector` (`waypoint1/2/3` -> the 3 marker objects, Flow A),
`AnchorModule` + `AnchorDestinationController` (`anchorModule` -> the
`AnchorModule` above, Flow B), `HandCommandController`,
`DirectionalHandController`, `DroneBridgeClient`
(`bridgeUrl` -> your bridge's address), `DebugDroneHarness`,
`DroneVoiceListener` (`bridgeClient` -> `DroneBridgeClient` above),
`DroneVoiceResponder` (`voiceAudio` -> an `AudioComponent` on the same
object). A sibling `Waypoint Markers` object holds the 3 marker children
(`Waypoint Left`, `Waypoint Forward`, `Waypoint Right`), each `Text` +
`WaypointMarker`. A separate `Drone HUD Canvas` -> `Drone Status Label`
object carries `DroneStatusDisplay` (`statusText`).

## What's real vs. what's a documented limitation

**Real, verified against the installed package source (not guessed):**
- `AnchorModule.openSession()` / `AnchorSession.createWorldAnchor()` /
  `Anchor.toWorldFromAnchor` (Flow B) — read directly from the installed
  Spatial Anchors v0.0.8 package source in this project.
- SIK's `BaseHand.isPinching()`, fingertip/palm-center positions, and
  `Transform.getWorldPosition()` (Flow A) — the same confirmed-stable
  surface used in the other two modules.
- Tello's SDK 2.0 protocol (`command`/`takeoff`/`land`/`emergency`/`go x y z
  speed`, ports 8889/8890, the `go` command's ±20cm-minimum-per-axis quirk)
  — from Ryze's own published SDK documentation, and confirmed to be the
  right SDK variant against a photo of the actual unit (plain Tello Boost
  Combo, not EDU).
- `AsrModule.AsrTranscriptionOptions`/`startTranscribing`/
  `stopTranscribing` and `TextToSpeechModule`/`TextToSpeech.Options` (Flow
  B5) — the same confirmed-working shapes already proven in
  `spectacles-voice-memory`'s `VoiceListener`/`VoiceResponder`.

**Real limitations, not oversights:**
- **No absolute positioning on the Tello.** It has no GPS-quality indoor
  localization — `go` is a *relative* move from wherever the drone
  currently is. In Flow B, the home->destination vector is computed
  correctly in Spectacles' world space, but sent to the drone assuming the
  drone's body frame hasn't rotated since takeoff — a drone that spun in
  place will go the "wrong" way relative to what you pointed at. Flow A
  avoids this specific risk (offsets are pre-baked, not derived from live
  anchor geometry) but still assumes the drone takes off facing the
  direction the offsets were calibrated for.
- **No continuous/joystick control (a real V2).** Tello supports an `rc a b
  c d` command for realtime stick-style flight — the natural next step for
  "fly with your fingers" beyond point-and-commit. Not built: it needs a
  streamed command channel (bridge would need to accept a steady stream,
  not one-at-a-time acked commands) and a calibrated hand-offset-to-stick
  mapping. Scoped out to ship the discrete version first.
- **Scene-unit assumption.** Both flows assume the project's world units are
  already centimeters (matching both Tello's `go` units and the rest of
  this hackathon's scenes) — verify against the actual scene scale before a
  real flight.
- **Voice control has a network round-trip in the loop.** Every spoken
  command costs one Groq API call before the drone reacts — a real, felt
  delay (see `drone-bridge/README.md`), unlike the gesture flows which are
  fully local and instant.

## Known TODOs / needs in-editor verification

- `positionFromMat4()` in `AnchorDestinationController.ts` (Flow B only):
  exact `mat4` accessor for the translation column (assumed `.column3`) —
  Flow A doesn't have this risk, since it never reads a `mat4`.
- `WaypointSelector.waypoint1/2/3` are three separate inputs, not a
  `WaypointMarker[]` array — the MCP tooling used to wire this scene hit an
  "Invalid objectUUID" error passing an array of component references to a
  script input (works fine for single references, the pattern used
  everywhere else in this project). Documented as a known gap rather than a
  design choice; revisit if a 4th+ waypoint is wanted later.
- `DroneBridgeClient`: whether plain `ws://` is accepted on real hardware
  or `wss://` (TLS) is mandatory — see `drone-bridge/README.md`.
- Voice control (Flow B5) needs `GROQ_API_KEY` set on the `drone-bridge`
  process to do anything — without it, `voice_command` messages get a
  spoken rejection but gesture control is unaffected. See
  `drone-bridge/README.md`.
- Nothing in this module has been run against a real Tello or real hand
  tracking yet — it compiles clean in Lens Studio 5.15.4 (verified), but
  the gesture thresholds (`fistThreshold`, `openThreshold`,
  `raiseAboveHead`, `selectionRadius`, etc.) are starting guesses that will
  need tuning once tested on-device.
- `DirectionalHandController.ts` (left/right/up/down) was written and
  pushed while Lens Studio was unavailable to this session — **not yet
  pushed into the live project, not yet compiled against real `tsc`, not
  yet wired into the scene.** First thing to do once Lens Studio's back:
  push the file, add the component to `DroneControlModule`, compile, and
  run through `CompileWithLogsTool`/`RunAndCollectLogsTool` before trusting
  it the way the rest of this module has been verified.

## Status (live-verified in Lens Studio, editor preview)

- Compiles clean against Lens Studio 5.15.4's real `tsc` — all three flows
  together, including the Spatial Anchors v0.0.8 package API, SIK's
  `BaseHand`/`WorldCameraFinderProvider`, and `AsrModule`/
  `TextToSpeechModule`. `MessageEvent`/`CloseEvent` aren't ambient types in
  this TS environment (no DOM lib) — `DroneBridgeClient`'s socket callbacks
  are typed as plain structural objects instead (compiler-verified fix,
  TS2304).
- Full scene wired with all three flows enabled side by side and run in
  the desktop preview with no uncaught exceptions: `AnchorModule`
  initializes (`Spatial Anchor version: v0.0.8`), `DebugDroneHarness`
  comes up ready, `DroneBridgeClient` fails to connect only via a caught
  `InternalError` ("API not available on the simulated platform"), and
  `DroneVoiceListener`'s pinch-trigger wiring fails via the same caught,
  expected `GestureModule` error seen in `spectacles-voice-memory`'s
  `VoiceListener` — all the same expected, handled failure modes seen
  elsewhere in this project's editor previews, not new problems.
- **Found and fixed while wiring voice control:** `drone-bridge`'s
  ack/error check assumed every Tello reply was literally `"ok"`, but
  `battery?` replies with a plain number — a real battery query would have
  been misreported as an error. Fixed in `server.js` (checks for a numeric
  reply for that command specifically). This path was never previously
  exercised by any gesture flow, so the bug was latent, not previously
  live-verified as fixed.
- Not yet tested: real hand tracking, a real Tello, the `drone-bridge`
  relay actually running, or an actual Groq API call for voice control —
  see the TODOs above.
