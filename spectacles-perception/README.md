# Spectacles Perception Module (Person A)

Self-contained, event-driven Lens Studio TypeScript package covering A1-A6:
continuous camera sampling → hand tracking → food-in-hand classification →
temporal eating-event detection → automatic HQ capture + backend call →
automatic no-interaction logging UX.

## Why it's built this way

Every script only talks to its neighbors through **`Core/PerceptionEvents.ts`**,
a shared signal bus — never by holding direct references to each other. That's
the plug-and-play contract: the main app can enable/disable any piece,
swap an implementation (a different object detector, a mock backend, a
custom UI), or subscribe from completely separate code, without touching
anything else in this package.

```
CameraSampler (A1)
   → onFrameSampled ──────────────► [your object detector] → onObjectsDetected
HandTracker (A2)
   → onHandsUpdated ───────┐
                            ▼
                  FoodInHandClassifier (A3)
                            │ onFoodInHand (classification only, no side effects)
                            ▼
                  EatingEventDetector (A4)   [state machine, see below]
                            │ onEatingEvent
                            ▼
                     EatingTrigger (A5) → cameraSampler.captureHighQuality()
                            │ onHighQualityFrameCaptured
                            ▼
                  FoodAnalysisClient → Person B's backend
                            │ onFoodAnalyzed
                            ▼
                   AutoLogDisplay (A6) — shows, then auto-hides
```

## Folder layout

```
Scripts/
  Core/                     shared types + event bus + ring buffer (no side effects)
  A1_CameraSampler/         camera stream, frame sampling/throttling, HQ on-demand capture, perf profiling
  A2_HandTracking/          SIK hand wrapper, hand/object + hand/face spatial helpers
  A3_FoodInHandClassifier/  pluggable IObjectDetector + the food-in-hand classifier
  A4_EatingEventDetector/   the temporal state machine (the core MVP component)
  A5_EatingTrigger/         wires an eating event to HQ capture + backend call
  A6_LoggingUX/             auto-show/auto-hide "Apple · ~95 kcal" text, zero interaction
```

## Dropping this into the main project

1. Copy `Scripts/` into the main Lens Studio project's `Assets/` (or add this
   repo as a submodule and reference it — either works, Lens Studio just
   needs the `.ts` files under its Assets).
2. Requires the [Spectacles Interaction Kit](https://developers.snap.com/spectacles/spectacles-frameworks/spectacles-interaction-kit/get-started)
   package (`SpectaclesInteractionKit.lspkg`) for `A2_HandTracking`.
3. Add one SceneObject per component below and wire the `@input`s in the
   Inspector:

| Component | Key inputs | Notes |
|---|---|---|
| `CameraSampler` | `cameraModule` (Camera Module asset) | Owns the one active camera stream. Everything else reacts to its events. |
| `HandTracker` | `faceAnchor` (SceneObject) | Point `faceAnchor` at the world camera / head object as a mouth-position approximation. |
| `OnDeviceObjectDetector` *(or your own `IObjectDetector`)* | `mlComponent`, `classLabels`, `foodLabels` | Swap this out entirely for a different detection strategy — A3 only needs `onObjectsDetected` events. |
| `FoodInHandClassifier` | `worldCamera` (optional) | Pure classifier — never triggers anything by itself. |
| `EatingEventDetector` | thresholds (see file) | Tune `faceProximityUnits` / dwell times against your scene's world scale. |
| `EatingTrigger` | `cameraSampler`, `foodAnalysisClientComponent` | Point at `MockFoodAnalysisClient` during development, `HttpFoodAnalysisClient` once Person B's endpoint exists. |
| `AutoLogDisplay` | `logText` (Text component) | No button, no confirmation — shows then fades automatically. |

4. **Scenario/workflow toggling**: each component above is independently
   enable-able (`sceneObject.enabled = false`) or removable. Example
   scenarios:
   - *Main-app-owns-the-UI*: disable `AutoLogDisplay`, subscribe to
     `PerceptionEvents.onFoodAnalyzed` from the main app's own script instead.
   - *Testing without hardware detection*: skip `OnDeviceObjectDetector`
     entirely and call `PerceptionEvents.onObjectsDetected.invoke([...])`
     manually from a debug script.
   - *Skip the backend during a demo*: wire `EatingTrigger` to
     `MockFoodAnalysisClient`.

## Event contract (`Core/PerceptionEvents.ts`)

This is the integration surface for Person B / the main app — subscribe to
whichever signals your workflow needs:

| Signal | Payload | Fired by |
|---|---|---|
| `onFrameSampled` | `{ texture, timestampMillis }` | A1, every ~1000/targetFPS ms |
| `onHighQualityFrameCaptured` | `{ texture, timestampMillis }` | A1, once per eating event |
| `onHandsUpdated` | `HandsSnapshot` (left/right) | A2, every update tick |
| `onObjectsDetected` | `DetectedObject[]` | whatever `IObjectDetector` is plugged in |
| `onFoodInHand` | `FoodInHandResult` | A3 (classification only) |
| `onEatingStateChanged` | `{ previous, next, timestampMillis }` | A4, on every state transition (debug/HUD) |
| `onEatingEvent` | `{ food_object, confidence, timestampMillis }` | A4, once per confirmed bite |
| `onFoodAnalyzed` | `{ name, grams, kcal, confidence? }` | A5, after the backend responds — **this is what triggers auto-logging** |

## A4's state machine (the core of the MVP)

```
NOT_EATING → FOOD_DETECTED → FOOD_IN_HAND → HAND_APPROACHING_FACE → FOOD_AT_FACE → EATING_EVENT
```

Every transition requires its condition to hold for a minimum dwell time
(debounce against single noisy frames) and any state times out back to
`NOT_EATING` if its evidence goes stale (lost tracking, food dropped, hand
stalls). A `cooldownMs` after each `EATING_EVENT` prevents one bite from
being logged twice.

## Known TODOs / needs in-editor verification

None of this has been compiled inside Lens Studio yet — grounded against
the public Scripting API docs, but a few spots are flagged in-file with
`TODO(verify)` and need a pass once opened in the actual 5.15.4 editor:

- `CameraSampler`: whether re-issuing a `CameraRequest` at a different
  `imageSmallerDimension` on an already-running stream hot-swaps cleanly,
  or needs the texture control explicitly stopped first.
- `OnDeviceObjectDetector`: `MLComponent` input-binding/output-reading API —
  depends on how the actual food-classification model is set up.
- `TextureEncoding`: exact `Base64`/`CompressionQuality`/`EncodingType`
  global names for JPEG-encoding a texture before the HTTP POST.
- `AutoLogDisplay`: exact `Text` component property path for fading opacity.

## Perf/battery posture (A1 tasks)

- Perception runs at 10-15 FPS (configurable), not full camera rate.
- The camera stream itself requests a small `imageSmallerDimension` — no
  separate resize pass needed for the cheap path.
- HQ resolution is only requested once, on a confirmed `EATING_EVENT`.
- A rolling-average `PerformanceProfiler` auto-halves the target FPS
  (down to a floor of 4) if the loop is consistently over its per-frame
  time budget.
