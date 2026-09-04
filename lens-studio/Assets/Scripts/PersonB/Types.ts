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
   * Pixel bounding box of the food/object in the hand. Required — B2's
   * portion estimate is a function of this box's real-world footprint, so
   * there's no meaningful fallback if A can't provide one for a given frame
   * (drop the frame instead of calling in with an undefined box).
   */
  foodBoundingBox: BoundingBox;
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

export interface FoodRecognitionResult {
  food: FoodCandidate[];
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
}
