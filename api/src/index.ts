/**
 * Person B's HTTP API — every stage of B1-B6 reachable as its own call, plus
 * one composed call (POST /v1/analyze) that runs the whole pipeline on a
 * single image. This is what test-images/'s analyze-folder script hits, and
 * what a real integration (Lens, or anything else) can call directly instead
 * of importing the TS modules.
 */

import express, { NextFunction, Request, Response } from "express";
import { FoodRecognitionService } from "../../lens-studio/Assets/Scripts/PersonB/FoodRecognitionService";
import { PortionEstimator } from "../../lens-studio/Assets/Scripts/PersonB/PortionEstimator";
import { NutritionClient } from "../../lens-studio/Assets/Scripts/PersonB/NutritionClient";
import { ClaudeVisionClassifier } from "./vision/ClaudeVisionClassifier";
import { analyzePlateImage, NoFoodRecognizedError } from "./pipeline/analyzePlateImage";

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

const classifierBackend = new ClaudeVisionClassifier(process.env.ANTHROPIC_API_KEY);
const foodRecognition = new FoodRecognitionService(classifierBackend);
const portionEstimator = new PortionEstimator();
const nutritionClient = new NutritionClient(NUTRITION_SERVICE_URL, postJson);

const app = express();
app.use(express.json({ limit: "20mb" })); // images as base64 are bulky

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, anthropicKeyConfigured: !!process.env.ANTHROPIC_API_KEY });
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
 */
app.post("/v1/analyze", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { image_base64 } = req.body ?? {};
    if (typeof image_base64 !== "string") {
      res.status(400).json({ error: "expected { image_base64: string }" });
      return;
    }
    const summary = await analyzePlateImage(image_base64, { foodRecognition, portionEstimator, nutritionClient });
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

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
  if (!process.env.ANTHROPIC_API_KEY) {
    // eslint-disable-next-line no-console
    console.warn("ANTHROPIC_API_KEY is not set — /v1/food/classify and /v1/analyze will fail until it is.");
  }
});
