/**
 * Composes food recognition -> portion estimation -> aggregation/dedup ->
 * nutrition lookup -> confidence into the single call backing
 * POST /v1/analyze. Reuses the exact same session/dedup code path a live
 * Spectacles session would use (EatingSessionManager), just as a one-frame
 * session that opens and closes immediately — so a standalone test photo
 * and a real eating session produce a MealSummary the same way, from the
 * same source of truth.
 *
 * Also this repo's implementation of the perception side's
 * `IFoodAnalysisClient` backend contract
 * (../../lens-studio/spectacles/Assets/Capture/FoodAnalysisClient.ts):
 * `eatingEventContext`, when present, carries the real EatingEventPayload
 * (food_object / confidence / timestampMillis) from a live Spectacles
 * eating event — `detection_confidence` becomes the confidence
 * aggregator's eatingConfidence input instead of the fallback used for a
 * manually-uploaded test photo, and `food_hint` is passed to food
 * recognition as a disambiguation aid.
 */

import { FoodRecognitionService } from "../../../lens-studio/spectacles/Assets/Nutrition/FoodRecognitionService";
import { PortionEstimator } from "../../../lens-studio/spectacles/Assets/Nutrition/PortionEstimator";
import { NutritionClient } from "../../../lens-studio/spectacles/Assets/Nutrition/NutritionClient";
import { EatingSessionManager, ObservationInput } from "../../../lens-studio/spectacles/Assets/Nutrition/EatingSessionManager";
import { ConfidenceAggregator } from "../../../lens-studio/spectacles/Assets/Nutrition/ConfidenceAggregator";
import { EatingSession, MealSummary } from "../../../lens-studio/spectacles/Assets/Nutrition/Types";
import { mealNutriProfile, microsByFood } from "../../../lens-studio/spectacles/Assets/Nutrition/NutriProfile";

export interface AnalyzePlateImageDeps {
  foodRecognition: FoodRecognitionService;
  portionEstimator: PortionEstimator;
  nutritionClient: NutritionClient;
}

/** Present when this call came from the perception side's live EatingTrigger rather than a manually-uploaded test photo. */
export interface EatingEventContext {
  foodHint?: string;
  /** Confidence that this was genuinely an eating event — becomes the confidence aggregator's eatingConfidence. */
  detectionConfidence?: number;
  timestampMillis?: number;
}

export class NoFoodRecognizedError extends Error {
  constructor() {
    super("No food recognized in this image with enough confidence");
    this.name = "NoFoodRecognizedError";
  }
}

export async function analyzePlateImage(
  imageBase64: string,
  deps: AnalyzePlateImageDeps,
  eventContext: EatingEventContext = {}
): Promise<MealSummary> {
  const recognizedItems = await deps.foodRecognition.recognize(imageBase64, undefined, eventContext.foodHint);
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

  const timestampSec = eventContext.timestampMillis ? eventContext.timestampMillis / 1000 : Date.now() / 1000;
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

  // A live eating event carries A4's real confidence that this was genuinely
  // an eating event; a manually-uploaded test photo has no such ambiguity —
  // it's a deliberate upload, so treat it as certain (1.0).
  const eatingConfidence = eventContext.detectionConfidence ?? 1;
  const confidence = ConfidenceAggregator.forSession(session.items, eatingConfidence);

  // Micronutrients + Nutri-Score grade for the primary food. Same shared helper
  // the on-device path (Capture/GeminiFoodAnalysisClient) uses, so both grade a
  // food identically.
  const primaryFood = [...session.items].sort((a, b) => b.weightG - a.weightG)[0]?.food ?? "unknown";
  const { micros, nutriScore } = mealNutriProfile(mealItems, microsByFood(recognizedItems), primaryFood);

  return {
    sessionId: session.id,
    startedSec: session.startedSec,
    closedSec: session.closedSec ?? timestampSec,
    items: session.items,
    totals,
    confidence,
    glycemicEstimate,
    micros,
    nutriScore,
  };
}
