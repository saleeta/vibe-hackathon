import foodsDb from "./db/foods.json";

export interface NutritionFacts {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  /** Glycemic index (0-100), per 100g reference. 0 for foods with negligible carbs. */
  gi: number;
}

/** Aliases for common phrasing variance from B1's food labels. */
const ALIASES: Record<string, string> = {
  veggies: "vegetables",
  veggie: "vegetables",
  greens: "salad",
  "chicken breast": "chicken",
  "grilled chicken": "chicken",
  "white rice": "rice",
  "brown rice": "rice",
};

export interface LookupResult {
  food: string;
  per100g: NutritionFacts;
  /** False when we fell back to the generic "unknown" entry — caller should down-weight confidence. */
  matched: boolean;
}

export function lookupFood(rawName: string): LookupResult {
  const key = normalize(rawName);
  const db = foodsDb as Record<string, NutritionFacts>;

  if (db[key]) {
    return { food: key, per100g: db[key], matched: true };
  }
  return { food: key, per100g: db["unknown"], matched: false };
}

function normalize(rawName: string): string {
  const lower = rawName.trim().toLowerCase();
  return ALIASES[lower] ?? lower;
}
