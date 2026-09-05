import { DetectedObject } from '../Core/PerceptionTypes';
import { Signal } from '../Core/Signal';

/**
 * Pluggable seam: whatever produces object/food detections (an on-device
 * ML Component, a cloud call, or a stub for testing) implements this and
 * feeds PerceptionEvents.onObjectsDetected. FoodInHandClassifier only ever
 * depends on this interface, never a concrete implementation.
 */
export interface IObjectDetector {
  readonly onObjectsDetected: Signal<DetectedObject[]>;
  start(): void;
  stop(): void;
}
