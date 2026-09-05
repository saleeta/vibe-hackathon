# api — the nutrition pipeline's HTTP surface

Every stage is a plain TypeScript module (`../lens-studio/spectacles/Assets/Nutrition/`)
that can be imported directly — but this service puts a REST endpoint in
front of each one too, so nothing requires importing TS to use: curl, a
script in any language, or a future non-Lens client can all drive the
pipeline as plain HTTP.

## Run

```bash
npm install
OPENROUTER_API_KEY=sk-or-v1-... npm run dev   # vision (food recognition) needs this
```

Vision runs via [OpenRouter](https://openrouter.ai)'s OpenAI-compatible API,
currently pointed at `google/gemma-4-31b-it:free` (`api/src/vision/OpenRouterVisionClassifier.ts`)
— free, vision-capable. No free Qwen-VL tier exists on OpenRouter as of
writing (only paid `qwen/qwen2.5-vl-*`/`qwen3-vl-*`); swap the `MODEL`
constant in that file if that changes or you'd rather use a paid model.

Defaults to `http://localhost:4002`; talks to `nutrition-service` (B3) at
`http://localhost:4001` (override with `NUTRITION_SERVICE_URL`).

## Endpoints

| Endpoint | Stage(s) | Needs `OPENROUTER_API_KEY` |
|---|---|---|
| `GET /health` | — | no |
| `POST /v1/food/classify` | B1 | yes |
| `POST /v1/portion/estimate` | B2 (hand-geometry method) | no |
| `POST /v1/analyze` | B1 → B2 → B4/B5 → B3 → B6, one call | yes |

`nutrition-service`'s own `/nutrition/lookup` and `/nutrition/meal` (B3) are
documented in `../nutrition-service/README.md` and are part of the same
modular surface — just a separate deployable, per the original spec.

### `POST /v1/food/classify`
```json
{ "image_base64": "data:image/jpeg;base64,..." }
```
→ `{ "items": [{ "boundingBox": {...}, "food": "banana", "confidence": 0.96, "visionPortionEstimate": { "estimatedWeightG": 118, "confidence": 0.72 } }] }`

### `POST /v1/portion/estimate`
For the hand-geometry method (live Spectacles capture, not a flat photo):
```json
{
  "food": "banana",
  "boundingBox": { "x": 100, "y": 100, "width": 180, "height": 140, "imageWidth": 1280, "imageHeight": 960 },
  "hand": { "distanceMeters": 0.35, "handPixelWidth": 220, "handWidthCm": 8.5 },
  "foodConfidence": 0.96
}
```
→ `{ "food": "banana", "estimatedWeightG": ..., "uncertaintyG": ..., "confidence": ... }`

### `POST /v1/analyze` — the one endpoint that does everything

Also the concrete backend for the perception side's `IFoodAnalysisClient`
contract — `Assets/Capture/FoodAnalysisClient.ts`'s `HttpFoodAnalysisClient`
calls exactly this endpoint with exactly this request shape when wired into
a live Lens (point its `backendUrl` input here). `food_hint`,
`detection_confidence`, and `timestamp_millis` are optional and only present
when the call came from a real eating event rather than a manually-uploaded
test photo:

```json
{
  "image_base64": "data:image/jpeg;base64,...",
  "food_hint": "apple",
  "detection_confidence": 0.91,
  "timestamp_millis": 1735000000000
}
```

→
```json
{
  "name": "apple", "grams": 132, "kcal": 69, "confidence": 0.84,
  "proteinG": 0.4, "carbsG": 18.2, "fatG": 0.3, "weightUncertaintyG": 59.4,
  "glycemicLoad": 6.6, "glycemicCategory": "low",
  "foodConfidence": 0.93, "portionConfidence": 0.7,

  "sessionId": "session-...", "startedSec": 1735000000, "closedSec": 1735000000,
  "items": [{ "food": "apple", "weightG": 132, "weightUncertaintyG": 59.4, "foodConfidence": 0.93, "portionConfidence": 0.7, "firstSeenSec": ..., "lastSeenSec": ..., "observationCount": 1 }],
  "totals": { "kcal": 69, "proteinG": 0.4, "carbsG": 18.2, "fatG": 0.3 },
  "confidence": { "eatingConfidence": 0.91, "foodConfidence": 0.93, "portionConfidence": 0.7, "overall": 0.84 },
  "glycemicEstimate": { "totalGlycemicLoad": 6.6, "category": "low", "allFoodsMatched": true }
}
```

The top-level flat fields (`name`/`grams`/`kcal`/`confidence`/...) are what
`HttpFoodAnalysisClient` reads into `FoodAnalysisResult` — `name`/`grams`
flatten to the heaviest detected item / summed weight across all items, in
case the frame showed more than one food. The nested `items`/`totals`/
`confidence`/`glycemicEstimate` (the full `MealSummary`) are there for
anything that wants the complete breakdown, including
`../test-images/`'s batch script, which reads those nested fields — see
that folder's README, and `../docs/ARCHITECTURE.md` for the full contract.

Errors are JSON (`{ "error": "..." }`); `422` means no food was recognized in
the image, `500` covers everything else (including a missing
`OPENROUTER_API_KEY`, which fails per-request with a clear message rather than
at server startup, so `/health` and `/v1/portion/estimate` keep working
without a key).

## Why `/v1/analyze` always uses the vision-direct portion method

`PortionEstimator.estimate` (the hand-geometry method,
`/v1/portion/estimate`) needs camera-space pixel hand geometry. The
perception side's `HandTracker` currently reports world-space hand positions instead (via
SIK), so nothing feeds that method live yet — `/v1/analyze` always uses the
vision model's own direct weight estimate instead
(`PortionEstimator.fromVisionEstimate`), for both a live Spectacles capture
and a standalone test photo. See "Known gaps" in `../docs/ARCHITECTURE.md`.
