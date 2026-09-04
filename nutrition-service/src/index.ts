import express, { Request, Response } from "express";
import { lookupFood } from "./lookup";
import { scaleNutrition, sumNutrition, classifyGlycemicLoad } from "./scale";

const app = express();
app.use(express.json());

const PORT = process.env.PORT ? Number(process.env.PORT) : 4001;

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

/**
 * B3 — Food + grams -> scaled nutrition (+ estimated glycemic load).
 * Body: { "food": "banana", "weightG": 118 }
 */
app.post("/nutrition/lookup", (req: Request, res: Response) => {
  const { food, weightG } = req.body ?? {};
  if (typeof food !== "string" || typeof weightG !== "number" || weightG < 0) {
    res.status(400).json({ error: "expected { food: string, weightG: number }" });
    return;
  }

  const { food: matchedName, per100g, matched } = lookupFood(food);
  const nutrition = scaleNutrition(per100g, weightG);

  res.json({ food: matchedName, weightG, matched, ...nutrition });
});

/**
 * B3/B4 support — nutrition (+ meal-level glycemic load estimate) for a
 * whole finalized meal (list of items).
 * Body: { "items": [{ "food": "chicken", "weightG": 180 }, { "food": "rice", "weightG": 150 }] }
 *
 * `glycemicEstimate` is derived purely from food composition — it is NOT a
 * measured blood glucose value. See scale.ts:classifyGlycemicLoad for why
 * the low/medium/high bands read differently for a whole meal than for a
 * single food, and treat this as a rough relative indicator only.
 */
app.post("/nutrition/meal", (req: Request, res: Response) => {
  const items = req.body?.items;
  if (!Array.isArray(items)) {
    res.status(400).json({ error: "expected { items: Array<{ food: string, weightG: number }> }" });
    return;
  }

  let allFoodsMatched = true;
  const perItem = items.map((item: { food: string; weightG: number }) => {
    const { food: matchedName, per100g, matched } = lookupFood(item.food);
    if (!matched) allFoodsMatched = false;
    return { food: matchedName, weightG: item.weightG, matched, ...scaleNutrition(per100g, item.weightG) };
  });

  const totals = sumNutrition(perItem);

  res.json({
    items: perItem,
    totals,
    glycemicEstimate: {
      totalGlycemicLoad: totals.glycemicLoad,
      category: classifyGlycemicLoad(totals.glycemicLoad),
      allFoodsMatched,
    },
  });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`nutrition-service listening on :${PORT}`);
});
