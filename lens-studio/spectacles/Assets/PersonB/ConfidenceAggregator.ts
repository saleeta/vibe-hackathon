/**
 * B6 — Confidence / uncertainty system.
 *
 * Every automatic log is a chain of guesses (eating? which food? how much?),
 * so we never collapse those into a single silent number. Combine with a
 * weighted geometric mean, not a plain average — geometric mean means a
 * single very-low-confidence stage (e.g. a bad portion estimate) drags the
 * overall score down hard, rather than being diluted by the other two. That
 * matches the failure mode we actually care about: any one broken stage
 * should make the whole estimate suspect.
 */

import { ConfidenceBreakdown, SessionFoodItem } from "./Types";

const WEIGHTS = {
  eating: 0.25,
  food: 0.35,
  portion: 0.4,
};

export class ConfidenceAggregator {
  static forObservation(eatingConfidence: number, foodConfidence: number, portionConfidence: number): ConfidenceBreakdown {
    const overall = weightedGeometricMean(
      [eatingConfidence, foodConfidence, portionConfidence],
      [WEIGHTS.eating, WEIGHTS.food, WEIGHTS.portion]
    );

    return {
      eatingConfidence: round(eatingConfidence),
      foodConfidence: round(foodConfidence),
      portionConfidence: round(portionConfidence),
      overall: round(overall),
    };
  }

  /** Session-level confidence: the weakest tracked item caps the whole meal's confidence. */
  static forSession(items: SessionFoodItem[], eatingConfidence: number): ConfidenceBreakdown {
    if (items.length === 0) {
      return { eatingConfidence: round(eatingConfidence), foodConfidence: 0, portionConfidence: 0, overall: 0 };
    }

    const weakestFood = Math.min(...items.map((i) => i.foodConfidence));
    const weakestPortion = Math.min(...items.map((i) => i.portionConfidence));

    return this.forObservation(eatingConfidence, weakestFood, weakestPortion);
  }
}

function weightedGeometricMean(values: number[], weights: number[]): number {
  const eps = 0.01; // avoid log(0) collapsing the whole product to zero on a single bad reading
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const logSum = values.reduce((sum, v, i) => sum + weights[i] * Math.log(Math.max(v, eps)), 0);
  return Math.exp(logSum / totalWeight);
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
