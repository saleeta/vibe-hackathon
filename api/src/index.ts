/**
 * The nutrition pipeline's HTTP API — every stage reachable as its own call, plus
 * one composed call (POST /v1/analyze) that runs the whole pipeline on a
 * single image. This is what test-images/'s analyze-folder script hits, and
 * what a real integration (Lens, or anything else) can call directly instead
 * of importing the TS modules.
 */

import express, { NextFunction, Request, Response } from "express";
import { FoodRecognitionService } from "../../lens-studio/spectacles/Assets/Nutrition/FoodRecognitionService";
import { PortionEstimator } from "../../lens-studio/spectacles/Assets/Nutrition/PortionEstimator";
import { NutritionClient } from "../../lens-studio/spectacles/Assets/Nutrition/NutritionClient";
import { OpenRouterVisionClassifier } from "./vision/OpenRouterVisionClassifier";
import { analyzePlateImage, NoFoodRecognizedError } from "./pipeline/analyzePlateImage";
import { MealSummary } from "../../lens-studio/spectacles/Assets/Nutrition/Types";

const PORT = process.env.PORT ? Number(process.env.PORT) : 4002;
const NUTRITION_SERVICE_URL = process.env.NUTRITION_SERVICE_URL ?? "http://localhost:4001";

async function postJson(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${url} -> ${res.status} ${text}`);
  }
  return res.json();
}

const classifierBackend = new OpenRouterVisionClassifier(process.env.OPENROUTER_API_KEY);
const foodRecognition = new FoodRecognitionService(classifierBackend);
const portionEstimator = new PortionEstimator();
const nutritionClient = new NutritionClient(NUTRITION_SERVICE_URL, postJson);

const app = express();
app.use(express.json({ limit: "20mb" })); // images as base64 are bulky

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, openRouterKeyConfigured: !!process.env.OPENROUTER_API_KEY });
});

/** B1 alone — image in, detected food regions out. */
app.post("/v1/food/classify", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { image_base64 } = req.body ?? {};
    if (typeof image_base64 !== "string") {
      res.status(400).json({ error: "expected { image_base64: string }" });
      return;
    }
    const items = await foodRecognition.recognize(image_base64);
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

/** B2 alone, hand-geometry method — food + box + hand in, weight estimate out. */
app.post("/v1/portion/estimate", (req: Request, res: Response) => {
  const { food, boundingBox, hand, foodConfidence } = req.body ?? {};
  if (typeof food !== "string" || !boundingBox || !hand || typeof foodConfidence !== "number") {
    res.status(400).json({ error: "expected { food, boundingBox, hand, foodConfidence }" });
    return;
  }
  const estimate = portionEstimator.estimate(food, boundingBox, hand, foodConfidence);
  res.json(estimate);
});

/**
 * The one-call pipeline: image in, full meal (foods, weights, kcal/macros,
 * glycemic load estimate, confidence breakdown) out. Runs B1 (vision) -> B2
 * (vision-direct portion, since a standalone photo has no hand to use as a
 * scale reference) -> B4/B5 (one-shot session) -> B3 (nutrition-service) ->
 * B6 (confidence).
 *
 * This is also the concrete backend for the perception side's
 * `IFoodAnalysisClient` contract (Assets/Capture/FoodAnalysisClient.ts's
 * HttpFoodAnalysisClient calls exactly this endpoint with exactly this
 * request shape) — `food_hint`/`detection_confidence`/`timestamp_millis`
 * are the real EatingEventPayload fields when this came from a live
 * Spectacles eating event, absent for a manually-uploaded test photo.
 * The response is a superset of both: the flat name/grams/kcal/confidence
 * shape HttpFoodAnalysisClient reads, the fuller nutrition/glycemic/
 * confidence fields FoodAnalysisResult now also carries, AND the full
 * MealSummary (items/totals/confidence/glycemicEstimate) underneath.
 */
app.post("/v1/analyze", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { image_base64, food_hint, detection_confidence, timestamp_millis } = req.body ?? {};
    if (typeof image_base64 !== "string") {
      res.status(400).json({ error: "expected { image_base64: string }" });
      return;
    }
    const summary = await analyzePlateImage(
      image_base64,
      { foodRecognition, portionEstimator, nutritionClient },
      {
        foodHint: typeof food_hint === "string" ? food_hint : undefined,
        detectionConfidence: typeof detection_confidence === "number" ? detection_confidence : undefined,
        timestampMillis: typeof timestamp_millis === "number" ? timestamp_millis : undefined,
      }
    );
    res.json({ ...summary, ...flattenForFoodAnalysisResult(summary) });
  } catch (err) {
    next(err);
  }
});

/**
 * The perception side's IFoodAnalysisClient reads a flat { name, grams, kcal,
 * confidence, ... } shape (see Assets/Core/PerceptionTypes.ts's
 * FoodAnalysisResult) — derives it from the full MealSummary so callers
 * that only care about "the one thing that was eaten" don't have to reach
 * into items[]/totals{}, while items/totals/confidence/glycemicEstimate
 * stay available underneath for anything that wants the full breakdown.
 * The heaviest item stands in for "name" since a live eating event is
 * almost always one food, but a frame can still show more than one.
 */
function flattenForFoodAnalysisResult(summary: MealSummary) {
  const primaryItem = [...summary.items].sort((a, b) => b.weightG - a.weightG)[0];
  return {
    name: primaryItem?.food ?? "unknown",
    grams: summary.items.reduce((sum, i) => sum + i.weightG, 0),
    kcal: summary.totals.kcal,
    confidence: summary.confidence.overall,
    proteinG: summary.totals.proteinG,
    carbsG: summary.totals.carbsG,
    fatG: summary.totals.fatG,
    weightUncertaintyG: primaryItem?.weightUncertaintyG,
    glycemicLoad: summary.glycemicEstimate?.totalGlycemicLoad,
    glycemicCategory: summary.glycemicEstimate?.category,
    sugarsG: summary.micros?.sugarsG,
    satFatG: summary.micros?.satFatG,
    sodiumMg: summary.micros?.sodiumMg,
    fiberG: summary.micros?.fiberG,
    nutriScore: summary.nutriScore,
    foodConfidence: summary.confidence.foodConfidence,
    portionConfidence: summary.confidence.portionConfidence,
  };
}

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof NoFoodRecognizedError) {
    res.status(422).json({ error: err.message });
    return;
  }
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`person-b-api listening on :${PORT}`);
  if (!process.env.OPENROUTER_API_KEY) {
    // eslint-disable-next-line no-console
    console.warn("OPENROUTER_API_KEY is not set — /v1/food/classify and /v1/analyze will fail until it is.");
  }
});
