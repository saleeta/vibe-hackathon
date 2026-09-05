/**
 * Shared types for the perception pipeline (camera sampling through the
 * eating-event state machine).
 *
 * Nothing in this file has side effects — it's safe to import from any
 * script, including the main app / nutrition-pipeline integration code.
 */

export enum HandSide {
  Left = 'left',
  Right = 'right',
}

/** Snapshot of one tracked hand at a point in time. */
export interface HandState {
  side: HandSide;
  isTracked: boolean;
  /** World-space palm position. Zero vector when !isTracked. */
  palmPosition: vec3;
  /** World-space index fingertip position. Used as the "pointer" for proximity checks. */
  indexTipPosition: vec3;
  /** Approximate world-space velocity (units/sec), smoothed. */
  velocity: vec3;
  timestampMillis: number;
}

export interface HandsSnapshot {
  left: HandState;
  right: HandState;
}

/** One detected object in a frame, from whatever object/food detector is plugged in (see IObjectDetector). */
export interface DetectedObject {
  label: string;
  confidence: number;
  /** Normalized [0-1] screen-space bounding box, origin top-left. */
  boundingBox: { x: number; y: number; width: number; height: number };
  /** Optional world-space position if the detector/backend can provide depth (e.g. world query hit-test). */
  worldPosition?: vec3;
  isFoodClass: boolean;
}

/** Output of the food-in-hand classifier — classification only, no side effects, no logging trigger. */
export interface FoodInHandResult {
  food_in_hand: boolean;
  food_object: string | null;
  confidence: number;
  hand: HandSide | null;
}

/** The eating-event state machine's states. Ordered — higher index = further along the eating sequence. */
export enum EatingState {
  NOT_EATING = 0,
  FOOD_DETECTED = 1,
  FOOD_IN_HAND = 2,
  EATING_EVENT = 3,
}

export interface EatingStateChange {
  previous: EatingState;
  next: EatingState;
  timestampMillis: number;
}

/** Fired once per confirmed bite — this is what triggers HQ frame capture + the backend call. */
export interface EatingEventPayload {
  food_object: string;
  confidence: number;
  timestampMillis: number;
}

/**
 * What the nutrition backend hands back after analyzing the HQ frame — one
 * eating event, one food (the largest/primary one if the frame showed more
 * than one, e.g. a visible plate). `name`/`grams`/`kcal`/`confidence` are the
 * original MVP shape the HUD reads first; everything else is the fuller
 * nutrition breakdown the backend's B1-B6 pipeline actually computes, added
 * so a richer display (`UI/NutritionHUD.ts`) can subscribe to the same
 * `onFoodAnalyzed` signal without a second round-trip.
 */
export interface FoodAnalysisResult {
  name: string;
  grams: number;
  kcal: number;
  confidence?: number;

  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  weightUncertaintyG?: number;

  /** Estimated from food composition only — NOT a measured blood glucose reading. See docs/COMPLIANCE.md. */
  glycemicLoad?: number;
  glycemicCategory?: 'low' | 'medium' | 'high';

  /** Confidence breakdown, in case a display wants more than the single overall `confidence` above. */
  foodConfidence?: number;
  portionConfidence?: number;

  /**
   * Every food detected in the frame, in case more than one was present
   * (e.g. a plate) — each with its own nutrition, not just weight, so a
   * display can list "chicken · 220 kcal, rice · 200 kcal" instead of only
   * the combined total.
   */
  items?: { food: string; weightG: number; kcal: number; proteinG?: number; carbsG?: number; fatG?: number }[];
}
