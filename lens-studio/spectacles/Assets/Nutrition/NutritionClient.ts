/**
 * Client for the nutrition-service. Transport is injected — used
 * server-side by api/ (over plain Node fetch) and by examples/demo.ts —
 * so this class has no Lens Studio dependency and can be unit tested /
 * demoed in plain Node against a local nutrition-service instance.
 */

import { GlycemicEstimate, ScaledNutrition } from "./Types";

export type PostJson = (url: string, body: unknown) => Promise<unknown>;

export interface MealNutritionResponse {
  items: ScaledNutrition[];
  totals: Omit<ScaledNutrition, "food" | "weightG" | "matched">;
  /** Estimated from food composition only — not a measured glucose value. */
  glycemicEstimate: GlycemicEstimate;
}

export class NutritionClient {
  constructor(private readonly baseUrl: string, private readonly postJson: PostJson) {}

  async lookup(food: string, weightG: number): Promise<ScaledNutrition> {
    const response = (await this.postJson(`${this.baseUrl}/nutrition/lookup`, {
      food,
      weightG,
    })) as ScaledNutrition;

    if (typeof response?.kcal !== "number") {
      throw new Error("nutrition-service returned an unexpected shape");
    }
    return response;
  }

  async meal(items: { food: string; weightG: number }[]): Promise<MealNutritionResponse> {
    const response = (await this.postJson(`${this.baseUrl}/nutrition/meal`, { items })) as MealNutritionResponse;
    return response;
  }
}
