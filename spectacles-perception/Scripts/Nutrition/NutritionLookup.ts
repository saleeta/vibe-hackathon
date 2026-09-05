/**
 * Small hand-seeded food nutrition table + lookup, so the fully-on-device
 * Gemini pipeline (GeminiFoodAnalysisClient.ts) can run end-to-end with zero
 * network dependency beyond the Gemini vision call itself (which
 * RemoteServiceGateway handles without a self-hosted server/tunnel).
 *
 * This is a placeholder data source, not a licensed nutrition database —
 * good enough for a demo, not for real dietary tracking.
 */

export interface NutritionFacts {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  /** Glycemic index (0-100), per 100g reference. 0 for foods with negligible carbs. */
  gi: number;
}

const FOODS_DB: Record<string, NutritionFacts> = {
  banana: { kcal: 89, proteinG: 1.1, carbsG: 22.8, fatG: 0.3, gi: 51 },
  apple: { kcal: 52, proteinG: 0.3, carbsG: 13.8, fatG: 0.2, gi: 36 },
  rice: { kcal: 130, proteinG: 2.7, carbsG: 28.2, fatG: 0.3, gi: 73 },
  chicken: { kcal: 165, proteinG: 31.0, carbsG: 0.0, fatG: 3.6, gi: 0 },
  broccoli: { kcal: 35, proteinG: 2.4, carbsG: 7.2, fatG: 0.4, gi: 10 },
  vegetables: { kcal: 40, proteinG: 2.0, carbsG: 8.0, fatG: 0.3, gi: 15 },
  sauce: { kcal: 60, proteinG: 3.0, carbsG: 8.0, fatG: 1.5, gi: 50 },
  egg: { kcal: 155, proteinG: 13.0, carbsG: 1.1, fatG: 11.0, gi: 0 },
  bread: { kcal: 265, proteinG: 9.0, carbsG: 49.0, fatG: 3.2, gi: 75 },
  baguette: { kcal: 274, proteinG: 9.0, carbsG: 55.0, fatG: 1.5, gi: 75 },
  pasta: { kcal: 131, proteinG: 5.0, carbsG: 25.0, fatG: 1.1, gi: 50 },
  beef: { kcal: 250, proteinG: 26.0, carbsG: 0.0, fatG: 15.0, gi: 0 },
  salmon: { kcal: 208, proteinG: 20.0, carbsG: 0.0, fatG: 13.0, gi: 0 },
  salad: { kcal: 15, proteinG: 1.4, carbsG: 2.9, fatG: 0.2, gi: 15 },
  cheese: { kcal: 403, proteinG: 25.0, carbsG: 1.3, fatG: 33.0, gi: 0 },
  potato: { kcal: 93, proteinG: 2.5, carbsG: 21.0, fatG: 0.1, gi: 78 },
  avocado: { kcal: 160, proteinG: 2.0, carbsG: 8.5, fatG: 14.7, gi: 15 },
  water: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, gi: 0 },
  coffee: { kcal: 2, proteinG: 0.3, carbsG: 0, fatG: 0, gi: 0 },
  milk: { kcal: 42, proteinG: 3.4, carbsG: 5.0, fatG: 1.0, gi: 39 },
  juice: { kcal: 45, proteinG: 0.5, carbsG: 10.5, fatG: 0.1, gi: 50 },
  soda: { kcal: 41, proteinG: 0, carbsG: 10.6, fatG: 0, gi: 63 },
  wine: { kcal: 83, proteinG: 0.1, carbsG: 2.6, fatG: 0, gi: 0 },
  beer: { kcal: 43, proteinG: 0.5, carbsG: 3.6, fatG: 0, gi: 0 },
  unknown: { kcal: 150, proteinG: 5.0, carbsG: 15.0, fatG: 6.0, gi: 55 },
};

/** Aliases for common phrasing variance from food-recognition's labels. */
const ALIASES: Record<string, string> = {
  veggies: 'vegetables',
  veggie: 'vegetables',
  greens: 'salad',
  'chicken breast': 'chicken',
  'grilled chicken': 'chicken',
  'white rice': 'rice',
  'brown rice': 'rice',
  baguette_bread: 'baguette',
  'french bread': 'baguette',
  drink: 'water',
  beverage: 'water',
  'soft drink': 'soda',
  pop: 'soda',
};

export interface LookupResult {
  food: string;
  per100g: NutritionFacts;
  /** False when we fell back to the generic "unknown" entry — caller should down-weight confidence. */
  matched: boolean;
}

export function lookupFood(rawName: string): LookupResult {
  const key = normalize(rawName);
  if (FOODS_DB[key]) {
    return { food: key, per100g: FOODS_DB[key], matched: true };
  }
  return { food: key, per100g: FOODS_DB.unknown, matched: false };
}

function normalize(rawName: string): string {
  const lower = rawName.trim().toLowerCase();
  return ALIASES[lower] ?? lower;
}
