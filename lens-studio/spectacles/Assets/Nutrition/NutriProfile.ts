/**
 * Per-serving micronutrient totals + the primary food's Nutri-Score grade,
 * derived from the vision backend's per-100g micro estimates plus the local
 * food table's energy/protein. Shared by both analyze paths — the on-device
 * one (Capture/GeminiFoodAnalysisClient) and the HTTP one
 * (api/src/pipeline/analyzePlateImage) — so a live eating event and a
 * test-photo upload grade a food identically.
 *
 * Pure data-in/data-out (imports only sibling Nutrition/ modules), so it runs
 * the same in plain Node and in the Lens.
 */

import { VisionMicros } from './Types';
import { lookupFood } from './NutritionLookup';
import { nutriScoreForFood, NutriScoreResult } from './NutriScore';

export interface MealMicroTotals {
  /** All per serving (summed across items), grams — except sodium, milligrams. */
  sugarsG: number;
  satFatG: number;
  sodiumMg: number;
  fiberG: number;
}

export interface MealNutriProfile {
  micros: MealMicroTotals;
  nutriScore: NutriScoreResult;
}

export function mealNutriProfile(
  items: Array<{ food: string; weightG: number }>,
  microsByFood: Map<string, VisionMicros>,
  primaryFood: string
): MealNutriProfile {
  let sugarsG = 0;
  let satFatG = 0;
  let sodiumMg = 0;
  let fiberG = 0;
  for (const item of items) {
    const m = microsByFood.get(item.food.toLowerCase());
    if (!m) continue;
    const f = item.weightG / 100;
    sugarsG += m.sugarsG100 * f;
    satFatG += m.satFatG100 * f;
    sodiumMg += m.sodiumMg100 * f;
    fiberG += m.fibreG100 * f;
  }

  const per100g = lookupFood(primaryFood).per100g;
  const primaryMicros = microsByFood.get(primaryFood.toLowerCase());
  const nutriScore = nutriScoreForFood(primaryFood, {
    energyKcal: per100g.kcal,
    sugarsG: primaryMicros?.sugarsG100 ?? 0,
    satFatG: primaryMicros?.satFatG100 ?? 0,
    sodiumMg: primaryMicros?.sodiumMg100 ?? 0,
    fibreG: primaryMicros?.fibreG100 ?? 0,
    proteinG: per100g.proteinG,
    plantPercent: primaryMicros?.plantPercent ?? 0,
  });

  return {
    micros: {
      sugarsG: round1(sugarsG),
      satFatG: round1(satFatG),
      sodiumMg: Math.round(sodiumMg),
      fiberG: round1(fiberG),
    },
    nutriScore,
  };
}

/** Builds the `food -> per-100g micros` map both paths need, from recognized items. */
export function microsByFood(items: Array<{ food: string; visionMicros?: VisionMicros }>): Map<string, VisionMicros> {
  const map = new Map<string, VisionMicros>();
  for (const item of items) {
    if (item.visionMicros) map.set(item.food.toLowerCase(), item.visionMicros);
  }
  return map;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
