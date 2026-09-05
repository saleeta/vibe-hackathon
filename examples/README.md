# Nutrition pipeline end-to-end demo

Runs recognition → portion → aggregation/dedup → nutrition lookup →
confidence in plain Node, simulating a meal over several
detected frames:

- a bite of chicken, seen twice in a row (must not double count)
- a **plate** — rice + broccoli + sauce detected together in one frame — seen
  twice in a row (must not double count any of the three foods either)
- a separate, later handful of chicken (must count as new intake)

All of it closes as one eating session — one set of logged calories — with
one nutrition total and one estimated glycemic load. No Lens Studio or
hardware needed.

```bash
# terminal 1
cd ../nutrition-service
npm install
npm run dev

# terminal 2
cd examples
npm install
npm start
```

Expected shape of the output: per-frame confidence lines, a pre-close session
table, then the closed `Eating Session` with per-food weights, macro totals,
a confidence breakdown (eating/food/portion/overall), and an estimated
glycemic load (explicitly labeled as food-derived, not a measured reading).
