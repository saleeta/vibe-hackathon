import { EatingEventPayload, FoodAnalysisResult } from '../Core/PerceptionTypes';
import { IFoodAnalysisClient } from './FoodAnalysisClient';
import { encodeTextureToBase64Jpeg } from './TextureEncoding';
import { GeminiVisionClassifier } from './GeminiVisionClassifier';
import { FoodRecognitionService } from '../Nutrition/FoodRecognitionService';
import { PortionEstimator } from '../Nutrition/PortionEstimator';
import { EatingSessionManager, ObservationInput } from '../Nutrition/EatingSessionManager';
import { ConfidenceAggregator } from '../Nutrition/ConfidenceAggregator';
import { EatingSession } from '../Nutrition/Types';
import { lookupFood } from '../Nutrition/NutritionLookup';
import { scaleNutrition, sumNutrition, classifyGlycemicLoad } from '../Nutrition/NutritionScale';

/**
 * Fully Lens-side implementation of IFoodAnalysisClient: runs the whole
 * recognition -> portion -> aggregation/dedup -> nutrition lookup ->
 * confidence pipeline on-device, with the only network call being Gemini
 * vision via RemoteServiceGateway — no self-hosted `api/` server, no
 * tunnel, no nutrition-service round trip. Mirrors
 * `api/src/pipeline/analyzePlateImage.ts`'s orchestration exactly — a
 * one-frame session that opens and closes immediately — so this path and
 * the HTTP-backed `HttpFoodAnalysisClient` path produce results the same
 * way, from the same source of truth. Same @input slot as
 * `HttpFoodAnalysisClient`/`MockFoodAnalysisClient` on `EatingTrigger`
 * (all implement `IFoodAnalysisClient`) — swap freely.
 *
 * Requires a `RemoteServiceGatewayCredentials` component enabled somewhere
 * in the scene with a real `googleToken` set — this class never touches a
 * key directly (see GeminiVisionClassifier.ts's header comment).
 */
@component
export class GeminiFoodAnalysisClient extends BaseScriptComponent implements IFoodAnalysisClient {
  private readonly classifier = new GeminiVisionClassifier();
  private readonly foodRecognition = new FoodRecognitionService(this.classifier);

  async analyze(frame: Texture, context: EatingEventPayload): Promise<FoodAnalysisResult> {
    try {
      print(`[FoodLens:Encode] Frame received: ${frame.getWidth()}x${frame.getHeight()}, control loadStatus=${frame.control?.getLoadStatus?.()}`);
    } catch (err) {
      print(`[FoodLens:Encode] ERROR — frame is not usable before encoding: ${err}`);
      throw err;
    }
    const imageBase64 = await encodeTextureToBase64Jpeg(frame);
    print(`[FoodLens:Encode] Encoded to base64 (${imageBase64.length} chars).`);

    const recognizedItems = await this.foodRecognition.recognize(imageBase64, undefined, context.food_object);
    if (recognizedItems.length === 0) {
      throw new Error('No food recognized in this image with enough confidence');
    }

    // No hand/depth data for a single captured frame — use the vision
    // backend's own direct weight estimate (the alternate portion-estimation
    // path) instead of the geometric hand-scale method.
    const observations: Array<Omit<ObservationInput, 'timestampSec'>> = recognizedItems.map((item) => {
      if (!item.visionPortionEstimate) {
        throw new Error(`No portion estimate available for "${item.food}"`);
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

    const timestampSec = context.timestampMillis / 1000;
    let closedSession: EatingSession | null = null;
    const sessionManager = new EatingSessionManager((session) => {
      closedSession = session;
    });
    sessionManager.addPlateObservation(timestampSec, observations);
    sessionManager.closeActiveSession(timestampSec);
    if (!closedSession) throw new Error('Session unexpectedly failed to close');
    const session: EatingSession = closedSession;

    const mealItems = EatingSessionManager.summarizeByFood(session);
    const perItem = mealItems.map((item) => {
      const { per100g } = lookupFood(item.food);
      return { food: item.food, weightG: item.weightG, ...scaleNutrition(per100g, item.weightG) };
    });
    const totals = sumNutrition(perItem);
    const glycemicCategory = classifyGlycemicLoad(totals.glycemicLoad);

    // A live eating event carries the detector's real confidence that this
    // was genuinely food-in-hand; default to certain (1.0) if absent.
    const eatingConfidence = context.confidence ?? 1;
    const confidence = ConfidenceAggregator.forSession(session.items, eatingConfidence);

    const primaryItem = [...session.items].sort((a, b) => b.weightG - a.weightG)[0];

    return {
      name: primaryItem?.food ?? 'unknown',
      grams: session.items.reduce((sum, i) => sum + i.weightG, 0),
      kcal: totals.kcal,
      confidence: confidence.overall,
      proteinG: totals.proteinG,
      carbsG: totals.carbsG,
      fatG: totals.fatG,
      weightUncertaintyG: primaryItem?.weightUncertaintyG,
      glycemicLoad: totals.glycemicLoad,
      glycemicCategory,
      foodConfidence: confidence.foodConfidence,
      portionConfidence: confidence.portionConfidence,
      items: perItem.map((i) => ({ food: i.food, weightG: i.weightG, kcal: i.kcal, proteinG: i.proteinG, carbsG: i.carbsG, fatG: i.fatG })),
    };
  }
}
