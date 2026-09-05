# Nutrition Lens — perception + nutrition pipeline

Self-contained, event-driven Lens Studio TypeScript pipeline: continuous
camera sampling → hand tracking → food-in-hand classification → temporal
eating-event detection → automatic HQ capture + backend call → food
recognition → portion estimation → nutrition lookup → session aggregation
→ confidence scoring → HUD.

One codebase, organized by pipeline stage — not by who wrote which half.

## Why it's built this way

Every perception-side script only talks to its neighbors through
**`Core/PerceptionEvents.ts`**, a shared signal bus — never by holding direct
references to each other. That's the plug-and-play contract: the main app
can enable/disable any piece, swap an implementation (a different object
detector, a mock backend, a custom UI), or subscribe from completely
separate code, without touching anything else in this pipeline.

```
CameraSampler
   → onFrameSampled ──────────────► [object detector] → onObjectsDetected
HandTracker
   → onHandsUpdated ───────┐
                            ▼
                  FoodInHandClassifier
                            │ onFoodInHand (classification only, no side effects)
                            ▼
                  EatingEventDetector   [state machine, see below]
                            │ onEatingEvent
                            ▼
                     EatingTrigger → cameraSampler.captureHighQuality()
                            │ onHighQualityFrameCaptured
                            ▼
                  FoodAnalysisClient → nutrition backend (api/)
                            │ onFoodAnalyzed
                            ▼
                   NutritionHUD — shows, then auto-hides
```

The nutrition side (`Nutrition/`) is plain TypeScript with no Lens Studio
dependency — it's exercised the same way by `api/` (a standalone HTTP
service) and by `../../../examples/demo.ts` (a plain-Node run with a mocked
vision backend). `UI/NutritionHUD.ts` is the only Lens-coupled nutrition
file, and it's a leaf: nothing else in `Nutrition/` depends on it.

## Folder layout

```
Assets/
  Core/             shared types + event bus + ring buffer (no side effects)
  Camera/           camera stream, frame sampling/throttling, HQ on-demand capture, perf profiling
  Hands/            SIK hand wrapper, hand/object + hand/face spatial helpers
  FoodDetection/    pluggable IObjectDetector + the food-in-hand classifier
  EatingDetection/  the temporal state machine (the core MVP component)
  Capture/          wires an eating event to HQ capture + backend call
  Nutrition/        food recognition, portion estimation, nutrition client, session aggregation, confidence
  UI/               NutritionHUD — the visual, auto-show/auto-hide, no interaction
```

## Wiring into the Scene

