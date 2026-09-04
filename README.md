# vibe-hackathon — calorie & nutrition tracker (Person B)

Snap Spectacles Lens (Lens Studio), calorie/nutrition tracking. Person A
detects "food is in the hand" eating events; this repo implements what
happens next — Person B's side:

- **B1** food recognition
- **B2** portion estimation (using the hand as a scale reference)
- **B3** nutrition engine (a separate service — food + grams → macros)
- **B4** meal aggregation (bites grouped into one eating session)
- **B5** duplicate detection (repeated looks at the same bite don't get
  logged twice)
- **B6** confidence / uncertainty, carried at every stage instead of a false
  point estimate

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
