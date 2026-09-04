import { NutritionFacts } from "./lookup";

/** Scales per-100g reference values to an actual portion weight. */
export function scaleNutrition(per100g: NutritionFacts, weightG: number): NutritionFacts {
  const factor = weightG / 100;
  return {
    kcal: round(per100g.kcal * factor, 0),
    proteinG: round(per100g.proteinG * factor, 1),
    carbsG: round(per100g.carbsG * factor, 1),
    fatG: round(per100g.fatG * factor, 1),
  };
}

export function sumNutrition(items: NutritionFacts[]): NutritionFacts {
  return items.reduce(
    (total, item) => ({
      kcal: round(total.kcal + item.kcal, 0),
      proteinG: round(total.proteinG + item.proteinG, 1),
      carbsG: round(total.carbsG + item.carbsG, 1),
      fatG: round(total.fatG + item.fatG, 1),
    }),
    { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 }
  );
}

function round(v: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(v * factor) / factor;
}
