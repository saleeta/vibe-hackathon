# vibe-hackathon — calorie & nutrition tracker

Snap Spectacles Lens (Lens Studio), calorie/nutrition tracking. Two halves,
merged into one Lens Studio project:

- **Person A** — `lens-studio/spectacles/Assets/PersonA/` — perception: camera
  sampling, hand tracking, food-in-hand classification, and a temporal state
  machine that confirms a genuine eating event (not just food passing
  through frame). See `PersonA/README.md` for the full A1-A6 breakdown.
- **Person B** — everything else in this repo — turns a confirmed eating
  event into calories, macros, and an estimated glycemic load, shown back on
  screen:
  - **B1** food recognition — one detection per food in a frame, so a plate
    (rice + chicken + broccoli + sauce) is recognized as multiple
    simultaneous items, not just one
  - **B2** portion estimation — the vision model's own direct weight
    estimate (used for both live capture and test photos — see
    `docs/ARCHITECTURE.md` for why); a hand-geometry method also exists,
    reachable via its own endpoint, for whenever pixel-space hand geometry
    becomes available
  - **B3** nutrition engine (a separate service — food + grams → macros,
    plus an estimated glycemic load)
  - **B4** meal aggregation — a whole plate detected in one frame, or a
    string of separate bites over time, both collapse into **one** eating
    session and **one** logged set of calories, not one log entry per food
    or per frame
  - **B5** duplicate detection, tracked per food — repeatedly seeing the
    same plate/bite across frames updates the running estimate instead of
    logging it again, while genuinely new food (a second helping) still
    counts
  - **B6** confidence / uncertainty, carried at every stage instead of a
    false point estimate

Also logs an **estimated glycemic load** per meal (glycemic index × carbs,
from food composition) — explicitly not a measured blood glucose value; see
`docs/COMPLIANCE.md` for why that distinction matters for a diabetes-adjacent
feature, and where a real CGM/glucometer reading would attach instead.

## How A and B meet

Person A already designed the integration seam before Person B's code
existed: `IFoodAnalysisClient` (`PersonA/A5_EatingTrigger/FoodAnalysisClient.ts`).
Point its `HttpFoodAnalysisClient` implementation at `api/`'s
`POST /v1/analyze` and the two halves are wired — no bespoke glue code
needed, since that endpoint's request/response shape already matched A's
own contract almost exactly. Full detail (event flow, response shape, the
visual display) is in `docs/ARCHITECTURE.md` — read that first if you're
touching the integration.

```
food in hand → A's state machine confirms an eating event → HQ frame captured
   → HttpFoodAnalysisClient POSTs it to api/'s /v1/analyze
   → B1 → B2 → B4/B5 → B3 → B6 → { name, kcal, proteinG, carbsG, fatG, glycemicLoad, confidence, ... }
   → PersonB/NutritionHUD.ts (and/or PersonA's AutoLogDisplay) shows it, then fades out
```

## Modular by design

Every B-stage lives in its own file with no dependency on the others' guts
(`lens-studio/spectacles/Assets/PersonB/*.ts` — plain TypeScript, swap any one
implementation without touching the rest), and every stage is also reachable
as a plain HTTP call:

| Call | Stage(s) |
|---|---|
| `POST :4002/v1/food/classify` | B1 |
| `POST :4002/v1/portion/estimate` | B2 (hand-geometry method) |
| `POST :4001/nutrition/lookup`, `/nutrition/meal` | B3 |
| `POST :4002/v1/analyze` | the whole pipeline, one image in → full nutrition/glycemic/confidence out — this is what A's `HttpFoodAnalysisClient` calls |

See `api/README.md` and `nutrition-service/README.md` for request/response
shapes.

## Layout

```
lens-studio/            One Lens Studio project — both halves live under spectacles/Assets/
  spectacles/Assets/
    PersonA/              Perception (A1-A6) — camera, hands, food-in-hand, eating-event state machine
    PersonB/               Nutrition pipeline modules + NutritionHUD (the visual)
nutrition-service/       B3 — standalone HTTP nutrition lookup/scaling service
api/                     HTTP surface for B1/B2/B6 + the composed /v1/analyze pipeline (real vision backend)
examples/demo.ts         Whole B1-B6 pipeline end-to-end in plain Node, mocked vision (no API key, no Lens Studio needed)
test-images/              Drop food photos here, run api's analyze-folder script, get a visual results report
docs/
  ARCHITECTURE.md         How A and B meet, how every B-stage fits together, every documented gap
  SCREEN_RECORDING.md      How the Spectacles recording composites the HUD over the camera view
  COMPLIANCE.md            Practical Spectacles/Lens Studio compliance notes
```

## Try it with real food photos (no Spectacles hardware needed)

```bash
cd nutrition-service && npm install && npm run dev              # terminal 1 — B3
cd api && npm install && ANTHROPIC_API_KEY=sk-ant-... npm run dev  # terminal 2 — B1/B2/B6 + /v1/analyze
# drop .jpg/.jpeg/.png/.webp photos into test-images/, then:
cd api && npm run analyze-folder                                 # terminal 3
```

Opens up `test-images/results.html` with one card per photo — detected
foods, estimated weights, kcal/macros, estimated glycemic load, and
confidence. See `test-images/README.md`. This exercises the exact same
`/v1/analyze` endpoint A's `HttpFoodAnalysisClient` calls from the Lens.

## Try it without any API key

```bash
cd nutrition-service && npm install && npm run dev   # terminal 1
cd examples && npm install && npm start               # terminal 2
```

Runs the same B1-B6 pipeline against a scripted mock vision backend instead
of a real photo — see `examples/README.md`.

## Status / what's stubbed

- `nutrition-service`'s food database is a small hand-seeded table (~16
  foods), a placeholder for a licensed nutrition data source.
- `api/`'s vision backend (`ClaudeVisionClassifier`) requires
  `ANTHROPIC_API_KEY` in the environment; without it, `/v1/food/classify` and
  `/v1/analyze` fail per-request with a clear error (everything else still
  works).
- Nothing in `lens-studio/` has been opened/compiled in the actual Lens
  Studio editor yet — several files on both the A and B side carry
  `TODO(verify)` markers for exact SDK property names/paths that need a pass
  once opened in the target editor version.
- B2's hand-geometry portion-estimation method exists and is reachable
  (`POST /v1/portion/estimate`) but isn't fed by live data yet — see
  "Known gaps" in `docs/ARCHITECTURE.md`.

See `docs/ARCHITECTURE.md` for the full list.
