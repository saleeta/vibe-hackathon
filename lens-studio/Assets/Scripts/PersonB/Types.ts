/**
 * Shared data contracts for Person B's pipeline (food recognition -> portion ->
 * nutrition -> session aggregation -> confidence). Plain data only, no Lens
 * Studio SDK types here, so this file — and everything else in PersonB/ except
 * PersonBController.ts — is portable and unit-testable outside Lens Studio.
 */

/** What Person A hands off when their eating-event detector fires. */
export interface EatingEventInput {
  /** Timestamp in seconds, e.g. Date.now() / 1000 or getTime()-based. */
  timestampSec: number;
  /** Confidence that this is actually a hand-to-mouth eating event (from A). */
  eatingConfidence: number;
  /** Encoded still frame (base64) captured at the moment of detection. */
  imageBase64: string;
  /**
   * A's rough hand-proximity region — a crop/attention hint for the food
   * classifier, not used directly for portion math. B1 does its own
   * per-food localization (see FoodRegionDetection) because a single frame
   * can show several foods at once (a plate), each needing its own box for
   * B2's portion estimate.
   */
  roiHint?: BoundingBox;
  /** Hand geometry A observed at detection time — used as a scale reference. */
  hand: HandObservation;
}

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
}

/** A region resolved down to its top candidate — B2/B4 only care about this. */
export interface RecognizedFoodItem {
  boundingBox: BoundingBox;
  food: string;
  confidence: number;
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
}
