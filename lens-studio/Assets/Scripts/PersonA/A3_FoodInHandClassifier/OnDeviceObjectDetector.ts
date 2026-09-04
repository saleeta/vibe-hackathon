import { PerceptionEvents } from '../Core/PerceptionEvents';
import { DetectedObject } from '../Core/PerceptionTypes';
import { Signal } from '../Core/Signal';
import { IObjectDetector } from './IObjectDetector';

/**
 * Reference IObjectDetector implementation, running a Lens Studio
 * MLComponent (food/object classification or detection model) against each
 * sampled frame from A1.
 *
 * This is intentionally a thin adapter: swap it for a cloud-based detector,
 * a mocked one for testing, or a different model without touching A2-A6 —
 * they all just listen to PerceptionEvents.onObjectsDetected.
 *
 * TODO(model-specific — fill in once the trained model is chosen):
 *  - `classLabels` must match the model's output class order.
 *  - `decodeOutput` must match the model's actual output tensor layout
 *    (single-label classification vs. multi-box detection). The
 *    implementation below assumes a simple single-label classifier over
 *    the whole frame (softmax vector) as the MVP baseline, with the whole
 *    frame treated as one "detected object" covering the full bounding
 *    box — adequate for "is there food in view" but not multi-object
 *    localization. Upgrade to a real detector output (boxes + scores) when
 *    available.
 */
@component
export class OnDeviceObjectDetector extends BaseScriptComponent implements IObjectDetector {
  @input
  mlComponent: MLComponent;

  @input
  @hint('Class labels in the exact order the model outputs them.')
  classLabels: string[] = [];

  @input
  @hint('Which of classLabels count as "food" for A3/A4 purposes.')
  foodLabels: string[] = [];

  @input
  minConfidence: number = 0.4;

  readonly onObjectsDetected = new Signal<DetectedObject[]>();

  private running = false;
  private unsubscribe: (() => void) | null = null;

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.start());
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const handler = (sample: { texture: Texture; timestampMillis: number }) => this.runInference(sample.texture);
    PerceptionEvents.onFrameSampled.add(handler);
    this.unsubscribe = () => PerceptionEvents.onFrameSampled.remove(handler);
  }

  stop(): void {
    this.running = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private runInference(texture: Texture): void {
    if (!this.mlComponent || this.classLabels.length === 0) return;

    // TODO(verify): MLComponent's exact input-binding API. Many Lens Studio
    // ML templates bind the input texture via an InputPlaceholder asset
    // configured in the Inspector rather than a runtime call — if so, this
    // component's `mlComponent` input should instead be that placeholder,
    // and this method just needs to call `this.mlComponent.runScheduled()`
    // or read `mlComponent.getOutput(name)` after the model's own
    // OnLoadEvent/UpdateEvent has already run against the bound texture.
    const outputs = this.mlComponent.getOutput?.('output');
    if (!outputs) return;

    const scores: Float32Array = outputs.data ?? outputs;
    const detections: DetectedObject[] = [];

    for (let i = 0; i < this.classLabels.length; i++) {
      const confidence = scores[i];
      if (confidence < this.minConfidence) continue;
      const label = this.classLabels[i];
      detections.push({
        label,
        confidence,
        boundingBox: { x: 0, y: 0, width: 1, height: 1 }, // whole-frame classifier, no localization
        isFoodClass: this.foodLabels.indexOf(label) >= 0,
      });
    }

    this.onObjectsDetected.invoke(detections);
    PerceptionEvents.onObjectsDetected.invoke(detections);
  }
}
