# nutrition-service (B3)

Standalone HTTP service: `food name + grams -> kcal/protein/carbs/fat`. Kept out
of the Lens on purpose — Spectacles apps should avoid bundling a food database
and heavy compute on-device, and this lets the DB be swapped for USDA
FoodData Central (or similar) without touching the Lens.

```
Food ---> Nutrition lookup ---> Portion scaling ---> Meal nutrition
```

## Run

```bash
npm install
npm run dev        # ts-node, no build step
# or
npm run build && npm start
```

Defaults to `http://localhost:4001`.

## Endpoints

`POST /nutrition/lookup`
```json
{ "food": "banana", "weightG": 118 }
```
```json
{ "food": "banana", "weightG": 118, "matched": true, "kcal": 105, "proteinG": 1.3, "carbsG": 26.9, "fatG": 0.4, "glycemicLoad": 13.7 }
```

`POST /nutrition/meal` — sums a whole finalized eating session (B4), one
plate/session logged as one entry:
```json
{ "items": [{ "food": "chicken", "weightG": 180 }, { "food": "rice", "weightG": 150 }] }
```
returns per-item breakdown, `totals`, and `glycemicEstimate`:
```json
{
  "items": [ ... ],
  "totals": { "kcal": 492, "proteinG": 59.9, "carbsG": 42.3, "fatG": 7.0, "glycemicLoad": 30.9 },
  "glycemicEstimate": { "totalGlycemicLoad": 30.9, "category": "high", "allFoodsMatched": true }
}
```

`GET /health`

## Data

`src/db/foods.json` is a small seed table (per-100g macros + glycemic index
for ~16 common foods) so the pipeline is demoable end-to-end. It is a
placeholder for a real nutrition API (USDA FoodData Central, Nutritionix,
Edamam, etc.) — swap the lookup in `src/lookup.ts` for a live call when one
is wired up. Unmatched food names fall back to a generic `"unknown"` entry
and are flagged `matched: false` so B6 can discount confidence accordingly.

## Glycemic load — read this before showing it to anyone

`glycemicLoad`/`glycemicEstimate` is computed purely from food composition
(`GI × carbs / 100`), **not measured**. It is not blood glucose, it is not
personalized, and the standard low/≤10 · medium/11-19 · high/≥20 bands were
defined per single food serving — summed across a whole mixed meal they will
read "high" far more often than any individual food would. Treat it as a
rough, relative, non-diagnostic indicator only. See
`../docs/COMPLIANCE.md` for the full list of things not to do with this
number (never label it "blood sugar," never feed it into any dosing
suggestion). A real blood-glucose reading requires a real sensor
integration — this field is not a substitute for one.
