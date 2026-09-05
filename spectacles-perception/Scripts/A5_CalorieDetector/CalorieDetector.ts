import { PerceptionEvents } from '../Core/PerceptionEvents';
import { FoodAnalysisResult } from '../Core/PerceptionTypes';
import { CameraSampler } from '../A1_CameraSampler/CameraSampler';
import { encodeTextureToBase64Jpeg } from '../A5_EatingTrigger/TextureEncoding';
import { GeminiVisionClassifier } from './GeminiVisionClassifier';
import { FoodRecognitionService } from '../Nutrition/FoodRecognitionService';
import { PortionEstimator } from '../Nutrition/PortionEstimator';
import { lookupFood } from '../Nutrition/NutritionLookup';
import { scaleNutrition, classifyGlycemicLoad } from '../Nutrition/NutritionScale';
import { RecognizedFoodItem } from '../Nutrition/Types';

const nativeGestureModule: GestureModule = require('LensStudio:GestureModule');

/**
 * Simple, standalone calorie detector, two steps only:
 *
 *   1. Passive scan (every `scanIntervalSeconds`, no interaction needed):
 *      captures a frame, asks Gemini what food is in it, shows just the
 *      NAME on `nameLabel`. No kcal, no nutrition math yet — cheap and
 *      continuous.
 *   2. Pinch: reuses the last passive scan's result (no extra Gemini call)
 *      to compute the full nutrition breakdown and fires
 *      PerceptionEvents.onFoodAnalyzed, which the existing AutoLogDisplay
 *      HUD already shows as the "Apple · ~95 kcal" tile.
 *
 * No eating-event state machine, no session tracking, no automatic
 * backend trigger — deliberately kept to these two steps for this
 * profile's demo.
 *
 * Requires a RemoteServiceGatewayCredentials component enabled somewhere in
 * the scene with a real googleToken set (see GeminiVisionClassifier.ts).
 */
@component
export class CalorieDetector extends BaseScriptComponent {
  @input
  cameraSampler: CameraSampler;

  @input
  @allowUndefined
  @hint('Shows just the food name during the passive scan, e.g. "Apple". Optional.')
  nameLabel: Text;

  @input
  @hint('How often the passive scan captures a frame and asks Gemini what food is in it.')
  scanIntervalSeconds: number = 3;

  @input
  @hint('Which hand triggers the calorie pinch.')
  handType: string = 'right';

  private readonly classifier = new GeminiVisionClassifier();
  private readonly foodRecognition = new FoodRecognitionService(this.classifier);

  private scanBusy = false;
  private pinchBusy = false;
  private lastRecognizedItems: RecognizedFoodItem[] = [];

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => {
      this.wirePinchTrigger();
      this.scheduleNextScan();
    });
  }

  private wirePinchTrigger(): void {
    // GestureModule's pinch events need real hand-tracking hardware and
    // throw an uncaught exception in the desktop simulator — same
    // editor-preview fallback used everywhere else in this project.
    try {
      const hand = this.handType === 'left' ? GestureModule.HandType.Left : GestureModule.HandType.Right;
      nativeGestureModule.getPinchDownEvent(hand).add(() => this.showCalories());
    } catch (err) {
      print(`[CalorieDetector] Failed to wire pinch trigger (expected in some editor-preview states): ${err}`);
    }
  }

  private scheduleNextScan(): void {
    const timer = this.createEvent('DelayedCallbackEvent');
    timer.bind(() => {
      this.passiveScan().finally(() => this.scheduleNextScan());
    });
    timer.reset(this.scanIntervalSeconds);
  }

  /** Step 1 — continuous, no interaction: capture + identify + show just the name. */
  private async passiveScan(): Promise<void> {
    if (this.scanBusy) return;
    this.scanBusy = true;
    try {
      const frame = await this.cameraSampler.captureHighQuality();
      const imageBase64 = await encodeTextureToBase64Jpeg(frame);
      const recognizedItems = await this.foodRecognition.recognize(imageBase64);
      this.lastRecognizedItems = recognizedItems;

      if (recognizedItems.length === 0) {
        this.setNameLabel('');
        return;
      }

      const primary = [...recognizedItems].sort((a, b) => b.confidence - a.confidence)[0];
      this.setNameLabel(capitalize(primary.food));
      print(`[CalorieDetector] Scan: "${primary.food}" (confidence ${Math.round(primary.confidence * 100)}%). Pinch to see calories.`);
    } catch (err) {
      print(`[CalorieDetector] Scan failed: ${err}`);
    } finally {
      this.scanBusy = false;
    }
  }

  /** Step 2 — pinch: turn the last scan's result into a full nutrition breakdown, no new Gemini call. */
  private showCalories(): void {
    if (this.pinchBusy) return;
    if (this.lastRecognizedItems.length === 0) {
      print('[CalorieDetector] Pinch received, but nothing has been identified yet — wait for the next scan.');
      return;
    }
    this.pinchBusy = true;
    try {
      const perItem = this.lastRecognizedItems.map((item) => {
        const portion = item.visionPortionEstimate
          ? PortionEstimator.fromVisionEstimate(item.food, item.visionPortionEstimate, item.confidence)
          : { food: item.food, estimatedWeightG: 0, uncertaintyG: 0, confidence: 0 };
        const { per100g } = lookupFood(item.food);
        const nutrition = scaleNutrition(per100g, portion.estimatedWeightG);
        return {
          food: item.food,
          weightG: portion.estimatedWeightG,
          weightUncertaintyG: portion.uncertaintyG,
          foodConfidence: item.confidence,
          portionConfidence: portion.confidence,
          ...nutrition,
        };
      });

      const primary = [...perItem].sort((a, b) => b.weightG - a.weightG)[0];
      const totalKcal = perItem.reduce((sum, i) => sum + i.kcal, 0);
      const totalGlycemicLoad = perItem.reduce((sum, i) => sum + i.glycemicLoad, 0);

      print(`[CalorieDetector] Pinch: "${primary.food}" ~${Math.round(totalKcal)} kcal total.`);

      const result: FoodAnalysisResult = {
        name: primary.food,
        grams: perItem.reduce((sum, i) => sum + i.weightG, 0),
        kcal: totalKcal,
        confidence: primary.foodConfidence,
        proteinG: perItem.reduce((sum, i) => sum + i.proteinG, 0),
        carbsG: perItem.reduce((sum, i) => sum + i.carbsG, 0),
        fatG: perItem.reduce((sum, i) => sum + i.fatG, 0),
        weightUncertaintyG: primary.weightUncertaintyG,
        glycemicLoad: totalGlycemicLoad,
        glycemicCategory: classifyGlycemicLoad(totalGlycemicLoad),
        foodConfidence: primary.foodConfidence,
        portionConfidence: primary.portionConfidence,
        items: perItem.map((i) => ({ food: i.food, weightG: i.weightG, kcal: i.kcal, proteinG: i.proteinG, carbsG: i.carbsG, fatG: i.fatG })),
      };

      // AutoLogDisplay (and anything else listening) picks this up automatically.
      PerceptionEvents.onFoodAnalyzed.invoke(result);
    } catch (err) {
      print(`[CalorieDetector] ERROR — calorie calculation failed: ${err}`);
    } finally {
      this.pinchBusy = false;
    }
  }

  private setNameLabel(text: string): void {
    if (this.nameLabel) this.nameLabel.text = text;
  }
}

function capitalize(word: string): string {
  return word.length === 0 ? word : word[0].toUpperCase() + word.slice(1);
}
