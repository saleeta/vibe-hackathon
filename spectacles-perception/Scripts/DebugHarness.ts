import { PerceptionEvents } from './Core/PerceptionEvents';
import { DetectedObject, EatingState, FoodAnalysisResult, HandSide, HandState, HandsSnapshot } from './Core/PerceptionTypes';

/**
 * Debug/testing harness — per spectacles-522-portable-design's "one root +
 * one DebugHarness" rule: the only other scene object this module needs
 * beyond its root controller. Lets every A3-A6 state be reached in preview
 * without real camera input, real hand tracking, or a live backend —
 * useful both in-editor and for a from-scratch demo run.
 *
 * None of this runs unless explicitly invoked — it never fires on its own
 * during normal operation. Call these from the Logger panel or wire a
 * keyboard/UI trigger to them.
 */
@component
export class DebugHarness extends BaseScriptComponent {
  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => {
      print('[DebugHarness] Ready. Call simulateFullBite() from the Logger panel to test A2-A6 without hardware.');
    });
  }

  /** Feeds a fake "food object visible" detection, as if an object detector fired. */
  simulateObjectDetected(label: string = 'apple', confidence: number = 0.9): void {
    const obj: DetectedObject = {
      label,
      confidence,
      boundingBox: { x: 0.4, y: 0.4, width: 0.2, height: 0.2 },
      isFoodClass: true,
    };
    PerceptionEvents.onObjectsDetected.invoke([obj]);
  }

  /** Feeds one static tracked-hand snapshot at a given distance from the face. */
  private emitHandAt(side: HandSide, distanceToFace: number): void {
    const state: HandState = {
      side,
      isTracked: true,
      palmPosition: vec3.zero(),
      indexTipPosition: vec3.zero(),
      velocity: vec3.zero(),
      distanceToFace,
      timestampMillis: getTime() * 1000,
    };
    const other: HandState = {
      side: side === HandSide.Left ? HandSide.Right : HandSide.Left,
      isTracked: false,
      palmPosition: vec3.zero(),
      indexTipPosition: vec3.zero(),
      velocity: vec3.zero(),
      distanceToFace: Number.POSITIVE_INFINITY,
      timestampMillis: getTime() * 1000,
    };
    const snapshot: HandsSnapshot = side === HandSide.Left ? { left: state, right: other } : { left: other, right: state };
    PerceptionEvents.onHandsUpdated.invoke(snapshot);
  }

  /**
   * Animates a hand's distance-to-face from far to near over `durationSeconds`,
   * emitting onHandsUpdated every frame. EatingEventDetector's "approaching"
   * check needs distance to actually decrease across ticks (closing speed) —
   * a single static snapshot never triggers it, so this drives a real ramp
   * rather than teleporting the hand to the face.
   */
  simulateApproach(side: HandSide = HandSide.Right, farDistance: number = 60, nearDistance: number = 2, durationSeconds: number = 0.8): void {
    const startTime = getTime();
    const rampEvent = this.createEvent('UpdateEvent');
    rampEvent.bind(() => {
      const t = Math.min(1, (getTime() - startTime) / durationSeconds);
      const distance = farDistance + (nearDistance - farDistance) * t;
      this.emitHandAt(side, distance);
      if (t >= 1) rampEvent.enabled = false;
    });
  }

  /** Skips straight to a confirmed eating event, bypassing A2-A4 entirely — for testing A5/A6 in isolation. */
  simulateEatingEvent(food: string = 'apple', confidence: number = 0.9): void {
    PerceptionEvents.onEatingEvent.invoke({ food_object: food, confidence, timestampMillis: getTime() * 1000 });
  }

  /** Skips straight to a backend result — for testing A6's auto-display/auto-hide in isolation. */
  simulateFoodAnalyzed(result: FoodAnalysisResult = { name: 'Apple', grams: 180, kcal: 95 }): void {
    PerceptionEvents.onFoodAnalyzed.invoke(result);
  }

  /** Runs the full t0->t4 sequence from the spec to sanity-check A2-A6 wiring end-to-end. */
  simulateFullBite(): void {
    this.simulateObjectDetected('apple', 0.92);
    this.simulateApproach(HandSide.Right);
    print('[DebugHarness] Simulated bite sequence started — watch for EATING_EVENT in onEatingStateChanged logs.');
  }

  getCurrentStateLabel(state: EatingState): string {
    return EatingState[state];
  }
}
