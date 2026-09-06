/**
 * Real food-recognition (+ vision-direct portion estimation) backend: sends
 * the frame to a free vision-language model over OpenRouter's OpenAI-compatible
 * chat completions API, and asks it to both identify every food present and
 * estimate each one's weight directly from visual cues (plate size, comparison
 * objects, typical serving sizes) — the alternate portion-estimation path used
 * when there's no hand in frame to use as a scale reference (see
 * PortionEstimator.fromVisionEstimate).
 *
 * This is one interchangeable implementation of FoodClassifierBackend
 * (../../../lens-studio/spectacles/Assets/Nutrition/FoodRecognitionService) —
 * swap it for a different vision model/service without touching anything
 * downstream (the rest of the nutrition pipeline doesn't know or care where
 * the detection came from).
 *
 * Model choice: no free Qwen-VL tier exists on OpenRouter as of writing (only
 * paid `qwen/qwen2.5-vl-*` and `qwen/qwen3-vl-*` variants) — using Google's
 * free `gemma-4-31b-it:free` instead, which does support vision input. Swap
 * `MODEL` below if OpenRouter's free-tier lineup changes.
 */

import { FoodClassifierBackend } from "../../../lens-studio/spectacles/Assets/Nutrition/FoodRecognitionService";
import { BoundingBox, FoodRegionDetection } from "../../../lens-studio/spectacles/Assets/Nutrition/Types";

const MAX_HINT_LENGTH = 100;

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "google/gemma-4-31b-it:free";

const SYSTEM_PROMPT = `You are the food-recognition stage of a calorie and nutrition tracker. Given a photo of food, identify every distinct food item visible (a single food, or several on a plate), estimate each one's portion weight, and estimate its key nutrients per 100 g.

Respond with ONLY valid JSON (no markdown fences, no prose) matching exactly this shape:
{
  "foods": [
    {
      "name": "banana",
      "confidence": 0.96,
      "estimated_weight_g": 118,
      "portion_confidence": 0.72,
      "bounding_box": { "x": 0.12, "y": 0.30, "width": 0.25, "height": 0.40 },
      "sugars_g_per_100g": 12.2,
      "sat_fat_g_per_100g": 0.1,
      "sodium_mg_per_100g": 1,
      "fibre_g_per_100g": 2.6,
      "plant_percent": 100
    }
  ]
}

Rules:
- "name" must be a lowercase, singular, generic food name (e.g. "banana", "chicken", "rice", "broccoli", "sauce"), not a brand or a full recipe description.
- "confidence" (0-1) is how sure you are this food is actually present.
- "estimated_weight_g" is your best-effort portion weight estimate in grams, reasoned from plate size, typical serving sizes, and any visible scale references.
- "portion_confidence" (0-1) is how sure you are specifically about the weight estimate — usually lower than the identification confidence.
- "bounding_box" is a best-effort NORMALIZED (0-1) region of that food in the image; approximate is fine.
- "sugars_g_per_100g", "sat_fat_g_per_100g", "sodium_mg_per_100g", "fibre_g_per_100g": typical nutrient content per 100 g of this food (NOT per the portion shown), from standard food-composition knowledge. Sodium in milligrams; the rest in grams.
- "plant_percent" (0-100): percentage of this item that is fruit, vegetable, legume, or nut. 100 for a whole fruit/vegetable, 0 for meat / plain bread / soda.
- List every distinct food separately (a plate with rice, chicken, and broccoli is three entries, not one).
- If you cannot identify any food in the image, return {"foods": []}.`;

interface VisionFoodEntry {
  name: string;
  confidence: number;
  estimated_weight_g: number;
  portion_confidence: number;
  bounding_box?: { x: number; y: number; width: number; height: number };
  sugars_g_per_100g?: number;
  sat_fat_g_per_100g?: number;
  sodium_mg_per_100g?: number;
  fibre_g_per_100g?: number;
  plant_percent?: number;
  held_in_hand?: boolean;
}

