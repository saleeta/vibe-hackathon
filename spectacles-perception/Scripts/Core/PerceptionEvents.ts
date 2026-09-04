import { Signal } from './Signal';
import {
  HandsSnapshot,
  DetectedObject,
  FoodInHandResult,
  EatingStateChange,
  EatingEventPayload,
  FoodAnalysisResult,
} from './PerceptionTypes';

/**
 * THE plug-and-play surface of this whole module.
 *
 * Every A1-A6 script only talks to its neighbors through these signals —
 * never by holding direct references to each other. That's what makes each
 * piece independently pluggable: the main app can wire in a different
 * object detector, replace the UI in A6, or short-circuit straight to
 * `onEatingEvent` for testing, without touching any other file.
 *
 * This is a plain module-level singleton (not a @component), so both Lens
 * Studio scripts and the main app can `import { PerceptionEvents } from ...`
 * and get the same instance.
 */
class PerceptionEventBus {
  /** A1: a new low-res frame was sampled from the perception loop. */
  readonly onFrameSampled = new Signal<{ texture: Texture; timestampMillis: number }>();

  /** A1: a one-off high-quality frame was captured (in response to an eating event). */
  readonly onHighQualityFrameCaptured = new Signal<{ texture: Texture; timestampMillis: number }>();

  /** A2: latest tracked hand state, both hands, emitted every update tick. */
  readonly onHandsUpdated = new Signal<HandsSnapshot>();

  /** Feed for A3: whatever object/food detector is plugged in reports its detections here. */
  readonly onObjectsDetected = new Signal<DetectedObject[]>();

  /** A3 output. Classification only — intentionally does NOT trigger logging. */
  readonly onFoodInHand = new Signal<FoodInHandResult>();

  /** A4: fired on every state transition, useful for debugging/HUD overlays. */
  readonly onEatingStateChanged = new Signal<EatingStateChange>();

  /** A4 output / A5 trigger input: a full bite cycle was confirmed. */
  readonly onEatingEvent = new Signal<EatingEventPayload>();

  /** A5 output: Person B's backend responded. A6 listens here to auto-display + auto-log. */
  readonly onFoodAnalyzed = new Signal<FoodAnalysisResult>();
}

export const PerceptionEvents = new PerceptionEventBus();
