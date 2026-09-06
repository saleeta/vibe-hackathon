/**
 * Real food-recognition (+ vision-direct portion estimation) backend,
 * running entirely on-device via Snap's RemoteServiceGateway package —
 * no self-hosted server, no tunnel. Calls Gemini directly from the Lens
 * (`Gemini.models(...)`), asking it to both identify every food present
 * and estimate each one's weight directly from visual cues (plate size,
 * comparison objects, typical serving sizes) — the alternate
 * portion-estimation path used when there's no hand in frame to use as a
 * scale reference (see PortionEstimator.fromVisionEstimate).
 *
 * Authentication is handled entirely by RemoteServiceGateway's own
 * `RemoteServiceGatewayCredentials` component (its `googleToken` field) —
 * this class never touches a key directly, matching the pattern in Snap's
 * own reference sample (`RemoteServiceGateway.lspkg/HostedExternal/Examples/ExampleGeminiCalls.ts`).
 *
 * This is one interchangeable implementation of FoodClassifierBackend
 * (../Nutrition/FoodRecognitionService) — swap it for a different vision
 * model/service without touching anything downstream.
 */

import { Gemini } from 'RemoteServiceGateway.lspkg/HostedExternal/GoogleGenAI';
import { GoogleGenAITypes } from 'RemoteServiceGateway.lspkg/HostedExternal/GoogleGenAITypes';
import { FoodClassifierBackend } from '../Nutrition/FoodRecognitionService';
import { BoundingBox, FoodRegionDetection } from '../Nutrition/Types';

const MAX_HINT_LENGTH = 100;

// gemini-2.0-flash was shut down 2026-06-01 — 2.5-flash is the current stable
// equivalent (proven/cheaper tier; gemini-3.x-flash is the newer frontier
// tier if you want to try it instead).
const MODEL = 'gemini-2.5-flash';

const SYSTEM_PROMPT = `You are the food-recognition stage of a calorie and nutrition tracker. Given a photo of food, identify every distinct food item visible (a single food, or several on a plate), estimate each one's portion weight, and estimate its key nutrients per 100 g.

Rules:
- "name" must be a lowercase, singular, generic food name (e.g. "banana", "chicken", "rice", "broccoli", "sauce"), not a brand or a full recipe description.
- Look carefully at actual shape, surface texture, and color before naming visually-similar foods (e.g. a plain or braided loaf of bread vs. a pretzel's characteristic twisted knot and darker glossy crust; a bagel's ring vs. a donut's). If genuinely ambiguous, prefer the more common/generic identification and lower "confidence" accordingly rather than guessing the more visually distinctive option.
- "confidence" (0-1) is how sure you are this food is actually present.
- "estimated_weight_g" is your best-effort portion weight estimate in grams, reasoned from plate size, typical serving sizes, and any visible scale references.
- "portion_confidence" (0-1) is how sure you are specifically about the weight estimate — usually lower than the identification confidence.
- "bounding_box" is a best-effort NORMALIZED (0-1) region of that food in the image; approximate is fine.
- "sugars_g_per_100g", "sat_fat_g_per_100g", "sodium_mg_per_100g", "fibre_g_per_100g": your best estimate of that food's typical nutrient content per 100 g (NOT per the portion shown). Use standard food-composition knowledge for the identified food. Sodium in milligrams; the rest in grams.
- "plant_percent" (0-100): what percentage of this item is fruit, vegetable, legume, or nut. 100 for a whole fruit/vegetable, 0 for meat / plain bread / soda, something in between for a mixed dish.
- "held_in_hand" (true/false): true if this food is being physically held/gripped by a visible hand or fingers, OR if it is on/in a plate, bowl, cup, tray, wrapper, or other container that is itself being held by a visible hand. Food resting on a table, counter, or a plate sitting on a surface — even in the foreground — is false. If no hand is visible at all, this is false for every item.
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
          sugars_g_per_100g: { type: 'NUMBER' },
          sat_fat_g_per_100g: { type: 'NUMBER' },
          sodium_mg_per_100g: { type: 'NUMBER' },
          fibre_g_per_100g: { type: 'NUMBER' },
          plant_percent: { type: 'NUMBER' },
          held_in_hand: { type: 'BOOLEAN' },
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
  sugars_g_per_100g?: number;
  sat_fat_g_per_100g?: number;
  sodium_mg_per_100g?: number;
  fibre_g_per_100g?: number;
  plant_percent?: number;
  held_in_hand?: boolean;
}

export class GeminiVisionClassifier implements FoodClassifierBackend {
  async classify(imageBase64: string, _roiHint?: BoundingBox, foodHint?: string): Promise<FoodRegionDetection[]> {
    const { mimeType, data } = parseImageBase64(imageBase64);

    // foodHint (e.g. the on-device classifier's guess) is a hint to
    // disambiguate with, never trusted blindly — the instruction below asks
    // Gemini to verify it against the image, not to just echo it back.
    const userText = foodHint
      ? `Identify the food in this image per your instructions. An upstream on-device classifier guessed this might be "${sanitizeHint(
          foodHint
        )}" — verify that against what you actually see rather than assuming it's correct.`
      : 'Identify the food in this image per your instructions.';

    print(`[FoodLens:Gemini] Calling ${MODEL}...`);
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
    print(`[FoodLens:Gemini] Response received — ${foods.length} food(s) identified.`);

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
      // Leave undefined (not false) when the model didn't answer, so the
      // downstream gate can stay lenient rather than blocking everything.
      heldInHand: typeof f.held_in_hand === 'boolean' ? f.held_in_hand : undefined,
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

function nonNegative(v: number | undefined): number {
  return typeof v === 'number' && isFinite(v) && v > 0 ? v : 0;
}

function clampPercent(v: number | undefined): number {
  if (typeof v !== 'number' || !isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

/** foodHint comes from an upstream classifier, not a trusted source — cap length before it goes into the prompt. */
function sanitizeHint(hint: string): string {
  return hint.slice(0, MAX_HINT_LENGTH).replace(/[\r\n]+/g, ' ').trim();
}
