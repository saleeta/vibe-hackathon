import { EatingEventPayload, FoodAnalysisResult } from '../Core/PerceptionTypes';
import { encodeTextureToBase64Jpeg } from './TextureEncoding';

/**
 * Swappable seam to Person B's food-analysis backend. EatingTrigger (A5)
 * only depends on this interface — point it at a mock during development,
 * then at the real endpoint without touching any detection code.
 */
export interface IFoodAnalysisClient {
  analyze(frame: Texture, context: EatingEventPayload): Promise<FoodAnalysisResult>;
}

/**
 * Default implementation: POSTs a JPEG-encoded HQ frame + context to
 * Person B's backend, expects { name, grams, kcal } back.
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
  @hint('Person B\'s food-analysis endpoint, e.g. https://api.example.com/analyze')
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
    };
  }
}

/** In-memory mock for developing/demoing A5/A6 before Person B's backend exists. */
@component
export class MockFoodAnalysisClient extends BaseScriptComponent implements IFoodAnalysisClient {
  @input mockKcalPerFoodObject: string = ''; // e.g. JSON string '{"apple":95,"burger":550}' set in Inspector

  async analyze(_frame: Texture, context: EatingEventPayload): Promise<FoodAnalysisResult> {
    const table: Record<string, number> = this.mockKcalPerFoodObject
      ? JSON.parse(this.mockKcalPerFoodObject)
      : {};
    const kcal = table[context.food_object] ?? 100;
    return { name: context.food_object, grams: 150, kcal, confidence: context.confidence };
  }
}