export class OpenRouterVisionClassifier implements FoodClassifierBackend {
  constructor(private readonly apiKey: string | undefined, private readonly model: string = MODEL) {}

  async classify(imageBase64: string, _roiHint?: BoundingBox, foodHint?: string): Promise<FoodRegionDetection[]> {
    if (!this.apiKey) {
      throw new Error(
        "OPENROUTER_API_KEY is not set. Set it in the environment before calling /v1/food/classify or /v1/analyze."
      );
    }

    const dataUrl = toDataUrl(imageBase64);

    // foodHint (e.g. the perception side's on-device classifier's guess) is a hint to
    // disambiguate with, never trusted blindly — the instruction below asks
    // the model to verify it against the image, not to just echo it back.
    const userText = foodHint
      ? `Identify the food in this image per the schema in your instructions. An upstream on-device classifier guessed this might be "${sanitizeHint(
          foodHint
        )}" — verify that against what you actually see rather than assuming it's correct.`
      : "Identify the food in this image per the schema in your instructions.";

    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: userText },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`OpenRouter vision request failed: ${response.status} ${body}`);
    }

    const json = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = json.choices?.[0]?.message?.content;
    if (!text) {
      throw new Error("OpenRouter vision response contained no message content");
    }

    const foods = parseFoodsJson(text);

    return foods.map((f) => ({
      boundingBox: toBoundingBox(f.bounding_box),
      candidates: [{ name: normalizeFoodName(f.name), confidence: clamp01(f.confidence) }],
      visionPortionEstimate: {
        estimatedWeightG: Math.max(0, f.estimated_weight_g ?? 0),
        confidence: clamp01(f.portion_confidence),
      },
      visionMicros: {
        sugarsG100: nonNegative(f.sugars_g_per_100g),
        satFatG100: nonNegative(f.sat_fat_g_per_100g),
        sodiumMg100: nonNegative(f.sodium_mg_per_100g),
        fibreG100: nonNegative(f.fibre_g_per_100g),
        plantPercent: clampPercent(f.plant_percent),
      },
      heldInHand: f.held_in_hand === true,
    }));
  }
}

function toDataUrl(input: string): string {
  if (input.startsWith("data:")) return input;
  return `data:image/jpeg;base64,${input}`; // assume raw JPEG base64 if no data: URL prefix
}

function parseFoodsJson(text: string): VisionFoodEntry[] {
  // Vision models occasionally wrap JSON in a code fence despite instructions not to — strip it defensively.
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Vision model response was not valid JSON: ${(err as Error).message}\nRaw response: ${text}`);
  }

  const foods = (parsed as { foods?: unknown }).foods;
  if (!Array.isArray(foods)) {
    throw new Error(`Vision model response missing a "foods" array. Raw response: ${text}`);
  }
  return foods as VisionFoodEntry[];
}

/** Unit-square convention (imageWidth/imageHeight = 1) since these are normalized, best-effort boxes, not pixel-precise. */
function toBoundingBox(box?: { x: number; y: number; width: number; height: number }): BoundingBox {
  const b = box ?? { x: 0, y: 0, width: 1, height: 1 };
  return { x: b.x, y: b.y, width: b.width, height: b.height, imageWidth: 1, imageHeight: 1 };
}

function normalizeFoodName(name: string): string {
  return (name ?? "").toLowerCase().trim();
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v ?? 0));
}

function nonNegative(v: number | undefined): number {
  return typeof v === "number" && isFinite(v) && v > 0 ? v : 0;
}

function clampPercent(v: number | undefined): number {
  if (typeof v !== "number" || !isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

/** foodHint comes from an upstream classifier, not a trusted source — cap length before it goes into the prompt. */
function sanitizeHint(hint: string): string {
  return hint.slice(0, MAX_HINT_LENGTH).replace(/[\r\n]+/g, " ").trim();
}
