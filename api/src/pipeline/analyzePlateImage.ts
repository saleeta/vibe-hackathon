/**
 * Composes B1 -> B2 -> B4/B5 -> B3 -> B6 into the single call backing
 * POST /v1/analyze. Reuses the exact same session/dedup code path a live
 * Spectacles session would use (EatingSessionManager), just as a one-frame
 * session that opens and closes immediately — so a standalone test photo
 * and a real eating session produce a MealSummary the same way, from the
 * same source of truth.
 */

import { FoodRecognitionService } from "../../../lens-studio/Assets/Scripts/PersonB/FoodRecognitionService";
import { PortionEstimator } from "../../../lens-studio/Assets/Scripts/PersonB/PortionEstimator";
import { NutritionClient } from "../../../lens-studio/Assets/Scripts/PersonB/NutritionClient";
import { EatingSessionManager, ObservationInput } from "../../../lens-studio/Assets/Scripts/PersonB/EatingSessionManager";
import { ConfidenceAggregator } from "../../../lens-studio/Assets/Scripts/PersonB/ConfidenceAggregator";
import { EatingSession, MealSummary } from "../../../lens-studio/Assets/Scripts/PersonB/Types";

export interface AnalyzePlateImageDeps {
  foodRecognition: FoodRecognitionService;
  portionEstimator: PortionEstimator;
  nutritionClient: NutritionClient;
}

export class NoFoodRecognizedError extends Error {
  constructor() {
    super("No food recognized in this image with enough confidence");
    this.name = "NoFoodRecognizedError";
  }
}

export async function analyzePlateImage(imageBase64: string, deps: AnalyzePlateImageDeps): Promise<MealSummary> {
  const recognizedItems = await deps.foodRecognition.recognize(imageBase64);
  if (recognizedItems.length === 0) {
    throw new NoFoodRecognizedError();
  }

  const observations: Omit<ObservationInput, "timestampSec">[] = recognizedItems.map((item) => {
    // A standalone photo has no hand/depth data — use the vision backend's own
    // direct weight estimate (B2's alternate path) instead of the geometric method.
    if (!item.visionPortionEstimate) {
      throw new Error(
        `No portion estimate available for "${item.food}" — the classifier backend didn't return one, and there's no hand geometry to fall back to for a standalone image.`
      );
    }
    const portion = PortionEstimator.fromVisionEstimate(item.food, item.visionPortionEstimate, item.confidence);
    return {
      food: item.food,
      weightG: portion.estimatedWeightG,
      weightUncertaintyG: portion.uncertaintyG,
      foodConfidence: item.confidence,
      portionConfidence: portion.confidence,
    };
  });

  const timestampSec = Date.now() / 1000;
  let closedSession: EatingSession | null = null;
  const sessionManager = new EatingSessionManager((session) => {
    closedSession = session;
  });
  sessionManager.addPlateObservation(timestampSec, observations);
  sessionManager.closeActiveSession(timestampSec);

  if (!closedSession) throw new Error("Session unexpectedly failed to close");
  const session: EatingSession = closedSession;

  const mealItems = EatingSessionManager.summarizeByFood(session);
  const { totals, glycemicEstimate } = await deps.nutritionClient.meal(mealItems);

  // A deliberately uploaded test photo is treated as a certain "eating event" (1.0) —
  // there's no ambiguous hand-to-mouth detection to score here, unlike a live Spectacles frame.
  const confidence = ConfidenceAggregator.forSession(session.items, 1);

  return {
    sessionId: session.id,
    startedSec: session.startedSec,
    closedSec: session.closedSec ?? timestampSec,
    items: session.items,
    totals,
    confidence,
    glycemicEstimate,
  };
}
