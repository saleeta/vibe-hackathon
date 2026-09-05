/**
 * End-to-end demo of B1-B6 running in plain Node — no Lens Studio or camera
 * needed. Simulates:
 *
 *   1. A single bite of chicken, seen twice in a row (duplicate frames of
 *      the same bite) — must NOT be double-counted.
 *   2. A PLATE — rice + broccoli + sauce all detected in one frame — seen
 *      twice in a row (the plate stays in view across two frames) — must be
 *      logged as one set of calories, and the repeat look must not inflate
 *      any of the three foods.
 *   3. A separate, later handful of chicken, well after the gap — DOES
 *      count as new intake, on top of the first chicken bite.
 *
 * All of it lands in one eating session, closed once, with one nutrition
 * total and one glycemic load estimate — not one log entry per bite/food.
 *
 * Prereq: nutrition-service running locally.
 *   cd nutrition-service && npm install && npm run dev
 * Then, from examples/:
 *   npm install && npm start
 */

import {
  FoodRecognitionService,
  MockFoodClassifierBackend,
} from "../lens-studio/spectacles/Assets/Nutrition/FoodRecognitionService";
import { PortionEstimator } from "../lens-studio/spectacles/Assets/Nutrition/PortionEstimator";
import { NutritionClient } from "../lens-studio/spectacles/Assets/Nutrition/NutritionClient";
import { EatingSessionManager } from "../lens-studio/spectacles/Assets/Nutrition/EatingSessionManager";
import { ConfidenceAggregator } from "../lens-studio/spectacles/Assets/Nutrition/ConfidenceAggregator";
import {
  BoundingBox,
  HandObservation,
  EatingSession,
  FoodRegionDetection,
} from "../lens-studio/spectacles/Assets/Nutrition/Types";

const NUTRITION_SERVICE_URL = "http://localhost:4001";

async function postJson(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

const hand: HandObservation = { distanceMeters: 0.35, handPixelWidth: 220, handWidthCm: 8.5 };
function box(w: number, h: number): BoundingBox {
  return { x: 100, y: 100, width: w, height: h, imageWidth: 1280, imageHeight: 960 };
}
function region(name: string, confidence: number, w: number, h: number): FoodRegionDetection {
  return { boundingBox: box(w, h), candidates: [{ name, confidence }] };
}

// One entry per detected frame; each frame can show one food or several (a plate).
const FRAMES: { timestampSec: number; regions: FoodRegionDetection[]; label: string }[] = [
  { timestampSec: 0, regions: [region("chicken", 0.93, 180, 140)], label: "chicken bite" },
  { timestampSec: 2, regions: [region("chicken", 0.95, 182, 138)], label: "same chicken bite again (duplicate)" },
  {
    timestampSec: 10,
    regions: [region("rice", 0.9, 200, 150), region("broccoli", 0.85, 150, 130), region("sauce", 0.8, 90, 60)],
    label: "plate: rice + broccoli + sauce",
  },
  {
    timestampSec: 12,
    regions: [region("rice", 0.91, 198, 149), region("broccoli", 0.86, 148, 128), region("sauce", 0.79, 88, 61)],
    label: "same plate again (duplicate)",
  },
  { timestampSec: 30, regions: [region("chicken", 0.91, 170, 145)], label: "a separate, later handful of chicken" },
];

async function main() {
  const foodRecognition = new FoodRecognitionService(
    new MockFoodClassifierBackend(FRAMES.map((f) => f.regions))
  );
  const portionEstimator = new PortionEstimator();
  const nutritionClient = new NutritionClient(NUTRITION_SERVICE_URL, postJson);

  let closedSession: EatingSession | null = null;
  const sessionManager = new EatingSessionManager((session) => {
    closedSession = session;
  });

  for (const frame of FRAMES) {
    const recognizedItems = await foodRecognition.recognize("<base64-frame-omitted-in-demo>");

    const observations = recognizedItems.map((item) => {
      const portion = portionEstimator.estimate(item.food, item.boundingBox, hand, item.confidence);
      return {
        food: item.food,
        weightG: portion.estimatedWeightG,
        weightUncertaintyG: portion.uncertaintyG,
        foodConfidence: item.confidence,
        portionConfidence: portion.confidence,
      };
    });

    sessionManager.addPlateObservation(frame.timestampSec, observations);

    console.log(`t=${frame.timestampSec}s  ${frame.label}`);
    recognizedItems.forEach((item, i) => {
      const obs = observations[i];
      const obsConfidence = ConfidenceAggregator.forObservation(0.96, item.confidence, obs.portionConfidence);
      console.log(
        `   ${item.food.padEnd(9)} ~${obs.weightG}g ± ${obs.weightUncertaintyG}g` +
          `  (overall confidence ${obsConfidence.overall})`
      );
    });
  }

  console.log("\nSession before close:");
  console.table(EatingSessionManager.summarizeByFood(sessionManager.current!));

  // Simulate the inactivity timeout firing (in the real Lens this comes from the update tick).
  sessionManager.closeActiveSession(FRAMES[FRAMES.length - 1].timestampSec + 200);

  if (!closedSession) throw new Error("expected session to close");
  const session: EatingSession = closedSession;

  const mealItems = EatingSessionManager.summarizeByFood(session);
  const { totals, glycemicEstimate } = await nutritionClient.meal(mealItems);
  const confidence = ConfidenceAggregator.forSession(session.items, 0.96);

  console.log(`\nEating Session ${session.id}`);
  console.log(`${new Date(session.startedSec * 1000).toISOString()} - inactivity close`);
  console.table(mealItems);
  console.log(
    `Estimated: ${totals.kcal} kcal, ${totals.proteinG}g protein, ${totals.carbsG}g carbs, ${totals.fatG}g fat`
  );
  console.log(
    `Confidence: eating ${confidence.eatingConfidence}, food ${confidence.foodConfidence}, ` +
      `portion ${confidence.portionConfidence}, overall ${confidence.overall}`
  );
  console.log(
    `Estimated glycemic load: ${glycemicEstimate.totalGlycemicLoad} (${glycemicEstimate.category}) ` +
      `— from food composition only, NOT a measured blood glucose reading.`
  );
}

main().catch((err) => {
  console.error(err);
  console.error("\nIs nutrition-service running? cd nutrition-service && npm run dev");
  process.exit(1);
});
