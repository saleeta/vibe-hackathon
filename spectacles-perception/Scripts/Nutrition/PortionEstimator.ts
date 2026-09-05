/**
 * Portion estimation.
 *
 * Uses the hand as a scale reference: given the hand's known real-world width
 * and its pixel width at the observed depth, we derive a px-per-cm scale for
 * that frame, apply it to the food's bounding box to get a real-world
 * footprint, turn that into a volume via a per-food shape heuristic, and
 * convert volume to weight via a density lookup.
 *
 * This is a geometric MVP, not a learned depth model — every step is a
 * documented heuristic so it's obvious what to replace first (shape model,
 * then density table, then real depth-camera integration). Uncertainty is
 * carried through explicitly and on purpose never collapsed to a
 * false-precision point estimate.
 */

import { BoundingBox, HandObservation, PortionEstimate, VisionPortionEstimate } from "./Types";

const DEFAULT_HAND_WIDTH_CM = 8.5; // adult palm width, used until per-user calibration exists

/** Rough shape + density model per food, keyed by the same names food recognition/nutrition lookup use. */
interface FoodShapeModel {
  /** "slab" (rice/veg on a plate), "sphere" (fruit), "patty" (meat portions). */
  shape: "slab" | "sphere" | "patty";
  densityGPerCm3: number;
  /** Fraction of the bounding-box footprint actually covered by the food, 0-1. */
  fillFactor: number;
}

const SHAPE_MODELS: Record<string, FoodShapeModel> = {
  banana: { shape: "sphere", densityGPerCm3: 0.94, fillFactor: 0.55 },
  apple: { shape: "sphere", densityGPerCm3: 0.85, fillFactor: 0.7 },
  rice: { shape: "slab", densityGPerCm3: 0.9, fillFactor: 0.85 },
  chicken: { shape: "patty", densityGPerCm3: 1.05, fillFactor: 0.8 },
  broccoli: { shape: "slab", densityGPerCm3: 0.35, fillFactor: 0.6 },
  vegetables: { shape: "slab", densityGPerCm3: 0.4, fillFactor: 0.6 },
  sauce: { shape: "slab", densityGPerCm3: 1.1, fillFactor: 0.9 },
};

const DEFAULT_SHAPE_MODEL: FoodShapeModel = {
  shape: "slab",
  densityGPerCm3: 0.7,
  fillFactor: 0.65,
};

/** Estimated relative error of this whole pipeline; drives the ± band. */
const RELATIVE_UNCERTAINTY = 0.35;
/** Wider band for the vision-direct path — no measured real-world reference at all. */
const VISION_RELATIVE_UNCERTAINTY = 0.45;

function pxPerCm(hand: HandObservation): number {
  const handWidthCm = hand.handWidthCm ?? DEFAULT_HAND_WIDTH_CM;
  return hand.handPixelWidth / handWidthCm;
}

function footprintAreaCm2(box: BoundingBox, scale: number, fillFactor: number): number {
  const widthCm = box.width / scale;
  const heightCm = box.height / scale;
  return widthCm * heightCm * fillFactor;
}

function volumeCm3(areaCm2: number, model: FoodShapeModel): number {
  switch (model.shape) {
    case "sphere": {
      // Treat the footprint as the sphere's great-circle cross-section.
      const radiusCm = Math.sqrt(areaCm2 / Math.PI);
      return (4 / 3) * Math.PI * Math.pow(radiusCm, 3);
    }
    case "patty": {
      const assumedThicknessCm = 2.0;
      return areaCm2 * assumedThicknessCm;
    }
    case "slab":
    default: {
      const assumedThicknessCm = 1.5;
      return areaCm2 * assumedThicknessCm;
    }
  }
}

export class PortionEstimator {
  estimate(foodName: string, box: BoundingBox, hand: HandObservation, foodConfidence: number): PortionEstimate {
    const model = SHAPE_MODELS[foodName.toLowerCase()] ?? DEFAULT_SHAPE_MODEL;
    const scale = pxPerCm(hand);

    const areaCm2 = footprintAreaCm2(box, scale, model.fillFactor);
    const volCm3 = volumeCm3(areaCm2, model);
    const weightG = volCm3 * model.densityGPerCm3;

    // Confidence degrades with distance from the hand (worse scale reference)
    // and with how far the food is from a food we have an explicit shape model for.
    const distancePenalty = clamp01(1 - Math.max(0, hand.distanceMeters - 0.3) * 0.4);
    const knownFoodBonus = SHAPE_MODELS[foodName.toLowerCase()] ? 1 : 0.75;
    const portionConfidence = clamp01(foodConfidence * distancePenalty * knownFoodBonus);

    return {
      food: foodName,
      estimatedWeightG: round1(weightG),
      uncertaintyG: round1(weightG * RELATIVE_UNCERTAINTY),
      confidence: round2(portionConfidence),
    };
  }

  /**
   * Alternate portion-estimation path for when there's no hand in frame to use as a scale
   * reference — e.g. a flat test photo of a plate rather than a live
   * Spectacles hand-to-mouth capture. Wraps whatever weight estimate the
   * vision backend itself produced (from visual portion cues: plate size,
   * comparison objects, typical serving sizes) with the same kind of
   * explicit uncertainty band as the geometric method, rather than
   * presenting a vision-guessed number as exact. Slightly wider relative
   * uncertainty than the geometric method since it's not grounded in any
   * measured real-world reference at all.
   */
  static fromVisionEstimate(
    foodName: string,
    visionEstimate: VisionPortionEstimate,
    foodConfidence: number
  ): PortionEstimate {
    const weightG = Math.max(0, visionEstimate.estimatedWeightG);
    const portionConfidence = clamp01(foodConfidence * clamp01(visionEstimate.confidence));

    return {
      food: foodName,
      estimatedWeightG: round1(weightG),
      uncertaintyG: round1(weightG * VISION_RELATIVE_UNCERTAINTY),
      confidence: round2(portionConfidence),
    };
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
