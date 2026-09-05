import { PerceptionEvents } from '../Core/PerceptionEvents';
import { DetectedObject, HandsSnapshot, HandState, FoodInHandResult } from '../Core/PerceptionTypes';
import { findNearestFoodObject } from '../Hands/HandObjectRelation';

/**
 * Food-in-hand detection.
 *
 * Input: latest sampled frame's detected objects + latest tracked hands.
 * Output: a FoodInHandResult on every re-evaluation.
 *
 * Prefers a real on-device object-detector match near the hand when
 * `OnDeviceObjectDetector`'s model is loaded and producing results — but
 * doesn't hard-depend on it. If no object match is available (no model
 * loaded, or nothing detected this frame), any tracked hand alone counts as
 * "food in hand": the pipeline still needs to work end-to-end without a
 * working on-device model, and the actual cloud vision call downstream
 * (GeminiFoodAnalysisClient) is the real arbiter of whether there's genuine
 * food — an empty hand just results in "no food recognized" there, a silent
 * no-op, not a false log entry. Swap this back to object-match-only once
 * the on-device model is confirmed loading reliably.
 *
 * IMPORTANT (per spec): this classifier NEVER triggers a logging event.
 * It only reports "here's what I currently see" — the eating-event
 * detector's temporal state machine is the only thing allowed to decide a
 * bite actually happened.
 */
@component
export class FoodInHandClassifier extends BaseScriptComponent {
  @input
  @hint('Optional: needed only if the plugged-in detector reports 2D screen-space boxes without world position.')
  worldCamera: Camera;

  @input
  minConfidence: number = 0.5;

  private latestHands: HandsSnapshot | null = null;
  private latestObjects: DetectedObject[] = [];
  private wasFoodInHand = false;

  onAwake(): void {
    PerceptionEvents.onHandsUpdated.add((hands) => {
      this.latestHands = hands;
      this.evaluate();
    });
    PerceptionEvents.onObjectsDetected.add((objects) => {
      this.latestObjects = objects;
      this.evaluate();
    });
  }

  private evaluate(): void {
    if (!this.latestHands) return;

    const trackedHand = [this.latestHands.left, this.latestHands.right].find((h) => h.isTracked) ?? null;

    let result: FoodInHandResult;
    if (!trackedHand) {
      result = { food_in_hand: false, food_object: null, confidence: 0, hand: null };
    } else {
      const objectMatch = findNearestFoodObject(trackedHand, this.latestObjects, this.worldCamera);
      if (objectMatch && objectMatch.confidence >= this.minConfidence) {
        result = {
          food_in_hand: true,
          food_object: objectMatch.label,
          confidence: objectMatch.confidence,
          hand: trackedHand.side,
        };
      } else {
        // Fallback: no on-device detection available — a tracked hand alone
        // is enough to trigger the pipeline; the cloud vision call decides
        // whether there's actually food.
        result = { food_in_hand: true, food_object: 'food', confidence: 0.6, hand: trackedHand.side };
      }
    }

    if (result.food_in_hand && !this.wasFoodInHand) {
      print(`[FoodLens:FoodInHand] Food in hand: "${result.food_object}" (${result.hand}, confidence ${result.confidence.toFixed(2)}).`);
    } else if (!result.food_in_hand && this.wasFoodInHand) {
      print('[FoodLens:FoodInHand] Hand empty / lost.');
    }
    this.wasFoodInHand = result.food_in_hand;

    // Classification only — no logging, no backend call. The eating-event detector decides what happens next.
    PerceptionEvents.onFoodInHand.invoke(result);
  }
}