1. Requires the [Spectacles Interaction Kit](https://developers.snap.com/spectacles/spectacles-frameworks/spectacles-interaction-kit/get-started)
   package (`SpectaclesInteractionKit.lspkg`) for `Hands/`.
2. Stand up `nutrition-service` and `api` (see their READMEs at the repo
   root) — `api` needs a real `OPENROUTER_API_KEY` to actually run vision.
3. Add one SceneObject per component below and wire the `@input`s in the
   Inspector:

| Component | Key inputs | Notes |
|---|---|---|
| `CameraSampler` | `cameraModule` (Camera Module asset) | Owns the one active camera stream. Everything else reacts to its events. |
| `HandTracker` | `faceAnchor` (SceneObject) | Point `faceAnchor` at the world camera / head object as a mouth-position approximation. |
| `OnDeviceObjectDetector` *(or your own `IObjectDetector`)* | `mlComponent`, `confidenceThreshold`, `nmsThreshold` | Single-class anchor-based detector (input `"data"`, outputs `"cls"`/`"loc"`) — real bounding boxes, not a whole-frame guess. Swap this out entirely for a different detection strategy — the food-in-hand classifier only needs `onObjectsDetected` events. |
| `FoodInHandClassifier` | `worldCamera` (optional) | Pure classifier — never triggers anything by itself. |
| `EatingEventDetector` | `minDwellFoodInHandMs`, `staleTimeoutMs`, `cooldownMs` | Fires once food is confirmed in-hand for `minDwellFoodInHandMs` — not a hand-to-mouth gesture, just a confirmed hold. |
| `EatingTrigger` | `cameraSampler`, `foodAnalysisClientComponent`, `sessionGapMs` | Point at `MockFoodAnalysisClient`/`HttpFoodAnalysisClient`/`GeminiFoodAnalysisClient` (all implement `IFoodAnalysisClient`). Calls the backend once per eating session (`sessionGapMs`, default 15s — short for fast iteration; raise toward a few minutes for real "one log per meal" behavior), not once per bite. |
| `NutritionHUD` | `headlineText` (required), `macrosText`/`glycemicText`/`confidenceText` (optional) | Always starts as a compact card (name + kcal) positioned beside the last detected food's bounding box; pinch with either hand to expand/collapse the macros/glycemic/confidence lines for the currently-shown result. Any optional Text left unset is simply not shown. |

4. **Debugging detection**: `FoodDetection/DetectionBoxDebugView.ts` draws a
   light-blue semi-transparent highlight + confidence label over whatever
   `OnDeviceObjectDetector` is currently seeing — `NutritionHUD` reads this
   same `onObjectsDetected` signal to place its card beside the box. Box
   placement is approximate (see the file's header comment) — good for "is
   it detecting" and "roughly where", not pixel-precise overlay.
5. **Meal history**: `Capture/MealLog.ts` appends `{ name, kcal, macros,
   glycemicLoad, timestampMillis }` to Lens Studio's on-device
   `PersistentStorageSystem` every time `EatingTrigger` gets a successful
   result — survives across Lens sessions on the same device, no server
   required. `getMealLog()` / `clearMealLog()` are there for anything that
   wants to read or reset the history.
6. **Scenario/workflow toggling**: each component above is independently
   enable-able (`sceneObject.enabled = false`) or removable. Example
   scenarios:
   - *Testing without hardware detection*: skip `OnDeviceObjectDetector`
     entirely and call `PerceptionEvents.onObjectsDetected.invoke([...])`
     manually from a debug script.
   - *Skip the backend during a demo*: wire `EatingTrigger` to
     `MockFoodAnalysisClient`.
7. Put the `NutritionHUD`'s Text elements on the camera layer that feeds the
   Capture Target so they show up in Spectacles recordings — see
   `../../../docs/SCREEN_RECORDING.md`.

## Event contract (`Core/PerceptionEvents.ts`)

This is the integration surface for the nutrition pipeline / the main app —
subscribe to whichever signals your workflow needs:

| Signal | Payload | Fired by |
|---|---|---|
| `onFrameSampled` | `{ texture, timestampMillis }` | `Camera/CameraSampler.ts`, every ~1000/targetFPS ms |
| `onHighQualityFrameCaptured` | `{ texture, timestampMillis }` | `Camera/CameraSampler.ts`, once per eating event |
| `onHandsUpdated` | `HandsSnapshot` (left/right) | `Hands/HandTracker.ts`, every update tick |
| `onObjectsDetected` | `DetectedObject[]` | whatever `IObjectDetector` is plugged in |
| `onFoodInHand` | `FoodInHandResult` | `FoodDetection/FoodInHandClassifier.ts` (classification only) |
| `onEatingStateChanged` | `{ previous, next, timestampMillis }` | `EatingDetection/EatingEventDetector.ts`, on every state transition (debug/HUD) |
| `onEatingEvent` | `{ food_object, confidence, timestampMillis }` | `EatingDetection/EatingEventDetector.ts`, once per confirmed bite |
| `onFoodAnalyzed` | `{ name, grams, kcal, confidence?, ... }` | `Capture/EatingTrigger.ts`, after the backend responds — **this is what triggers auto-logging** |

## The state machine (the core of the MVP)

```
NOT_EATING → FOOD_DETECTED → FOOD_IN_HAND → EATING_EVENT
```

Every transition requires its condition to hold for a minimum dwell time
(debounce against single noisy frames) and any state times out back to
`NOT_EATING` if its evidence goes stale (lost tracking, food dropped, hand
stalls). A `cooldownMs` after each `EATING_EVENT` prevents one bite from
being logged twice.

## Perf/battery posture

- Perception runs at 10-15 FPS (configurable), not full camera rate.
- The camera stream itself requests a small `imageSmallerDimension` — no
  separate resize pass needed for the cheap path.
- HQ resolution is only requested once, on a confirmed `EATING_EVENT`.
- A rolling-average `PerformanceProfiler` auto-halves the target FPS
  (down to a floor of 4) if the loop is consistently over its per-frame
  time budget.
- `NutritionHUD` is a single component (compact and full-card modes share
  one fade loop / one `DelayedCallbackEvent`) rather than two competing
  implementations both listening to the same signal.
