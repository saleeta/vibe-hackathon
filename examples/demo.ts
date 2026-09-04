/**
 * End-to-end demo of B1-B6 running in plain Node — no Lens Studio or camera
 * needed. Simulates a plate of food being eaten over several "eating event"
 * frames, including the case B5 exists to handle: the same bite of chicken
 * gets seen twice in a row (duplicate frames) and must NOT be double-counted,
 * while a later, separate handful of chicken (after rice/broccoli) DOES get
 * counted as new intake.
 *
 * Prereq: nutrition-service running locally.
 *   cd nutrition-service && npm install && npm run dev
 * Then, from examples/:
 *   npm install && npm start
 */

import {
  FoodRecognitionService,
  MockFoodClassifierBackend,
} from "../lens-studio/Assets/Scripts/PersonB/FoodRecognitionService";
import { PortionEstimator } from "../lens-studio/Assets/Scripts/PersonB/PortionEstimator";
import { NutritionClient } from "../lens-studio/Assets/Scripts/PersonB/NutritionClient";
import { EatingSessionManager } from "../lens-studio/Assets/Scripts/PersonB/EatingSessionManager";
import { ConfidenceAggregator } from "../lens-studio/Assets/Scripts/PersonB/ConfidenceAggregator";
import { BoundingBox, HandObservation, EatingSession } from "../lens-studio/Assets/Scripts/PersonB/Types";

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

// [timestampSec, foodLabel, confidence, boxWidthPx, boxHeightPx]
const FRAMES: [number, string, number, number, number][] = [
  [0, "chicken", 0.93, 180, 140],
  [2, "chicken", 0.95, 182, 138], // duplicate look at the same bite — must NOT double count (B5)
  [10, "rice", 0.9, 200, 150],
  [18, "broccoli", 0.85, 150, 130],
  [30, "chicken", 0.91, 170, 145], // a genuinely new handful, well after the gap — DOES count
];

async function main() {
  const foodRecognition = new FoodRecognitionService(
    new MockFoodClassifierBackend(FRAMES.map(([, name, confidence]) => [{ name, confidence }]))
  );
  const portionEstimator = new PortionEstimator();
  const nutritionClient = new NutritionClient(NUTRITION_SERVICE_URL, postJson);

  let closedSession: EatingSession | null = null;
  const sessionManager = new EatingSessionManager((session) => {
    closedSession = session;
  });

  for (const [timestampSec, , , w, h] of FRAMES) {
    const recognition = await foodRecognition.recognize("<base64-frame-omitted-in-demo>");
    const top = FoodRecognitionService.topCandidate(recognition)!;
    const portion = portionEstimator.estimate(top.name, box(w, h), hand, top.confidence);

    sessionManager.addObservation({
      timestampSec,
      food: top.name,
      weightG: portion.estimatedWeightG,
      weightUncertaintyG: portion.uncertaintyG,
      foodConfidence: top.confidence,
      portionConfidence: portion.confidence,
    });

    const obsConfidence = ConfidenceAggregator.forObservation(0.96, top.confidence, portion.confidence);
    console.log(
      `t=${timestampSec}s  ${top.name.padEnd(9)} ~${portion.estimatedWeightG}g ± ${portion.uncertaintyG}g` +
        `  (overall confidence ${obsConfidence.overall})`
    );
  }

  console.log("\nSession before close:");
  console.table(EatingSessionManager.summarizeByFood(sessionManager.current!));

  // Simulate the inactivity timeout firing (in the real Lens this comes from the update tick).
  sessionManager.closeActiveSession(FRAMES[FRAMES.length - 1][0] + 200);

  if (!closedSession) throw new Error("expected session to close");
  const session: EatingSession = closedSession;

  const mealItems = EatingSessionManager.summarizeByFood(session);
  const { totals } = await nutritionClient.meal(mealItems);
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
}

main().catch((err) => {
  console.error(err);
  console.error("\nIs nutrition-service running? cd nutrition-service && npm run dev");
  process.exit(1);
});
