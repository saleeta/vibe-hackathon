/**
 * Shared data contracts for the nutrition pipeline (food recognition ->
 * portion -> nutrition -> session aggregation -> confidence). Plain data
 * only, no Lens Studio SDK types here, so every file in this folder is
 * portable and unit-testable outside Lens Studio.
 *
 * The perception side's eating-event contract lives in `Core/PerceptionTypes.ts`'s
 * `EatingEventPayload`/`FoodAnalysisResult`, and `Capture/FoodAnalysisClient.ts`'s
 * `IFoodAnalysisClient` — `api/`'s server is what implements that contract's
 * backend side. See docs/ARCHITECTURE.md for how the two meet.
 */

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Image width/height these pixel coords are relative to. */
  imageWidth: number;
  imageHeight: number;
}

export interface HandObservation {
  /** Distance from the camera to the hand/food, in meters (world or depth-derived). */
  distanceMeters: number;
  /** Pixel width of the hand at that distance, used to derive a px-per-cm scale. */
  handPixelWidth: number;
  /** Known real-world hand width in cm — a per-user calibration value, defaulted if absent. */
  handWidthCm?: number;
}

export interface FoodCandidate {
  name: string;
  confidence: number;
}

/**
 * One detected food region in a frame, with its own box and ranked
 * candidates. A single food-in-hand frame produces one region; a plate
 * produces one region per food on it (rice, chicken, broccoli, sauce...).
 */
export interface FoodRegionDetection {
  boundingBox: BoundingBox;
  candidates: FoodCandidate[];
  /**
   * Optional direct portion estimate from the classifier backend itself
   * (weight in grams + its own confidence) — used when there's no hand in
   * frame to use as a scale reference (e.g. a flat test photo of a plate),
   * as an alternative to PortionEstimator's hand-geometry math.
   */
  visionPortionEstimate?: VisionPortionEstimate;
  /**
   * Optional per-100g micronutrient estimate from the vision backend, for the
   * Nutri-Score grade (Nutrition/NutriScore.ts). The local food table only
   * carries macros + GI, so these come from the model's visual estimate.
   */
  visionMicros?: VisionMicros;
  /**
   * Whether the vision backend judged this specific food to be held in / touched
   * by a visible hand. Used by the live Lens path (Capture/GeminiFoodAnalysisClient)
   * as the real "food in hand" gate — a plate in the background never gets a
   * nutrition card. Undefined for backends that don't report it (e.g. the
   * test-photo path, where "in hand" doesn't apply).
   */
  heldInHand?: boolean;
}

export interface VisionPortionEstimate {
  estimatedWeightG: number;
  confidence: number;
}

/** Vision-estimated micronutrients, all PER 100 g of the food. Feeds NutriScore. */
export interface VisionMicros {
  sugarsG100: number;
  satFatG100: number;
  sodiumMg100: number;
  fibreG100: number;
  /** Fruit / vegetable / legume / nut content of this item, 0–100 (%). */
  plantPercent: number;
}

/** A region resolved down to its top candidate — B2/B4 only care about this. */
export interface RecognizedFoodItem {
  boundingBox: BoundingBox;
  food: string;
  confidence: number;
  visionPortionEstimate?: VisionPortionEstimate;
  visionMicros?: VisionMicros;
  heldInHand?: boolean;
}

export interface PortionEstimate {
  food: string;
  estimatedWeightG: number;
  /** Symmetric uncertainty band, e.g. 25 means "±25g". Never presented to the user as exact. */
  uncertaintyG: number;
  confidence: number;
}

export interface NutritionFacts {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export interface ScaledNutrition extends NutritionFacts {
  food: string;
  weightG: number;
  /** False when the nutrition engine fell back to a generic/unknown-food estimate. */
  matched: boolean;
  /** Estimated glycemic load contribution of this item — see GlycemicEstimate. */
  glycemicLoad?: number;
}

/**
 * Estimated, food-composition-only glycemic impact — glycemic load (GI ×
 * carbs / 100), NOT a blood glucose reading. This is a rough population-level
 * heuristic, not personalized (no insulin sensitivity, no individual glucose
 * response curve), and must never be presented as, or used in place of, an
 * actual measured glucose value. See MeasuredGlucoseReading for that.
 */
export interface GlycemicEstimate {
  totalGlycemicLoad: number;
  category: "low" | "medium" | "high";
  /** True if every item in the meal matched a known GI value; false if any fell back to a generic estimate. */
  allFoodsMatched: boolean;
}

/**
 * An actual measured blood glucose value (fingerstick or CGM), attached to a
 * session from a real device integration — not something this pipeline can
 * derive from an image. Present so a real reading and the food-derived
 * GlycemicEstimate can be logged side by side without conflating the two.
 */
export interface MeasuredGlucoseReading {
  mgPerDl: number;
  timestampSec: number;
  source: "cgm" | "fingerstick" | "manual";
}

/** One food item as tracked within an eating session — the unit B4/B5 dedupe against. */
export interface SessionFoodItem {
  food: string;
  weightG: number;
  weightUncertaintyG: number;
  portionConfidence: number;
  foodConfidence: number;
  firstSeenSec: number;
  lastSeenSec: number;
  observationCount: number;
  nutrition?: ScaledNutrition;
}

export interface ConfidenceBreakdown {
  eatingConfidence: number;
  foodConfidence: number;
  portionConfidence: number;
  overall: number;
}

export type EatingSessionStatus = "open" | "closed";

export interface EatingSession {
  id: string;
  startedSec: number;
  lastUpdateSec: number;
  closedSec?: number;
  status: EatingSessionStatus;
  items: SessionFoodItem[];
}

export interface MealSummary {
  sessionId: string;
  startedSec: number;
  closedSec: number;
  items: SessionFoodItem[];
  totals: NutritionFacts;
  confidence: ConfidenceBreakdown;
  /** Estimated from food composition — not a measured glucose value. */
  glycemicEstimate?: GlycemicEstimate;
  /** Only present if a real glucose sensor/device is integrated and reported a reading for this session. */
  measuredGlucose?: MeasuredGlucoseReading;
  /** Vision-estimated micronutrients for the meal, per serving (summed). See Nutrition/NutriProfile.ts. */
  micros?: { sugarsG: number; satFatG: number; sodiumMg: number; fiberG: number };
  /** Nutri-Score grade (A–E) for the primary food. A composition estimate, not a health verdict. */
  nutriScore?: {
    grade: 'A' | 'B' | 'C' | 'D' | 'E';
    points: number;
    color: { r: number; g: number; b: number };
  };
}
