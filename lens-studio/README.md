# Lens Studio project — Person B

This folder holds the Lens-side scripts. `Assets/Scripts/PersonB/` is a
regular Lens Studio TypeScript folder — open (or create) a Lens Studio
project rooted here and it will pick these files up.

## Wiring into the Scene (do this in the Lens Studio GUI)

1. Add a Scene Object with a `PersonBController` script component
   (`Assets/Scripts/PersonB/PersonBController.ts`) attached.
2. Set `FOOD_CLASSIFIER_ENDPOINT` and `NUTRITION_SERVICE_BASE_URL` at the top
   of `PersonBController.ts` to your deployed endpoints (see
   `nutrition-service/README.md` for standing up B3).
3. Confirm the project's capabilities include internet access
   (`InternetModule`) — Lens Studio will flag this if it's missing.
4. Have Person A's eating-detection script call
   `personBController.onEatingEventDetected(input)` with an `EatingEventInput`
   (see `Assets/Scripts/PersonB/Types.ts`) once per detected eating frame.
5. Put any HUD elements that display session/food/kcal on the camera layer
   that feeds the Capture Target — see `../docs/SCREEN_RECORDING.md`.

## Files

| File | Task | Lens Studio SDK dependency |
|---|---|---|
| `Types.ts` | shared data contracts | none |
| `FoodRecognitionService.ts` | B1 food recognition | none (HTTP transport injected) |
| `PortionEstimator.ts` | B2 portion estimation | none |
| `NutritionClient.ts` | B3 client for `nutrition-service` | none (HTTP transport injected) |
| `EatingSessionManager.ts` | B4 meal aggregation + B5 duplicate detection | none |
| `ConfidenceAggregator.ts` | B6 confidence/uncertainty | none |
| `PersonBController.ts` | wiring + Lens Studio glue | yes — `InternetModule`, `BaseScriptComponent`, update tick |

Everything except `PersonBController.ts` is plain TypeScript and is exercised
directly (no mocking of Lens Studio needed) by `../examples/demo.ts`.
