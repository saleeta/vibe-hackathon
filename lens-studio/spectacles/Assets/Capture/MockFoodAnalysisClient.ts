import { EatingEventPayload, FoodAnalysisResult } from '../Core/PerceptionTypes';
import { IFoodAnalysisClient } from './FoodAnalysisClient';

/**
 * In-memory mock for developing/demoing capture + display before the
 * nutrition backend is running. Split into its own file — Lens Studio only
 * allows one component class per source file.
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
