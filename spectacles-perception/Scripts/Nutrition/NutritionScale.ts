/**
 * Scales per-100g nutrition reference values (NutritionLookup.ts) to an
 * actual estimated portion weight, and derives a glycemic-load estimate.
 */

import { NutritionFacts } from './NutritionLookup';

export interface ScaledFoodNutrition {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  /** GI x scaled-carbs / 100 for this item — see classifyGlycemicLoad for the important caveats. */
  glycemicLoad: number;
}

/** Scales per-100g reference values (and derives glycemic load) to an actual portion weight. */
export function scaleNutrition(per100g: NutritionFacts, weightG: number): ScaledFoodNutrition {
  const factor = weightG / 100;
  const carbsG = round(per100g.carbsG * factor, 1);
  return {
    kcal: round(per100g.kcal * factor, 0),
    proteinG: round(per100g.proteinG * factor, 1),
    carbsG,
    fatG: round(per100g.fatG * factor, 1),
    glycemicLoad: round((per100g.gi * carbsG) / 100, 1),
  };
}

export function sumNutrition(items: ScaledFoodNutrition[]): ScaledFoodNutrition {
  return items.reduce(
    (total, item) => ({
      kcal: round(total.kcal + item.kcal, 0),
      proteinG: round(total.proteinG + item.proteinG, 1),
      carbsG: round(total.carbsG + item.carbsG, 1),
      fatG: round(total.fatG + item.fatG, 1),
      glycemicLoad: round(total.glycemicLoad + item.glycemicLoad, 1),
    }),
    { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, glycemicLoad: 0 }
  );
}

/**
 * Standard glycemic load bands (low <=10, medium 11-19, high >=20) are
 * defined per single food serving, not per whole multi-food meal — summing
 * several items over a plate will land "high" far more often than any one
 * food would on its own. Treat this as a rough, relative day-to-day
 * indicator only, never as a clinical/diagnostic category, and never as a
 * substitute for a measured glucose reading (see MeasuredGlucoseReading in
 * Types.ts).
 */
export function classifyGlycemicLoad(totalGlycemicLoad: number): 'low' | 'medium' | 'high' {
  if (totalGlycemicLoad <= 10) return 'low';
  if (totalGlycemicLoad <= 20) return 'medium';
  return 'high';
}

function round(v: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(v * factor) / factor;
}
