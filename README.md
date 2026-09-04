# vibe-hackathon — calorie & nutrition tracker (Person B)

Snap Spectacles Lens (Lens Studio), calorie/nutrition tracking. Person A
detects "food is in the hand" eating events; this repo implements what
happens next — Person B's side:

- **B1** food recognition — one detection per food in a frame, so a plate
  (rice + chicken + broccoli + sauce) is recognized as multiple simultaneous
  items, not just one
- **B2** portion estimation — hand-geometry scale reference for live
  Spectacles capture, or the vision model's own direct weight estimate for a
  standalone photo with no hand in frame
- **B3** nutrition engine (a separate service — food + grams → macros, plus
  an estimated glycemic load)
- **B4** meal aggregation — a whole plate detected in one frame, or a string
  of separate bites over time, both collapse into **one** eating session and
  **one** logged set of calories, not one log entry per food or per frame
- **B5** duplicate detection, tracked per food — repeatedly seeing the same
  plate/bite across frames updates the running estimate instead of logging
  it again, while genuinely new food (a second helping) still counts
- **B6** confidence / uncertainty, carried at every stage instead of a false
  point estimate

Also logs an **estimated glycemic load** per meal (glycemic index × carbs,
from food composition) — explicitly not a measured blood glucose value; see
`docs/COMPLIANCE.md` for why that distinction matters for a diabetes-adjacent
feature, and where a real CGM/glucometer reading would attach instead.

## Modular by design

Every B-stage lives in its own file with no dependency on the others' guts
(`lens-studio/Assets/Scripts/PersonB/*.ts` — plain TypeScript, swap any one
implementation without touching the rest), and every stage is also reachable
as a plain HTTP call:

| Call | Stage(s) |
|---|---|
| `POST :4002/v1/food/classify` | B1 |
| `POST :4002/v1/portion/estimate` | B2 (hand-geometry method) |
| `POST :4001/nutrition/lookup`, `/nutrition/meal` | B3 |
| `POST :4002/v1/analyze` | the whole pipeline, one image in → full nutrition/glycemic/confidence out |

See `api/README.md` and `nutrition-service/README.md` for request/response
shapes.

## Layout

```
lens-studio/            Lens Studio project — the TS modules + the Lens-side wiring (B's entry point on Spectacles)
nutrition-service/       B3 — standalone HTTP nutrition lookup/scaling service
api/                     HTTP surface for B1/B2/B6 + the composed /v1/analyze pipeline (real vision backend)
examples/demo.ts         Whole pipeline end-to-end in plain Node, mocked vision (no API key, no Lens Studio needed)
test-images/              Drop food photos here, run api's analyze-folder script, get a visual results report
docs/
  ARCHITECTURE.md         How the pieces fit together, and every documented MVP simplification
  SCREEN_RECORDING.md      How the Spectacles recording composites the HUD over the camera view
  COMPLIANCE.md            Practical Spectacles/Lens Studio compliance notes
```

## Try it with real food photos

```bash
cd nutrition-service && npm install && npm run dev              # terminal 1 — B3
cd api && npm install && ANTHROPIC_API_KEY=sk-ant-... npm run dev  # terminal 2 — B1/B2/B6 + /v1/analyze
# drop .jpg/.jpeg/.png/.webp photos into test-images/, then:
cd api && npm run analyze-folder                                 # terminal 3
```

Opens up `test-images/results.html` with one card per photo — detected
foods, estimated weights, kcal/macros, estimated glycemic load, and
confidence. See `test-images/README.md`.

## Try it without any API key

```bash
cd nutrition-service && npm install && npm run dev   # terminal 1
cd examples && npm install && npm start               # terminal 2
```

Runs the same pipeline against a scripted mock vision backend instead of a
real photo — see `examples/README.md`.

## Status / what's stubbed

- `nutrition-service`'s food database is a small hand-seeded table (~16
  foods), a placeholder for a licensed nutrition data source.
- `api/`'s vision backend (`ClaudeVisionClassifier`) requires
  `ANTHROPIC_API_KEY` in the environment; without it, `/v1/food/classify` and
  `/v1/analyze` fail per-request with a clear error (everything else still
  works).
- Integration with Person A's actual hand/eating detector and Spectacles hand
  tracking isn't wired up here — `EatingEventInput` (`Types.ts`) is the
  contract A is expected to call B with.

See `docs/ARCHITECTURE.md` for the full list of documented MVP tradeoffs.
