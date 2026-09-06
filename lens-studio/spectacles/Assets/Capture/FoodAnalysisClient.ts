import { EatingEventPayload, FoodAnalysisResult } from '../Core/PerceptionTypes';
import { encodeTextureToBase64Jpeg } from './TextureEncoding';

/**
 * Swappable seam to the nutrition backend. EatingTrigger only depends on
 * this interface — point it at a mock during development, then at the real
 * endpoint without touching any detection code.
 */
export interface IFoodAnalysisClient {
  analyze(frame: Texture, context: EatingEventPayload): Promise<FoodAnalysisResult>;
}

/**
 * Default implementation: POSTs a JPEG-encoded HQ frame + context to
 * the nutrition backend (`api/`'s `POST /v1/analyze` — see
 * ../../../../../api/README.md), which runs its whole recognition-through-confidence pipeline and
 * responds with the flat { name, grams, kcal, confidence } shape plus the
 * fuller nutrition/glycemic/confidence breakdown, mapped straight through
 * to FoodAnalysisResult so a richer display isn't limited to just calories.
 * Point `backendUrl` at that server's /v1/analyze endpoint, e.g.
 * http://localhost:4002/v1/analyze during development.
 *
 * TODO(verify): InternetModule.fetch's exact request/response shape
 * against Lens Studio 5.15.4 (this follows the documented fetch(url, init)
 * -> Response pattern with .ok/.json()). Requires "Internet Access" +
 * the backend host allow-listed in Project Settings.
 */
@component
export class HttpFoodAnalysisClient extends BaseScriptComponent implements IFoodAnalysisClient {
  @input
  internetModule: InternetModule;

  @input
  @hint('The nutrition backend\'s food-analysis endpoint, e.g. https://api.example.com/analyze')
  backendUrl: string = '';

  @input
  requestTimeoutMs: number = 8000;

  async analyze(frame: Texture, context: EatingEventPayload): Promise<FoodAnalysisResult> {
    if (!this.backendUrl) throw new Error('HttpFoodAnalysisClient: backendUrl is not configured');

    const imageBase64 = await encodeTextureToBase64Jpeg(frame);

    const response = await this.internetModule.fetch(this.backendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_base64: imageBase64,
        food_hint: context.food_object,
        detection_confidence: context.confidence,
        timestamp_millis: context.timestampMillis,
      }),
    });

    if (!response.ok) {
      throw new Error(`Food analysis backend returned ${response.status}`);
    }

    const json = await response.json();
    return {
      name: json.name,
      grams: json.grams,
      kcal: json.kcal,
      confidence: json.confidence,
      proteinG: json.proteinG,
      carbsG: json.carbsG,
      fatG: json.fatG,
      weightUncertaintyG: json.weightUncertaintyG,
      glycemicLoad: json.glycemicLoad,
      glycemicCategory: json.glycemicCategory,
      sugarsG: json.sugarsG,
      satFatG: json.satFatG,
      sodiumMg: json.sodiumMg,
      fiberG: json.fiberG,
      nutriScore: json.nutriScore,
      foodConfidence: json.foodConfidence,
      portionConfidence: json.portionConfidence,
      // api/'s nested MealSummary.items carry per-item nutrition under `.nutrition`, not flat — unwrap it here.
      items: (json.items ?? []).map((item: { food: string; weightG: number; nutrition?: { kcal: number; proteinG: number; carbsG: number; fatG: number } }) => ({
        food: item.food,
        weightG: item.weightG,
        kcal: item.nutrition?.kcal ?? 0,
        proteinG: item.nutrition?.proteinG,
        carbsG: item.nutrition?.carbsG,
        fatG: item.nutrition?.fatG,
      })),
    };
  }
}
