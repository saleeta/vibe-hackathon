/**
 * Shared types for the exercise-tracking module (steps, squats, curls, and
 * the dino-jump minigame). Mirrors the nutrition pipeline's
 * `Core/PerceptionTypes.ts` convention: plain data, no side effects, safe to
 * import from any script.
 */

/** Fired the instant a rep is confirmed. */
export interface RepPayload {
  timestampMillis: number;
}

/** A curl-specific rep payload — carries the weight so calorie estimation and the "kg lifted" stat can use it. */
export interface CurlRepPayload {
  weightKg: number;
  timestampMillis: number;
}

/** Running totals + a rough calorie estimate, rebroadcast on every counter change so the HUD never has to poll. */
export interface WorkoutSummary {
  steps: number;
  squats: number;
  curls: number;
  curlWeightKg: number;
  /** Rough MET-style estimate, not a calibrated measurement — same "estimate" framing as the nutrition side's glycemic load (see docs/COMPLIANCE.md). */
  kcalBurned: number;
  /** Approx distance walked, metres (steps × stride, stride from height). */
  distanceM: number;
  /** Per-exercise slices of kcalBurned, so the mini-card can show just the picked exercise's number. */
  stepKcal: number;
  squatKcal: number;
  curlKcal: number;
}

export enum SquatState {
  Standing = 0,
  Squatting = 1,
}

export enum CurlState {
  Extended = 0,
  Curled = 1,
}
