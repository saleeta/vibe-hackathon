/**
 * Real food-recognition (+ vision-direct portion estimation) backend,
 * running entirely on-device via Snap's RemoteServiceGateway package —
 * no self-hosted server, no tunnel. Calls Gemini directly from the Lens
 * (`Gemini.models(...)`), asking it to both identify every food present
 * and estimate each one's weight directly from visual cues (plate size,
 * comparison objects, typical serving sizes) — the alternate
 * portion-estimation path used when there's no hand-geometry data (see
 * PortionEstimator.fromVisionEstimate).
 *
 * Authentication is handled entirely by RemoteServiceGateway's own
 * `RemoteServiceGatewayCredentials` component (its `googleToken` field) —
 * this class never touches a key directly. A `RemoteServiceGatewayCredentials`
 * component must exist somewhere in the scene with a real Google/Gemini
 * token pasted into its Inspector field.
 *
 * One interchangeable implementation of FoodClassifierBackend
 * (../Nutrition/FoodRecognitionService) — swap it for a different vision
 * model/service without touching anything downstream.
 */

import { Gemini } from 'RemoteServiceGateway.lspkg/HostedExternal/Gemini';
import { GoogleGenAITypes } from 'RemoteServiceGateway.lspkg/HostedExternal/GoogleGenAITypes';
import { FoodClassifierBackend } from '../Nutrition/FoodRecognitionService';
import { BoundingBox, FoodRegionDetection } from '../Nutrition/Types';

const MAX_HINT_LENGTH = 100;

// gemini-2.0-flash was shut down 2026-06-01 — 2.5-flash is the current stable
// equivalent (proven/cheaper tier).
const MODEL = 'gemini-2.5-flash';

const SYSTEM_PROMPT = `You are the food-recognition stage of a calorie and nutrition tracker. Given a photo of food, identify every distinct food item visible (a single food, or several on a plate) and estimate each one's portion weight.

Rules:
- "name" must be a lowercase, singular, generic food name (e.g. "banana", "chicken", "rice", "broccoli", "sauce"), not a brand or a full recipe description.
- Look carefully at actual shape, surface texture, and color before naming visually-similar foods. If genuinely ambiguous, prefer the more common/generic identification and lower "confidence" accordingly rather than guessing.
- "confidence" (0-1) is how sure you are this food is actually present.
- "estimated_weight_g" is your best-effort portion weight estimate in grams, reasoned from plate size, typical serving sizes, and any visible scale references.
- "portion_confidence" (0-1) is how sure you are specifically about the weight estimate — usually lower than the identification confidence.
- "bounding_box" is a best-effort NORMALIZED (0-1) region of that food in the image; approximate is fine.
- List every distinct food separately (a plate with rice, chicken, and broccoli is three entries, not one) — this includes drinks/beverages if visible.
- If you cannot identify any food in the image, return an empty foods array.`;

const RESPONSE_SCHEMA: GoogleGenAITypes.Common.Schema = {
  type: 'OBJECT',
  properties: {
    foods: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          confidence: { type: 'NUMBER' },
          estimated_weight_g: { type: 'NUMBER' },
          portion_confidence: { type: 'NUMBER' },
          bounding_box: {
            type: 'OBJECT',
            properties: {
              x: { type: 'NUMBER' },
              y: { type: 'NUMBER' },
              width: { type: 'NUMBER' },
              height: { type: 'NUMBER' },
            },
          },
        },
        required: ['name', 'confidence', 'estimated_weight_g', 'portion_confidence'],
      },
    },
  },
  required: ['foods'],
};

interface VisionFoodEntry {
  name: string;
  confidence: number;
  estimated_weight_g: number;
  portion_confidence: number;
  bounding_box?: { x: number; y: number; width: number; height: number };
}

export class GeminiVisionClassifier implements FoodClassifierBackend {
  async classify(imageBase64: string, _roiHint?: BoundingBox, foodHint?: string): Promise<FoodRegionDetection[]> {
    const { mimeType, data } = parseImageBase64(imageBase64);

    const userText = foodHint
      ? `Identify the food in this image per your instructions. An upstream hint guessed this might be "${sanitizeHint(
          foodHint
        )}" — verify that against what you actually see rather than assuming it's correct.`
      : 'Identify the food in this image per your instructions.';

    print(`[CalorieDetector:Gemini] Calling ${MODEL}...`);
    const response = await Gemini.models({
      model: MODEL,
      type: 'generateContent',
      body: {
        contents: [
          {
            role: 'user',
            parts: [{ text: userText }, { inlineData: { mimeType, data } }],
          },
        ],
        systemInstruction: { role: 'model', parts: [{ text: SYSTEM_PROMPT }] },
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      },
    });

    const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('Gemini vision response contained no text content');
    }

    const foods = parseFoodsJson(text);
    print(`[CalorieDetector:Gemini] Response received — ${foods.length} food(s) identified.`);

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

function parseImageBase64(input: string): { mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; data: string } {
  const dataUrlMatch = input.match(/^data:(image\/(?:jpeg|png|webp));base64,([\s\S]+)$/);
  if (dataUrlMatch) {
    return { mimeType: dataUrlMatch[1] as 'image/jpeg' | 'image/png' | 'image/webp', data: dataUrlMatch[2] };
  }
  return { mimeType: 'image/jpeg', data: input }; // assume raw JPEG base64 if no data: URL prefix
}

function parseFoodsJson(text: string): VisionFoodEntry[] {
  // Structured output (responseSchema) should already be clean JSON, but strip
  // a code fence defensively in case a model variant still wraps it.
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '');

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Gemini vision response was not valid JSON: ${(err as Error).message}\nRaw response: ${text}`);
  }

  const foods = (parsed as { foods?: unknown }).foods;
  if (!Array.isArray(foods)) {
    throw new Error(`Gemini vision response missing a "foods" array. Raw response: ${text}`);
  }
  return foods as VisionFoodEntry[];
}

/** Unit-square convention (imageWidth/imageHeight = 1) since these are normalized, best-effort boxes, not pixel-precise. */
function toBoundingBox(box?: { x: number; y: number; width: number; height: number }): BoundingBox {
  const b = box ?? { x: 0, y: 0, width: 1, height: 1 };
  return { x: b.x, y: b.y, width: b.width, height: b.height, imageWidth: 1, imageHeight: 1 };
}

function normalizeFoodName(name: string): string {
  return (name ?? '').toLowerCase().trim();
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v ?? 0));
}

/** foodHint comes from an upstream classifier, not a trusted source — cap length before it goes into the prompt. */
function sanitizeHint(hint: string): string {
  return hint.slice(0, MAX_HINT_LENGTH).replace(/[\r\n]+/g, ' ').trim();
}
