# Lens Studio project

`spectacles/Assets/` holds the whole Lens as one codebase, organized by
pipeline stage (see `spectacles/Assets/README.md` for the full breakdown):

```
Assets/
  Core/             shared types + event bus + ring buffer
  Camera/           camera stream, frame sampling/throttling, HQ capture
  Hands/            SIK hand wrapper, hand/object spatial helpers
  FoodDetection/    object detector + food-in-hand classifier
  EatingDetection/  the eating-event state machine
  Capture/          wires an eating event to HQ capture + backend call
  Nutrition/        food recognition, portion estimation, nutrition client, session aggregation, confidence
  UI/               NutritionHUD — the visual
```

Open (or create) a Lens Studio project rooted here and it will pick these
files up as one project.

## Wiring into the Scene

`spectacles/Assets/README.md` has the full per-component `@input` table
(camera module, hands, thresholds, HUD text slots, etc.) and the event
contract between stages — read that first.

1. Stand up `nutrition-service` and `api` (see their READMEs at the repo
   root) — `api` needs a real `OPENROUTER_API_KEY` to actually run vision.
2. On the `EatingTrigger` SceneObject's `foodAnalysisClientComponent` input,
   attach an `HttpFoodAnalysisClient` (not `MockFoodAnalysisClient`) and set
   its `backendUrl` to `api`'s `/v1/analyze` endpoint (e.g.
   `http://localhost:4002/v1/analyze` during development; confirm the
   project's capabilities include internet access and the host is
   allow-listed in Project Settings — Lens Studio will flag this if missing).
3. Add a SceneObject with `UI/NutritionHUD.ts` attached. Give it a
   `headlineText` (required — a `Text` component) and, optionally,
   `macrosText`/`glycemicText`/`confidenceText` for the fuller card, or set
   `compactMode = true` for just a one-line `"+95 kcal"` confirmation.
4. Put every HUD element on the camera layer that feeds the Capture Target
   so it shows up in Spectacles recordings — see `../docs/SCREEN_RECORDING.md`.

See `../docs/ARCHITECTURE.md` for the full request/response contract between
the perception stages and the nutrition backend.
