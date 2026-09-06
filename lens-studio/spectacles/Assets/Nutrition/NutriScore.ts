/**
 * Nutri-Score — the A–E front-of-pack nutrition grade used across the EU
 * (France, Germany, Belgium, ...). A single score computed from nutritional
 * values **per 100 g**: add "negative" points for nutrients to limit (energy,
 * sugars, saturated fat, sodium), subtract "positive" points for beneficial
 * ones (fibre, protein, fruit/veg/legume content), map the total to a letter
 * and its official colour.
 *
 * This is the standard 2017 algorithm. Solid foods and beverages have
 * different official point tables and grade cutoffs (beverages are graded
 * much harder on sugar/energy — only water can be an A), and both are
 * implemented here; `nutriScoreForFood` picks the table from the food name.
 * It's a population-level composition heuristic, not a personalised health
 * verdict — same "estimate" framing as this project's glycemic load (see
 * docs/COMPLIANCE.md).
 *
 * Pure data-in/data-out, no Lens Studio dependency — unit-testable in plain
 * Node like the rest of Nutrition/.
 */

export type NutriGrade = 'A' | 'B' | 'C' | 'D' | 'E';

/** All values are PER 100 g of the food. */
export interface NutriScoreInput {
  energyKcal: number;
  sugarsG: number;
  satFatG: number;
  sodiumMg: number;
  fibreG: number;
  proteinG: number;
  /** Fruit / vegetable / legume / nut content, 0–100 (%). */
  plantPercent: number;
}

export interface NutriScoreResult {
  grade: NutriGrade;
  /** Raw Nutri-Score points (negative − positive). Lower is healthier. */
  points: number;
  /** Official Nutri-Score colour for the grade, linear 0–1 RGB. */
  color: { r: number; g: number; b: number };
}

const GRADE_COLORS: Record<NutriGrade, { r: number; g: number; b: number }> = {
  A: rgb(0x03, 0x81, 0x41),
  B: rgb(0x85, 0xbb, 0x2f),
  C: rgb(0xfe, 0xcb, 0x02),
  D: rgb(0xee, 0x81, 0x00),
  E: rgb(0xe6, 0x3e, 0x11),
};

const KCAL_TO_KJ = 4.184;

/** Points for a value given ascending upper-bound thresholds; index i means "<= thresholds[i]". */
function pointsFor(value: number, thresholds: number[]): number {
  for (let i = 0; i < thresholds.length; i++) {
    if (value <= thresholds[i]) return i;
  }
  return thresholds.length;
}

// Negative-nutrient tables (0..10) — solid foods.
const ENERGY_KJ_THRESHOLDS = [335, 670, 1005, 1340, 1675, 2010, 2345, 2680, 3015, 3350];
const SUGARS_G_THRESHOLDS = [4.5, 9, 13.5, 18, 22.5, 27, 31, 36, 40, 45];
const SAT_FAT_G_THRESHOLDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const SODIUM_MG_THRESHOLDS = [90, 180, 270, 360, 450, 540, 630, 720, 810, 900];

// Beverages: stricter energy + sugar tables (per 100 mL ≈ per 100 g), same
// sat-fat / sodium tables as solids.
const BEV_ENERGY_KJ_THRESHOLDS = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270];
const BEV_SUGARS_G_THRESHOLDS = [0, 1.5, 3, 4.5, 6, 7.5, 9, 10.5, 12, 13.5];

// Positive-nutrient tables.
const FIBRE_G_THRESHOLDS = [0.9, 1.9, 2.8, 3.7, 4.7]; // AOAC, 0..5
const PROTEIN_G_THRESHOLDS = [1.6, 3.2, 4.8, 6.4, 8.0]; // 0..5

/** Fruit/veg/legume % → 0, 1, 2 or 5 points (there is no 3 or 4). */
function plantPoints(percent: number): number {
  if (percent > 80) return 5;
  if (percent > 60) return 2;
  if (percent > 40) return 1;
  return 0;
}

