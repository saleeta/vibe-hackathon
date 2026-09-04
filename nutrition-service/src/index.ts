import express, { Request, Response } from "express";
import { lookupFood } from "./lookup";
import { scaleNutrition, sumNutrition } from "./scale";

const app = express();
app.use(express.json());

const PORT = process.env.PORT ? Number(process.env.PORT) : 4001;

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

/**
 * B3 — Food + grams -> scaled nutrition.
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
 * B3/B4 support — nutrition for a whole finalized meal (list of items).
 * Body: { "items": [{ "food": "chicken", "weightG": 180 }, { "food": "rice", "weightG": 150 }] }
 */
app.post("/nutrition/meal", (req: Request, res: Response) => {
  const items = req.body?.items;
  if (!Array.isArray(items)) {
    res.status(400).json({ error: "expected { items: Array<{ food: string, weightG: number }> }" });
    return;
  }

  const perItem = items.map((item: { food: string; weightG: number }) => {
    const { food: matchedName, per100g, matched } = lookupFood(item.food);
    return { food: matchedName, weightG: item.weightG, matched, ...scaleNutrition(per100g, item.weightG) };
  });

  res.json({ items: perItem, totals: sumNutrition(perItem) });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`nutrition-service listening on :${PORT}`);
});
