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

  // --- Orientation channels (optional; populated by HandTracker from SIK's
  // TrackedHand). More field-of-view-tolerant than absolute position, so
  // useful for gestures like a bicep curl where the hand nears the FOV edge. ---

  /** SIK `getPalmPitchAngle()` in degrees, or null if unavailable / untracked. */
  palmPitchDeg?: number | null;
  /** Wrist "forward" unit vector (points toward the fingers, roughly along the
   * forearm), world space. Its Y sweeps monotonically through a curl. Zero when untracked. */
  wristForward?: vec3;
  /** Wrist "up" unit vector, world space. Zero when untracked. */
  wristUp?: vec3;
  /** SIK `isFacingCamera()` — coarse check that the tracked pose is real. */
  isFacingCamera?: boolean;
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

  /**
   * Vision-estimated micronutrients for this eating event, summed across items
   * (per serving, not per 100g). Present only when the vision backend returned
   * them — they feed the Nutri-Score below and the expanded HUD card.
   */
  sugarsG?: number;
  satFatG?: number;
  sodiumMg?: number;
  fiberG?: number;

  /**
   * Nutri-Score grade (A–E) for the primary food, from Nutrition/NutriScore.ts.
   * A food-composition estimate, not a health verdict — same framing as
   * glycemicLoad. `color` is the official grade colour, linear 0–1 RGB, used to
   * tint the HUD card.
   */
  nutriScore?: {
    grade: 'A' | 'B' | 'C' | 'D' | 'E';
    points: number;
    color: { r: number; g: number; b: number };
  };

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
