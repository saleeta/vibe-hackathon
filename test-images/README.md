# test-images

Drop photos of plates/food here (`.jpg`, `.jpeg`, `.png`, `.webp`) — top-down
or angled shots, doesn't need to be from Spectacles or have a hand in frame.

## Run

Three terminals, from the repo root:

```bash
# 1. nutrition engine (B3)
cd nutrition-service && npm install && npm run dev

# 2. the API (B1-B6) — needs a real Anthropic key for the vision step
cd api && npm install
ANTHROPIC_API_KEY=sk-ant-... npm run dev

# 3. batch-analyze everything in this folder
cd api && npm run analyze-folder
```

That writes `results.json` and `results.html` right here in `test-images/`.
Open `results.html` in a browser — one card per photo, with the detected
foods, estimated weights, kcal/macros, estimated glycemic load, and the
confidence breakdown. It's also printed as a table in the terminal.

## Notes

- Portion weight comes from the vision model's own visual estimate (plate
  size, typical serving sizes) — there's no hand in a flat photo to use as a
  scale reference the way a live Spectacles capture would. See
  `../docs/ARCHITECTURE.md` for both portion-estimation paths.
- Photos you drop here, and the generated `results.json`/`results.html`, are
  git-ignored — they're your own local test data and are never committed.
- If a food isn't in the nutrition seed database
  (`../nutrition-service/src/db/foods.json`), it still gets logged, just
  flagged `matched: false` and given a generic nutrition estimate.
