# Drone Control via Spatial Anchors + Hand Gestures

Totally separate from `spectacles-perception` and `spectacles-voice-memory`
— no shared types, events, or scene objects. Flies a DJI/Ryze Tello drone:
pinch to mark a home point and a destination in the real world (Spatial
Anchors), hold the pinch to commit the drone to flying there, and use
distinct hand poses for takeoff/land/emergency-stop.

## Why there's a separate `drone-bridge/` folder at the repo root

**Confirmed against Lens Studio's own docs: Spectacles has no raw UDP socket
support — only WebSocket.** Tello's entire control protocol (SDK 2.0) is
UDP-only (command port 8889, state port 8890). Those two facts mean the Lens
*cannot* talk to a Tello directly, at all, full stop — there is no client-
side-only version of this feature. `drone-bridge/` is a small Node relay
that runs on a laptop on the same Wi-Fi as the drone: the Lens sends it
JSON over WebSocket, it speaks Tello's real UDP text protocol, and relays
state/acks back. See `drone-bridge/README.md` for exact setup — that step
is not optional.

## Gesture vocabulary

```
LEFT hand quick pinch   -> place/update the HOME anchor
                           (do this once, right after takeoff, at the
                           drone's actual position)
RIGHT hand quick pinch  -> place/update the DESTINATION anchor
RIGHT hand pinch, HELD  -> commit: fly to the destination
                           ("point where you want it to go, hold to commit")

Right hand open, raised above head, held   -> takeoff
Right hand open, lowered below head, held  -> land
Both hands closed into fists               -> emergency stop
```

Deliberately **discrete gestures, not continuous joystick control** — see
"What's a V2, not built" below.

## Folder layout

```
Scripts/
  Core/                      DroneCommand/DroneStatusMessage types + event bus
  B1_SpatialDestination/      pinch-to-place anchors, hold-to-commit flight trigger,
                              TelloGoVector.ts (Tello's real x/y/z constraint)
  B2_GestureCommands/         open-hand-height / fist-pose detection -> takeoff/land/emergency
  B3_DroneBridge/              WebSocket client to drone-bridge
  B4_StatusUI/                 always-visible glass-tile status line (last action + battery)
  DebugDroneHarness.ts         exercise B2-B4 without a live drone
```

## Wiring into a scene

One root `DroneControlModule` object holding: `AnchorModule` (from the
Spatial Anchors package — `cloudStorage` input left unset, anchors don't
need to sync across devices here), `AnchorDestinationController`
(`anchorModule` -> the one above), `HandCommandController`,
`DroneBridgeClient` (`bridgeUrl` -> your bridge's address),
`DebugDroneHarness`. Plus a small UI child (Canvas -> ScreenTransform ->
`Text`) carrying `DroneStatusDisplay` (`statusText`).

## What's real vs. what's a documented limitation

**Real, verified against the installed package source (not guessed):**
- `AnchorModule.openSession()` / `AnchorSession.createWorldAnchor()` /
  `Anchor.toWorldFromAnchor` — read directly from the installed Spatial
  Anchors v0.0.8 package source in this project.
- SIK's `BaseHand.isPinching()`, fingertip/palm-center positions, and
  `WorldCameraFinderProvider` — the same confirmed-stable surface used in
  the other two modules.
- Tello's SDK 2.0 protocol (`command`/`takeoff`/`land`/`emergency`/`go x y z
  speed`, ports 8889/8890, the `go` command's ±20cm-minimum-per-axis quirk)
  — from Ryze's own published SDK documentation.

**Real limitations, not oversights:**
- **No absolute positioning on the Tello.** It has no GPS-quality indoor
  localization — `go` is a *relative* move from wherever the drone
  currently is. The home->destination vector is computed correctly in
  Spectacles' world space, but sent to the drone assuming the drone's body
  frame hasn't rotated since takeoff. A drone that spun in place between
  takeoff and the fly command will go the "wrong" way relative to what you
  pointed at. A correct fix needs the drone's current yaw (Tello's state
  stream carries it) to rotate the vector into the drone's body frame
  first — not implemented; flagged here rather than silently wrong.
- **No continuous/joystick control (a real V2).** Tello supports an `rc a b
  c d` command for realtime stick-style flight — the natural next step for
  "fly with your fingers" beyond point-and-commit. Not built: it needs a
  streamed command channel (bridge would need to accept a steady stream,
  not one-at-a-time acked commands) and a calibrated hand-offset-to-stick
  mapping. Scoped out to ship the discrete version first.
- **Scene-unit assumption.** `AnchorDestinationController` assumes the
  project's world units are already centimeters (matching both Tello's
  `go` units and the rest of this hackathon's scenes) — verify against the
  actual scene scale before a real flight.

## Known TODOs / needs in-editor verification

- `positionFromMat4()` in `AnchorDestinationController.ts`: exact `mat4`
  accessor for the translation column (assumed `.column3`).
- `DroneBridgeClient`: whether plain `ws://` is accepted on real hardware
  or `wss://` (TLS) is mandatory — see `drone-bridge/README.md`.
- Nothing in this module has been run against a real Tello or real hand
  tracking yet — it compiles clean in Lens Studio 5.15.4 (verified), but
  the gesture thresholds (`fistThreshold`, `openThreshold`,
  `raiseAboveHead`, etc.) are starting guesses that will need tuning once
  tested on-device.

## Status (live-verified in Lens Studio, editor preview)

- Compiles clean against Lens Studio 5.15.4's real `tsc` — including the
  Spatial Anchors v0.0.8 package API (`AnchorModule`, `AnchorSession`,
  `WorldAnchor`) and SIK's `BaseHand`/`WorldCameraFinderProvider`.
  `MessageEvent`/`CloseEvent` aren't ambient types in this TS environment
  (no DOM lib) — `DroneBridgeClient`'s socket callbacks are typed as plain
  structural objects instead (compiler-verified fix, TS2304).
- Full scene wired and run in the desktop preview with no uncaught
  exceptions: `AnchorModule` initializes (`Spatial Anchor version: v0.0.8`),
  `DebugDroneHarness` comes up ready, and `DroneBridgeClient` fails to
  connect only via a caught `InternalError` ("API not available on the
  simulated platform") — the same expected, handled failure mode as
  `CameraModule`/`GestureModule` calls in the other two modules' editor
  previews.
- Scene: one `DroneControlModule` object holding `AnchorModule`,
  `AnchorDestinationController` (wired to it), `HandCommandController`,
  `DroneBridgeClient`, `DebugDroneHarness`; a separate `Drone HUD Canvas` ->
  `Drone Status Label` object carries `DroneStatusDisplay`. Does not touch
  or reference any `PerceptionModule`/`VoiceMemoryModule` scene object.
- Not yet tested: real hand tracking, a real Tello, or the `drone-bridge`
  relay actually running — see the TODOs above.
