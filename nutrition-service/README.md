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
{ "food": "banana", "weightG": 118, "matched": true, "kcal": 105, "proteinG": 1.3, "carbsG": 26.9, "fatG": 0.4 }
```

`POST /nutrition/meal` — sums a whole finalized eating session (B4):
```json
{ "items": [{ "food": "chicken", "weightG": 180 }, { "food": "rice", "weightG": 150 }] }
```
returns per-item breakdown plus `totals`.

`GET /health`

## Data

`src/db/foods.json` is a small seed table (per-100g macros for ~16 common
foods) so the pipeline is demoable end-to-end. It is a placeholder for a real
nutrition API (USDA FoodData Central, Nutritionix, Edamam, etc.) — swap the
lookup in `src/lookup.ts` for a live call when one is wired up. Unmatched food
names fall back to a generic `"unknown"` entry and are flagged `matched:
false` so B6 can discount confidence accordingly.
