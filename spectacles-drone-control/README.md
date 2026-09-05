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

## Shared takeoff/land/emergency vocabulary (both flows)

```
Right hand open, raised above head, held   -> takeoff
Right hand open, lowered below head, held  -> land
Both hands closed into fists               -> emergency stop
```

Deliberately **discrete gestures, not continuous joystick control** — see
"What's a V2, not built" below.

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
  Core/                       DroneCommand/DroneStatusMessage types + event bus
  B1_SpatialDestination/       WaypointMarker.ts + WaypointSelector.ts (Flow A)
                                AnchorDestinationController.ts (Flow B)
                                TelloGoVector.ts (Tello's real x/y/z constraint, used by both flows)
  B2_GestureCommands/          open-hand-height / fist-pose detection -> takeoff/land/emergency
  B3_DroneBridge/               WebSocket client to drone-bridge
  B4_StatusUI/                  always-visible glass-tile status line (last action + battery)
  DebugDroneHarness.ts          exercise B2-B4 without a live drone
```

## Wiring into a scene

One root `DroneControlModule` object holding, alongside each other:
`WaypointSelector` (`waypoint1/2/3` -> the 3 marker objects, Flow A),
`AnchorModule` + `AnchorDestinationController` (`anchorModule` -> the
`AnchorModule` above, Flow B), `HandCommandController`, `DroneBridgeClient`
(`bridgeUrl` -> your bridge's address), `DebugDroneHarness`. A sibling
`Waypoint Markers` object holds the 3 marker children (`Waypoint Left`,
`Waypoint Forward`, `Waypoint Right`), each `Text` + `WaypointMarker`. A
separate `Drone HUD Canvas` -> `Drone Status Label` object carries
`DroneStatusDisplay` (`statusText`).

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
- Nothing in this module has been run against a real Tello or real hand
  tracking yet — it compiles clean in Lens Studio 5.15.4 (verified), but
  the gesture thresholds (`fistThreshold`, `openThreshold`,
  `raiseAboveHead`, `selectionRadius`, etc.) are starting guesses that will
  need tuning once tested on-device.

## Status (live-verified in Lens Studio, editor preview)

- Compiles clean against Lens Studio 5.15.4's real `tsc` — both flows
  together, including the Spatial Anchors v0.0.8 package API and SIK's
  `BaseHand`/`WorldCameraFinderProvider`. `MessageEvent`/`CloseEvent` aren't
  ambient types in this TS environment (no DOM lib) — `DroneBridgeClient`'s
  socket callbacks are typed as plain structural objects instead
  (compiler-verified fix, TS2304).
- Full scene wired with both flows enabled side by side and run in the
  desktop preview with no uncaught exceptions: `AnchorModule` initializes
  (`Spatial Anchor version: v0.0.8`), `DebugDroneHarness` comes up ready,
  and `DroneBridgeClient` fails to connect only via a caught `InternalError`
  ("API not available on the simulated platform") — the same expected,
  handled failure mode as `CameraModule`/`GestureModule` calls in the other
  two modules' editor previews.
- Not yet tested: real hand tracking, a real Tello, or the `drone-bridge`
  relay actually running — see the TODOs above.
