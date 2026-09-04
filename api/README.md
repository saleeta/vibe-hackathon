# api — Person B's HTTP surface

Every stage of B1-B6 is a plain TypeScript module (`../lens-studio/Assets/Scripts/PersonB/`)
that can be imported directly — but this service puts a REST endpoint in
front of each one too, so nothing requires importing TS to use: curl, a
script in any language, or a future non-Lens client can all drive the
pipeline as plain HTTP.

## Run

```bash
npm install
ANTHROPIC_API_KEY=sk-ant-... npm run dev   # vision (B1) needs this
```

Defaults to `http://localhost:4002`; talks to `nutrition-service` (B3) at
`http://localhost:4001` (override with `NUTRITION_SERVICE_URL`).

## Endpoints

| Endpoint | Stage(s) | Needs `ANTHROPIC_API_KEY` |
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

### `POST /v1/analyze` — the one you actually want for testing photos
```json
{ "image_base64": "data:image/jpeg;base64,..." }
```
→ a full `MealSummary`: detected foods with weights, `totals` (kcal/protein/carbs/fat), `glycemicEstimate`, and `confidence`. This is what `../test-images/` batch-analyzes against — see that folder's README.

Errors are JSON (`{ "error": "..." }`); `422` means no food was recognized in
the image, `500` covers everything else (including a missing
`ANTHROPIC_API_KEY`, which fails per-request with a clear message rather than
at server startup, so `/health` and `/v1/portion/estimate` keep working
without a key).

## Why a flat test photo uses a different portion-estimation path

Live Spectacles capture has a hand in frame to use as a scale reference
(`PortionEstimator.estimate`, the geometric method). A standalone plate photo
usually doesn't, so `/v1/analyze` uses the vision model's own direct weight
estimate instead (`PortionEstimator.fromVisionEstimate`) — the same
`estimated_weight_g` + confidence shape from the original B2 spec. Both paths
produce the same `PortionEstimate` shape downstream; see
`../docs/ARCHITECTURE.md`.
