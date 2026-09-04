/**
 * Real B1 (+ vision-direct B2) backend: sends the frame to Claude's vision
 * API and asks it to both identify every food present and estimate each
 * one's weight directly from visual cues (plate size, comparison objects,
 * typical serving sizes) — the alternate portion-estimation path used when
 * there's no hand in frame to use as a scale reference (see
 * PortionEstimator.fromVisionEstimate).
 *
 * This is one interchangeable implementation of FoodClassifierBackend
 * (../../../lens-studio/Assets/Scripts/PersonB/FoodRecognitionService) —
 * swap it for a different vision model/service without touching anything
 * downstream (B2-B6 don't know or care where the detection came from).
 */

import Anthropic from "@anthropic-ai/sdk";
import { FoodClassifierBackend } from "../../../lens-studio/Assets/Scripts/PersonB/FoodRecognitionService";
import { BoundingBox, FoodRegionDetection } from "../../../lens-studio/Assets/Scripts/PersonB/Types";

const MODEL = "claude-sonnet-5";

const SYSTEM_PROMPT = `You are the food-recognition stage of a calorie and nutrition tracker. Given a photo of food, identify every distinct food item visible (a single food, or several on a plate) and estimate each one's portion weight.

Respond with ONLY valid JSON (no markdown fences, no prose) matching exactly this shape:
{
  "foods": [
    {
      "name": "banana",
      "confidence": 0.96,
      "estimated_weight_g": 118,
      "portion_confidence": 0.72,
      "bounding_box": { "x": 0.12, "y": 0.30, "width": 0.25, "height": 0.40 }
    }
  ]
}

Rules:
- "name" must be a lowercase, singular, generic food name (e.g. "banana", "chicken", "rice", "broccoli", "sauce"), not a brand or a full recipe description.
- "confidence" (0-1) is how sure you are this food is actually present.
- "estimated_weight_g" is your best-effort portion weight estimate in grams, reasoned from plate size, typical serving sizes, and any visible scale references.
- "portion_confidence" (0-1) is how sure you are specifically about the weight estimate — usually lower than the identification confidence.
- "bounding_box" is a best-effort NORMALIZED (0-1) region of that food in the image; approximate is fine.
- List every distinct food separately (a plate with rice, chicken, and broccoli is three entries, not one).
- If you cannot identify any food in the image, return {"foods": []}.`;

interface ClaudeFoodEntry {
  name: string;
  confidence: number;
  estimated_weight_g: number;
  portion_confidence: number;
  bounding_box?: { x: number; y: number; width: number; height: number };
}

export class ClaudeVisionClassifier implements FoodClassifierBackend {
  constructor(private readonly apiKey: string | undefined) {}

  async classify(imageBase64: string): Promise<FoodRegionDetection[]> {
    if (!this.apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Set it in the environment before calling /v1/food/classify or /v1/analyze."
      );
    }

    const client = new Anthropic({ apiKey: this.apiKey });
    const { mediaType, data } = parseImageBase64(imageBase64);

    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 1536,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data } },
            { type: "text", text: "Identify the food in this image per the schema in your instructions." },
          ],
        },
      ],
    });

    const textBlock = message.content.find((block: { type: string }) => block.type === "text") as
      | { type: "text"; text: string }
      | undefined;
    if (!textBlock) {
      throw new Error("Claude vision response contained no text content");
    }

    const foods = parseFoodsJson(textBlock.text);

    return foods.map((f) => ({
      boundingBox: toBoundingBox(f.bounding_box),
      candidates: [{ name: normalizeFoodName(f.name), confidence: clamp01(f.confidence) }],
      visionPortionEstimate: {
        estimatedWeightG: Math.max(0, f.estimated_weight_g ?? 0),
        confidence: clamp01(f.portion_confidence),
      },
    }));
  }
}

function parseImageBase64(input: string): { mediaType: "image/jpeg" | "image/png" | "image/webp"; data: string } {
  const dataUrlMatch = input.match(/^data:(image\/(?:jpeg|png|webp));base64,([\s\S]+)$/);
  if (dataUrlMatch) {
    return { mediaType: dataUrlMatch[1] as "image/jpeg" | "image/png" | "image/webp", data: dataUrlMatch[2] };
  }
  return { mediaType: "image/jpeg", data: input }; // assume raw JPEG base64 if no data: URL prefix
}

function parseFoodsJson(text: string): ClaudeFoodEntry[] {
  // Claude occasionally wraps JSON in a code fence despite instructions not to — strip it defensively.
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Claude vision response was not valid JSON: ${(err as Error).message}\nRaw response: ${text}`);
  }

  const foods = (parsed as { foods?: unknown }).foods;
  if (!Array.isArray(foods)) {
    throw new Error(`Claude vision response missing a "foods" array. Raw response: ${text}`);
  }
  return foods as ClaudeFoodEntry[];
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
