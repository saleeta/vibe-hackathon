# vibe-hackathon — calorie & nutrition tracker (Person B)

Snap Spectacles Lens (Lens Studio), calorie/nutrition tracking. Person A
detects "food is in the hand" eating events; this repo implements what
happens next — Person B's side:

- **B1** food recognition — one detection per food in a frame, so a plate
  (rice + chicken + broccoli + sauce) is recognized as multiple simultaneous
  items, not just one
- **B2** portion estimation (using the hand as a scale reference)
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

## Layout

```
lens-studio/           Lens Studio project — B1, B2, B4, B5, B6 + the Lens-side wiring (B's entry point)
nutrition-service/      B3 — standalone HTTP nutrition lookup/scaling service
examples/demo.ts        Runs the whole pipeline end-to-end in plain Node (no hardware/Lens Studio needed)
docs/
  ARCHITECTURE.md        How the pieces fit together, and every documented MVP simplification
  SCREEN_RECORDING.md     How the Spectacles recording composites the HUD over the camera view
  COMPLIANCE.md           Practical Spectacles/Lens Studio compliance notes
```

## Quickest way to see it work

```bash
cd nutrition-service && npm install && npm run dev   # terminal 1
cd examples && npm install && npm start               # terminal 2
```

See `examples/README.md` for what to expect.

## Status / what's stubbed

- The B1 food classifier backend is pluggable (`HttpFoodClassifierBackend`)
  but not pointed at a real vision model yet — `FOOD_CLASSIFIER_ENDPOINT` in
  `PersonBController.ts` is a placeholder. `MockFoodClassifierBackend` stands
  in for demos/tests.
- `nutrition-service`'s food database is a small hand-seeded table (~16
  foods), a placeholder for a licensed nutrition data source.
- Integration with Person A's actual hand/eating detector and Spectacles hand
  tracking isn't wired up here — `EatingEventInput` (`Types.ts`) is the
  contract A is expected to call B with.

See `docs/ARCHITECTURE.md` for the full list of documented MVP tradeoffs.
