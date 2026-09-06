# Exercise tracking — steps, squats, curls, and a curl-powered dino game

MVP fitness tracker for Snap Spectacles, built on the same event-bus
convention as `../README.md`'s nutrition pipeline: every tracker only talks
to its neighbors through `Core/WorkoutEvents.ts`, never by holding direct
references.

## Why heuristics, not Body Tracking

Spectacles' outward-facing cameras can't see the wearer's own body, so
standard 3D Body Tracking isn't an option. Every tracker here instead infers
a rep from what the headset *can* see: the camera's own head-motion, and
the tracked hand's position relative to it.

```
Camera (head motion)
   → StepCounter        → onStep
   → SquatTracker       → onSquat

Hands/HandTracker (existing, shared with the nutrition pipeline)
   → onHandsUpdated
        → BicepCurlTracker → onCurlUp  (fires instantly — the dino-jump input)
                            → onCurlRep (fires on a full extend→curl→extend cycle — the counted rep)

WorkoutManager  (subscribes to onStep/onSquat/onCurlRep)
   → onWorkoutUpdated → WorkoutHUD (Text components)
                       → WorkoutLog (persisted on save)

DinoGame (subscribes to onCurlUp directly — completely separate from rep counting)
```

## Folder layout

```
Exercise/
  Core/       WorkoutTypes.ts, WorkoutEvents.ts  (shared types + signal bus)
  Trackers/   StepCounter.ts, SquatTracker.ts, BicepCurlTracker.ts
  UI/         WorkoutHUD.ts
  Game/       DinoGame.ts
  WorkoutManager.ts, WorkoutLog.ts
```

## Units: centimetres

This scene's world/tracking scale is **centimetres** (1 unit = 1 cm). Every
distance/velocity threshold below is in cm or cm/s — an earlier version of
these files assumed metres and was ~100× off, which is why steps ran away,
squats were flaky, and curls never fired. Reference values captured on
device: standing-still head noise < 1 cm; a walking step swings the head
7-11 cm; a squat drops it 40-47 cm and returns in ~1.3 s; sitting drops it
the same but holds for many seconds; a right-arm curl moves the index tip
from ~-85 cm below head (arm down) to ~-10 cm (curled).

## Wiring into the Scene

| Component | Attach to | Key inputs | Notes |
|---|---|---|---|
| `StepCounter` | Camera scene object | `dipVelocityThreshold` (cm/s), `minBobAmplitudeCm`, `maxPlausibleVelocity` (cm/s), `debounceMs` | Tracks the camera's own local-Y velocity for a head-bob approximation of a step. |
| `SquatTracker` | Camera scene object | `dipThresholdCm`, `returnMarginCm`, `maxSquatMs`, `calibrationDelayMs` | Samples a standing-height baseline once, `calibrationDelayMs` after wake. A dip held longer than `maxSquatMs` is treated as a sit: no rep, and the baseline is re-sampled on standing up. Call `recalibrate()` from a "start squats" action if the reference drifts. |
| `BicepCurlTracker` | Any scene object (doesn't need to be on the camera) | `hand` (`"left"`/`"right"`), `headAnchor` (point at the world camera), `curledHeightThreshold` (cm), `extendedHeightThreshold` (cm), `curlWeightKg` | Reuses `Hands/HandTracker`'s `onHandsUpdated` — no second hand-tracking path. Keys off the hand's **index-tip** height (SIK palm centre needs `getPalmCenter()`, which HandTracker originally missed). |
| `WorkoutManager` | One SceneObject | `curlWeightKg`, `bodyWeightKg` | Central state. Call `saveSession()` to persist the current totals; `resetSession()` to zero the counters without saving. |
| `WorkoutHUD` | Same SceneObject as `WorkoutManager`, or its own | `stepsText`, `squatsText`, `curlsText` (required), `caloriesText` (optional) | Three Text components on a Screen Transform, updated instantly on every `onWorkoutUpdated`. |
| `DinoGame` | One SceneObject | `dinoText`, `obstacleText` (required — background-fill-only Text components, no Image assets needed), `scoreText`/`statusText` (optional), `groundY`, `jumpHeight`, `jumpDurationMs`, `obstacleSpeed` | Jump is triggered **only** by `onCurlUp` — same signal `BicepCurlTracker` fires the instant an arm reaches "curled". A curl during game-over restarts instead of jumping. |

`curlWeightKg` is manual on both `BicepCurlTracker` and `WorkoutManager` —
Spectacles has no way to sense actual load, so keep the two in sync (or
just set it once on `BicepCurlTracker`, since its value is what actually
gets forwarded through `onCurlRep`/`onCurlUp` and used for the calorie
estimate).

## Calorie estimate — an MVP heuristic, not a measurement

`WorkoutManager.estimateKcal()` uses simple per-rep/per-step constants
(`steps × 0.04`, `squats × 0.005 × bodyWeightKg`, `curls × (weightKg × 0.01
+ 0.1)`), not a calibrated metabolic model. Same "estimate" framing as the
nutrition pipeline's glycemic load (see `../../../docs/COMPLIANCE.md`) — a
progress number for the MVP, not a fitness-tracker-grade calorie count.

## Event contract (`Core/WorkoutEvents.ts`)

| Signal | Payload | Fired by |
|---|---|---|
| `onStep` | `{ timestampMillis }` | `Trackers/StepCounter.ts` |
| `onSquat` | `{ timestampMillis }` | `Trackers/SquatTracker.ts` |
| `onCurlUp` | `{ weightKg, timestampMillis }` | `Trackers/BicepCurlTracker.ts`, the instant the wrist reaches "curled" — the dino-jump trigger |
| `onCurlRep` | `{ weightKg, timestampMillis }` | `Trackers/BicepCurlTracker.ts`, once a full extend→curl→extend cycle completes — the counted rep |
| `onWorkoutUpdated` | `WorkoutSummary` | `WorkoutManager.ts`, after every counter change |
