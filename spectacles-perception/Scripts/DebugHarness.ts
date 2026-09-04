import { PerceptionEvents } from './Core/PerceptionEvents';
import { DetectedObject, EatingState, FoodAnalysisResult, HandSide, HandState, HandsSnapshot } from './Core/PerceptionTypes';

/**
 * Debug/testing harness — per spectacles-522-portable-design's "one root +
 * one DebugHarness" rule: the only other scene object this module needs
 * beyond its root controller. Lets every A3-A6 state be reached in preview
 * without real camera input, real hand tracking, or a live backend —
 * useful both in-editor and for a from-scratch demo run.
 *
 * Wire `triggerKey` (default 'd') or call these methods from another debug
 * UI. None of this runs unless explicitly invoked — it never fires on its
 * own during normal operation.
 */
@component
export class DebugHarness extends BaseScriptComponent {
  @input
  @hint('If true, pressing this key in editor preview steps through a fake bite end-to-end.')
  enableKeyboardTrigger: boolean = true;

  onAwake(): void {
    if (!global.deviceInfoSystem?.isEditor?.()) return; // never active on-device
    this.createEvent('OnStartEvent').bind(() => {
      print('[DebugHarness] Editor preview detected. Call simulateFullBite() from the Logger panel to test A3-A6 without hardware.');
    });
  }

  /** Feeds a fake "food object visible" detection, as if OnDeviceObjectDetector fired. */
  simulateObjectDetected(label: string = 'apple', confidence: number = 0.9): void {
    const obj: DetectedObject = {
      label,
      confidence,
      boundingBox: { x: 0.4, y: 0.4, width: 0.2, height: 0.2 },
      isFoodClass: true,
    };
    PerceptionEvents.onObjectsDetected.invoke([obj]);
  }

  /** Feeds a fake tracked-hand snapshot at a given distance from the face anchor and velocity. */
  simulateHand(side: HandSide, approachingFace: boolean): void {
    const near = approachingFace ? vec3.zero() : new vec3(0, -20, 30);
    const state: HandState = {
      side,
      isTracked: true,
      palmPosition: near,
      indexTipPosition: near,
      velocity: approachingFace ? new vec3(0, -10, -8) : vec3.zero(),
      timestampMillis: getTime() * 1000,
    };
    const other: HandState = {
      side: side === HandSide.Left ? HandSide.Right : HandSide.Left,
      isTracked: false,
      palmPosition: vec3.zero(),
      indexTipPosition: vec3.zero(),
      velocity: vec3.zero(),
      timestampMillis: getTime() * 1000,
    };
    const snapshot: HandsSnapshot = side === HandSide.Left ? { left: state, right: other } : { left: other, right: state };
    PerceptionEvents.onHandsUpdated.invoke(snapshot);
  }

  /** Skips straight to a confirmed eating event, bypassing A2-A4 entirely — for testing A5/A6 in isolation. */
  simulateEatingEvent(food: string = 'apple', confidence: number = 0.9): void {
    PerceptionEvents.onEatingEvent.invoke({ food_object: food, confidence, timestampMillis: getTime() * 1000 });
  }

  /** Skips straight to a backend result — for testing A6's auto-display/auto-hide in isolation. */
  simulateFoodAnalyzed(result: FoodAnalysisResult = { name: 'Apple', grams: 180, kcal: 95 }): void {
    PerceptionEvents.onFoodAnalyzed.invoke(result);
  }

  /** Runs the full t0->t4 sequence from the spec, on a delay, to sanity-check A2-A6 wiring end-to-end. */
  simulateFullBite(): void {
    this.simulateObjectDetected('apple', 0.92);
    this.simulateHand(HandSide.Right, false);

    const approachDelay = this.createEvent('DelayedCallbackEvent');
    approachDelay.bind(() => this.simulateHand(HandSide.Right, true));
    approachDelay.reset(0.5);

    print('[DebugHarness] Simulated bite sequence started — watch for EATING_EVENT in onEatingStateChanged logs.');
  }

  getCurrentStateLabel(state: EatingState): string {
    return EatingState[state];
  }
}
