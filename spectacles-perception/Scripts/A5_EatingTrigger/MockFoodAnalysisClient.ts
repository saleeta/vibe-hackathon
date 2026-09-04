import { EatingEventPayload, FoodAnalysisResult } from '../Core/PerceptionTypes';
import { IFoodAnalysisClient } from './FoodAnalysisClient';

/**
 * In-memory mock for developing/demoing A5/A6 before Person B's backend
 * exists. Same IFoodAnalysisClient interface as HttpFoodAnalysisClient —
 * swap the @input on EatingTrigger between the two with no other changes.
 */
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
