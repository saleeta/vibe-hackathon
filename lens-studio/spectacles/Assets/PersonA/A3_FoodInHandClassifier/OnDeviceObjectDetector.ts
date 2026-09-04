import { PerceptionEvents } from '../Core/PerceptionEvents';
import { DetectedObject } from '../Core/PerceptionTypes';
import { Signal } from '../Core/Signal';
import { IObjectDetector } from './IObjectDetector';

/**
 * Reference IObjectDetector implementation, running a Lens Studio
 * MLComponent (food/object classification model) against each sampled
 * frame from A1.
 *
 * This is intentionally a thin adapter: swap it for a cloud-based detector,
 * a mocked one for testing, or a different model without touching A2-A6 —
 * they all just listen to PerceptionEvents.onObjectsDetected.
 *
 * MLComponent usage verified against
 * https://developers.snap.com/lens-studio/api/lens-scripting/classes/Built-In.MLComponent.html
 * and the SnapML overview (https://developers.snap.com/lens-studio/features/snap-ml/ml-component/ml-component-overview):
 *  - Supported model formats: ONNX (.onnx) and TensorFlow Lite (.tflite),
 *    imported into the Asset Browser and assigned to `mlComponent.model`.
 *  - Input binding is `mlComponent.getInput(name).texture = <texture>` —
 *    reassignable per call, which is what lets this component feed it a
 *    new texture every sampled frame instead of a static Inspector-bound one.
 *  - `runImmediate(true)` runs inference synchronously — used here (rather
 *    than `autoRun`, which re-runs every RENDER frame) so inference only
 *    happens at A1's throttled sample rate, matching A1's stated perf
 *    posture (10-15 FPS, not full camera rate).
 *  - Output is `mlComponent.getOutput(name).data`, a Float32Array — not
 *    reliable before `onLoadingFinished` has fired at least once.
 *
 * TODO(model-specific — fill in once the trained model is chosen):
 *  - `classLabels` must match the model's output class order.
 *  - `inputName`/`outputName` must match the actual tensor names the
 *    model/Inspector setup uses (defaults below are common conventions,
 *    not guaranteed for every exported model).
 *  - `decodeOutput` assumes a simple single-label classifier over the
 *    whole frame (a softmax vector) as the MVP baseline, with the whole
 *    frame treated as one "detected object" covering the full bounding
 *    box — adequate for "is there food in view" but not multi-object
 *    localization. Upgrade to a real detector's box+score output when
 *    available.
 */
@component
export class OnDeviceObjectDetector extends BaseScriptComponent implements IObjectDetector {
  @input
  mlComponent: MLComponent;

  @input
  @hint('Tensor name of the model input the frame texture binds to.')
  inputName: string = 'input';

  @input
  @hint('Tensor name of the model output to read class scores from.')
  outputName: string = 'output';

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
  private modelReady = false;
  private unsubscribe: (() => void) | null = null;

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.start());
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    if (this.mlComponent) {
      this.mlComponent.onLoadingFinished = () => {
        this.modelReady = true;
      };
    }

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
    if (!this.mlComponent || !this.modelReady || this.classLabels.length === 0) return;

    const input = this.mlComponent.getInput(this.inputName);
    const output = this.mlComponent.getOutput(this.outputName);
    if (!input || !output) return;

    input.texture = texture;
    this.mlComponent.runImmediate(true); // synchronous — result is valid to read immediately after

    const scores = output.data;
    if (!scores) return;

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
