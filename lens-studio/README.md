# Lens Studio project

`Assets/Scripts/` holds both halves of the Lens: `PersonA/` (perception —
detecting an eating event) and `PersonB/` (the nutrition HUD). Open (or
create) a Lens Studio project rooted here and it will pick these files up as
one project.

## Wiring into the Scene

Person A's own `Assets/Scripts/PersonA/README.md` has the full per-component
`@input` table (camera module, hands, thresholds, etc.) — read that first.
The Person-B-specific pieces:

1. Stand up `nutrition-service` and `api` (see their READMEs at the repo
   root) — `api` needs a real `ANTHROPIC_API_KEY` to actually run vision.
2. On the `EatingTrigger` SceneObject's `foodAnalysisClientComponent` input,
   attach an `HttpFoodAnalysisClient` (not `MockFoodAnalysisClient`) and set
   its `backendUrl` to `api`'s `/v1/analyze` endpoint (e.g.
   `http://localhost:4002/v1/analyze` during development; confirm the
   project's capabilities include internet access and the host is
   allow-listed in Project Settings — Lens Studio will flag this if missing).
3. Add a SceneObject with `PersonB/NutritionHUD.ts` attached. Give it a
   `headlineText` (required — a `Text` component) and, optionally,
   `macrosText`/`glycemicText`/`confidenceText` for the fuller card; any you
   leave unset are simply not shown.
4. Decide whether `PersonA/A6_LoggingUX/AutoLogDisplay` (the compact
   "Apple · ~95 kcal" line) runs alongside `NutritionHUD` or gets disabled —
   both listen to the same `PerceptionEvents.onFoodAnalyzed` signal, so
   either or both can be active.
5. Put every HUD element (from either A6 or NutritionHUD) on the camera
   layer that feeds the Capture Target so it shows up in Spectacles
   recordings — see `../docs/SCREEN_RECORDING.md`.

No Person-B script is a required entry point Person A calls into — A's own
`EatingTrigger` + `HttpFoodAnalysisClient` already own that role once step 2
above is done. See `../docs/ARCHITECTURE.md` for the full request/response
contract between the two.

## Files

### `PersonA/` — perception (A1-A6)

See `PersonA/README.md` for the full breakdown (event bus, state machine,
per-component inputs). None of it depends on `PersonB/`.

### `PersonB/` — nutrition pipeline + HUD

| File | Task | Lens Studio SDK dependency |
|---|---|---|
| `Types.ts` | shared data contracts | none |
| `FoodRecognitionService.ts` | B1 food recognition | none (HTTP transport injected) |
| `PortionEstimator.ts` | B2 portion estimation | none |
| `NutritionClient.ts` | B3 client for `nutrition-service` | none (HTTP transport injected) |
| `EatingSessionManager.ts` | B4 meal aggregation + B5 duplicate detection | none |
| `ConfidenceAggregator.ts` | B6 confidence/uncertainty | none |
| `NutritionHUD.ts` | the visual — subscribes to `PersonA`'s `onFoodAnalyzed` | yes — `Text`, `BaseScriptComponent` |

`Types.ts` through `ConfidenceAggregator.ts` are plain TypeScript with no
Lens Studio dependency and are exercised directly (no mocking needed) by
`../examples/demo.ts` and by `../api/`, which runs the same B1-B6 chain as a
standalone HTTP service (`api/README.md`). `NutritionHUD.ts` is the only
Lens-coupled file, and nothing else in `PersonB/` depends on it.