function gradeForSolidFood(score: number): NutriGrade {
  if (score <= -1) return 'A';
  if (score <= 2) return 'B';
  if (score <= 10) return 'C';
  if (score <= 18) return 'D';
  return 'E';
}

/** Beverage grade cutoffs — water is A-only, handled by the caller; everything else starts at B. */
function gradeForBeverage(score: number): NutriGrade {
  if (score <= 1) return 'B';
  if (score <= 5) return 'C';
  if (score <= 9) return 'D';
  return 'E';
}

export function computeNutriScore(input: NutriScoreInput, kind: 'solid' | 'beverage' = 'solid'): NutriScoreResult {
  const isBev = kind === 'beverage';
  const energyKj = Math.max(0, input.energyKcal) * KCAL_TO_KJ;

  const negative =
    pointsFor(energyKj, isBev ? BEV_ENERGY_KJ_THRESHOLDS : ENERGY_KJ_THRESHOLDS) +
    pointsFor(Math.max(0, input.sugarsG), isBev ? BEV_SUGARS_G_THRESHOLDS : SUGARS_G_THRESHOLDS) +
    pointsFor(Math.max(0, input.satFatG), SAT_FAT_G_THRESHOLDS) +
    pointsFor(Math.max(0, input.sodiumMg), SODIUM_MG_THRESHOLDS);

  const fibrePoints = pointsFor(Math.max(0, input.fibreG), FIBRE_G_THRESHOLDS);
  const proteinPoints = pointsFor(Math.max(0, input.proteinG), PROTEIN_G_THRESHOLDS);
  const fruitPoints = plantPoints(clampPercent(input.plantPercent));

  // Official rule: once negative points reach 11, protein only counts if the
  // food is already scoring full fruit/veg points — stops high-protein junk
  // (processed meats, cheese) from grading itself up.
  const proteinCounts = negative < 11 || fruitPoints === 5;
  const positive = fibrePoints + fruitPoints + (proteinCounts ? proteinPoints : 0);

  const points = negative - positive;
  const grade = isBev ? gradeForBeverage(points) : gradeForSolidFood(points);

  return { grade, points, color: GRADE_COLORS[grade] };
}

/** Plain water / unsweetened black coffee/tea — the only "beverages" that can be an A. */
export function isAlwaysGradeAFood(foodName: string): boolean {
  const key = (foodName ?? '').trim().toLowerCase();
  return (
    key === 'water' ||
    key === 'sparkling water' ||
    key === 'mineral water' ||
    key === 'black coffee' ||
    key === 'coffee' ||
    key === 'tea' ||
    key === 'green tea' ||
    key === 'herbal tea'
  );
}

const BEVERAGE_NAMES = new Set([
  'soda',
  'soft drink',
  'cola',
  'pop',
  'lemonade',
  'juice',
  'orange juice',
  'apple juice',
  'fruit juice',
  'energy drink',
  'sports drink',
  'iced tea',
  'sweet tea',
  'milkshake',
  'smoothie',
  'cordial',
  'squash',
  'tonic',
  'tonic water',
  'milk',
  'beer',
  'wine',
]);

/** Whether a food name should be graded on the (stricter) beverage table. */
export function isBeverage(foodName: string): boolean {
  return BEVERAGE_NAMES.has((foodName ?? '').trim().toLowerCase());
}

export function nutriScoreForFood(foodName: string, input: NutriScoreInput): NutriScoreResult {
  if (isAlwaysGradeAFood(foodName)) {
    return { grade: 'A', points: -Infinity, color: GRADE_COLORS.A };
  }
  return computeNutriScore(input, isBeverage(foodName) ? 'beverage' : 'solid');
}

function clampPercent(v: number): number {
  if (!isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

function rgb(r: number, g: number, b: number): { r: number; g: number; b: number } {
  return { r: r / 255, g: g / 255, b: b / 255 };
}
