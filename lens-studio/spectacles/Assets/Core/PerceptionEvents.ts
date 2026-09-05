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
 * THE plug-and-play surface of this whole pipeline.
 *
 * Every script only talks to its neighbors through these signals — never by
 * holding direct references to each other. That's what makes each stage
 * independently pluggable: the main app can wire in a different object
 * detector, replace the UI, or short-circuit straight to `onEatingEvent` for
 * testing, without touching any other file.
 *
 * This is a plain module-level singleton (not a @component), so both Lens
 * Studio scripts and the main app can `import { PerceptionEvents } from ...`
 * and get the same instance.
 */
class PerceptionEventBus {
  /** A new low-res frame was sampled from the perception loop. */
  readonly onFrameSampled = new Signal<{ texture: Texture; timestampMillis: number }>();

  /** A one-off high-quality frame was captured (in response to an eating event). */
  readonly onHighQualityFrameCaptured = new Signal<{ texture: Texture; timestampMillis: number }>();

  /** Latest tracked hand state, both hands, emitted every update tick. */
  readonly onHandsUpdated = new Signal<HandsSnapshot>();

  /** Feed for the food-in-hand classifier: whatever object/food detector is plugged in reports its detections here. */
  readonly onObjectsDetected = new Signal<DetectedObject[]>();

  /** Classification only — intentionally does NOT trigger logging. */
  readonly onFoodInHand = new Signal<FoodInHandResult>();

  /** Fired on every eating-state transition, useful for debugging/HUD overlays. */
  readonly onEatingStateChanged = new Signal<EatingStateChange>();

  /** A full bite cycle was confirmed — this is what triggers HQ capture + the backend call. */
  readonly onEatingEvent = new Signal<EatingEventPayload>();

  /** The nutrition backend responded to a captured frame — the UI listens here to auto-display + auto-log. */
  readonly onFoodAnalyzed = new Signal<FoodAnalysisResult>();
}

export const PerceptionEvents = new PerceptionEventBus();
