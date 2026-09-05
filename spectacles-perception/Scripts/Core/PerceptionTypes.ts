/**
 * Shared types for the Person-A perception module (A1-A6).
 *
 * Nothing in this file has side effects — it's safe to import from any
 * script, including the main app / Person B's integration code.
 */

// Matches SIK's own HandType exactly ('left' | 'right' string union, not a
// TS enum — SIK's getHand()/BaseHand.handType are typed this way, verified
// against the installed SpectaclesInteractionKit.lspkg v0.17.2 source), so
// HandSide.Left/Right values pass straight into SIK calls with no cast.
export type HandSide = 'left' | 'right'
export const HandSide = {
  Left: 'left' as HandSide,
  Right: 'right' as HandSide,
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
  /** World-space distance from this hand's index tip to the face anchor. Infinity when !isTracked. */
  distanceToFace: number;
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

/** Output of A3 — classification only, no side effects, no logging trigger. */
export interface FoodInHandResult {
  food_in_hand: boolean;
  food_object: string | null;
  confidence: number;
  hand: HandSide | null;
}

/** A4's temporal state machine states, per the spec. Ordered — higher index = further along the eating sequence. */
export enum EatingState {
  NOT_EATING = 0,
  FOOD_DETECTED = 1,
  FOOD_IN_HAND = 2,
  HAND_APPROACHING_FACE = 3,
  FOOD_AT_FACE = 4,
  EATING_EVENT = 5,
}

export interface EatingStateChange {
  previous: EatingState;
  next: EatingState;
  timestampMillis: number;
}

/** Fired once per confirmed bite — this is what triggers A5's HQ capture + backend call. */
export interface EatingEventPayload {
  food_object: string;
  confidence: number;
  timestampMillis: number;
}

/**
 * What the food-analysis backend hands back after analyzing the HQ frame.
 * Only `name`/`grams`/`kcal` are required — AutoLogDisplay only reads those.
 * Everything else is optional and populated by richer backends (e.g.
 * GeminiFoodAnalysisClient) for a fuller macro/glycemic breakdown.
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
  glycemicLoad?: number;
  glycemicCategory?: 'low' | 'medium' | 'high';
  foodConfidence?: number;
  portionConfidence?: number;
  /** Per-food breakdown when more than one item was recognized in the frame (e.g. a plate). */
  items?: Array<{ food: string; weightG: number; kcal: number; proteinG?: number; carbsG?: number; fatG?: number }>;
}
