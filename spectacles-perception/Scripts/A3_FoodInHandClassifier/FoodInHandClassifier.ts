import { PerceptionEvents } from '../Core/PerceptionEvents';
import { DetectedObject, HandsSnapshot, HandState, FoodInHandResult } from '../Core/PerceptionTypes';
import { findNearestFoodObject } from '../A2_HandTracking/HandObjectRelation';

/**
 * A3 — Food-in-hand detection.
 *
 * Input: latest sampled frame's objects (A3's detector feed) + latest
 * hands (A2). Output: a FoodInHandResult on every re-evaluation.
 *
 * IMPORTANT (per spec): this classifier NEVER triggers a logging event.
 * It only reports "here's what I currently see" — A4's temporal state
 * machine is the only thing allowed to decide a bite actually happened.
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

    const candidates: Array<{ hand: HandState; match: DetectedObject }> = [];
    for (const hand of [this.latestHands.left, this.latestHands.right]) {
      if (!hand.isTracked) continue;
      const match = findNearestFoodObject(hand, this.latestObjects, this.worldCamera);
      if (match && match.confidence >= this.minConfidence) {
        candidates.push({ hand, match });
      }
    }

    let result: FoodInHandResult;
    if (candidates.length === 0) {
      result = { food_in_hand: false, food_object: null, confidence: 0, hand: null };
    } else {
      const best = candidates.reduce((a, b) => (a.match.confidence >= b.match.confidence ? a : b));
      result = {
        food_in_hand: true,
        food_object: best.match.label,
        confidence: best.match.confidence,
        hand: best.hand.side,
      };
    }

    // Classification only — no logging, no backend call. A4 decides what happens next.
    PerceptionEvents.onFoodInHand.invoke(result);
  }
}
