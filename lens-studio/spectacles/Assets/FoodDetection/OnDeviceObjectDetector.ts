import { PerceptionEvents } from '../Core/PerceptionEvents';
import { DetectedObject } from '../Core/PerceptionTypes';
import { Signal } from '../Core/Signal';
import { IObjectDetector } from './IObjectDetector';

/**
 * Reference IObjectDetector implementation, running a Lens Studio
 * MLComponent (the installed Food Detection Model, an SSD-style anchor-based
 * single-class detector) against each sampled frame from the camera sampler.
 *
 * This is intentionally a thin adapter: swap it for a cloud-based detector,
 * a mocked one for testing, or a different model without touching the rest
 * of the pipeline — they all just listen to PerceptionEvents.onObjectsDetected.
 *
 * Decode strategy verified against the installed Object Detection template's
 * own reference script (`Assets/Object Detection.lspkg/Scripts/MLController.js`):
 *  - Input binding: `mlComponent.getInput("data").texture = <texture>`.
 *  - Outputs are `cls` (per-anchor confidence, one score per anchor cell —
 *    this is a single-class detector, not a multi-class softmax vector) and
 *    `loc` (per-anchor [dx, dy, dw, dh] box regression), both Float32Array.
 *    Anchor centers are a uniform grid derived from `loc`'s output shape
 *    (`shape.x` x `shape.y` cells), computed once in `onLoadingFinished`.
 *  - Decoding is anchor + offset -> box, filtered by `confidenceThreshold`,
 *    reduced by standard greedy NMS (`nmsThreshold`, capped at `topK`) — the
 *    exact math is ported from MLController.js's `postprocessDetections`/`nms`.
 *  - Boxes are left in the model's normalized anchor space (skipping the
 *    reference script's `inputTransformer.inverseMatrix` remap to screen
 *    space) since this pipeline only needs approximate hand-proximity boxes,
 *    not precise on-screen overlay placement — one less matrix multiply per
 *    detection, which matters at the throttled-but-still-continuous
 *    perception rate.
 *  - `runImmediate(true)` runs inference synchronously — used here (rather
 *    than `autoRun`, which re-runs every RENDER frame) so inference only
 *    happens at the camera sampler's throttled sample rate, matching its
 *    stated perf posture (10-15 FPS, not full camera rate).
 *  - Output is not reliable before `onLoadingFinished` has fired at least once.
 *
 * Every detection from this single-class model is treated as food
 * (`isFoodClass: true`) — swap `label` if the installed model is retrained
 * for a different single class.
 */
@component
export class OnDeviceObjectDetector extends BaseScriptComponent implements IObjectDetector {
  @input
  mlComponent: MLComponent;

  @input
  @hint('Tensor name of the model input the frame texture binds to.')
  inputName: string = 'data';

  @input
  @hint('Tensor name of the per-anchor confidence output.')
  outputClsName: string = 'cls';

  @input
  @hint('Tensor name of the per-anchor [dx,dy,dw,dh] box-regression output.')
  outputLocName: string = 'loc';

  @input
  @hint('Class label reported for every detection from this single-class model.')
  label: string = 'food';

  @input
  confidenceThreshold: number = 0.45;

  @input
  @hint('IoU threshold for greedy non-max suppression.')
  nmsThreshold: number = 0.45;

  @input
  @hint('Keep at most this many detections per frame.')
  topK: number = 10;

  readonly onObjectsDetected = new Signal<DetectedObject[]>();

  private running = false;
  private modelReady = false;
  private unsubscribe: (() => void) | null = null;
  private anchors: Array<[number, number]> = [];

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.start());
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    if (this.mlComponent) {
      this.mlComponent.onLoadingFinished = () => this.onModelReady();
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

  private onModelReady(): void {
    const locOutput = this.mlComponent.getOutput(this.outputLocName);
    if (!locOutput) {
      print(`[FoodLens:Detector] ERROR — model loaded but output "${this.outputLocName}" not found — check outputLocName matches the model.`);
      return;
    }
    this.computeAnchorCenters(locOutput.shape.x, locOutput.shape.y);
    this.modelReady = true;
    print(`[FoodLens:Detector] Model loaded, ready for inference (anchor grid ${locOutput.shape.x}x${locOutput.shape.y}).`);
  }

  private computeAnchorCenters(width: number, height: number): void {
    this.anchors = new Array(width * height);
    let i = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        this.anchors[i] = [(x + 0.5) / width, (y + 0.5) / height];
        i++;
      }
    }
  }

  /** Edge-triggered logging state — only print on transitions, never per-frame, so real signal doesn't drown in perception-loop-rate noise. */
  private hasLoggedFirstInference = false;
  private wasDetectingLastFrame = false;

  private runInference(texture: Texture): void {
    if (!this.mlComponent || !this.modelReady || this.anchors.length === 0) return;

    const input = this.mlComponent.getInput(this.inputName);
    if (!input) {
      print(`[FoodLens:Detector] ERROR — input "${this.inputName}" not found on model.`);
      return;
    }
    input.texture = texture;
    this.mlComponent.runImmediate(true); // synchronous — result is valid to read immediately after

    const clsOut = this.mlComponent.getOutput(this.outputClsName)?.data;
    const locOut = this.mlComponent.getOutput(this.outputLocName)?.data;
    if (!clsOut || !locOut) {
      print(`[FoodLens:Detector] ERROR — output missing (cls=${!!clsOut} loc=${!!locOut}).`);
      return;
    }

    if (!this.hasLoggedFirstInference) {
      this.hasLoggedFirstInference = true;
      print('[FoodLens:Detector] Inference running.');
    }

    const detections = this.decode(clsOut, locOut);
    const isDetecting = detections.length > 0;
    if (isDetecting && !this.wasDetectingLastFrame) {
      const top = detections.reduce((a, b) => (a.confidence >= b.confidence ? a : b));
      print(`[FoodLens:Detector] "${top.label}" detected (confidence ${top.confidence.toFixed(2)}).`);
    }
    this.wasDetectingLastFrame = isDetecting;

    this.onObjectsDetected.invoke(detections);
    PerceptionEvents.onObjectsDetected.invoke(detections);
  }

  /** Anchor + offset -> box, filtered by confidence, reduced by NMS. Boxes stay in normalized [0-1] anchor space. */
  private decode(clsOut: Float32Array, locOut: Float32Array): DetectedObject[] {
    const candidateBoxes: number[][] = [];
    const candidateScores: number[] = [];

    for (let i = 0; i < this.anchors.length; i++) {
      const score = clsOut[i];
      if (score < this.confidenceThreshold) continue;

      const [ax, ay] = this.anchors[i];
      const dx = locOut[i * 4];
      const dy = locOut[i * 4 + 1];
      const dw = locOut[i * 4 + 2] * 0.5;
      const dh = locOut[i * 4 + 3] * 0.5;
      const bx = ax + dx;
      const by = ay + dy;

      candidateBoxes.push([bx - dw, by - dh, bx + dw, by + dh]);
      candidateScores.push(score);
    }

    const kept = greedyNms(candidateBoxes, candidateScores, this.nmsThreshold, this.topK);

    return kept.map(({ box, score }) => ({
      label: this.label,
      confidence: score,
      boundingBox: {
        x: clamp01(box[0]),
        y: clamp01(box[1]),
        width: clamp01(box[2] - box[0]),
        height: clamp01(box[3] - box[1]),
      },
      isFoodClass: true,
    }));
  }
}

interface Kept {
  box: number[];
  score: number;
}

/** Standard greedy NMS: repeatedly keep the highest-scoring remaining box, drop anything overlapping it past `threshold`. */
function greedyNms(boxes: number[][], scores: number[], threshold: number, topK: number): Kept[] {
  const indices = boxes.map((_, i) => i).sort((a, b) => scores[a] - scores[b]); // ascending
  const kept: Kept[] = [];

  while (indices.length > 0 && kept.length < topK) {
    const lastIdx = indices.pop() as number;
    const lastBox = boxes[lastIdx];
    kept.push({ box: lastBox, score: scores[lastIdx] });

    for (let i = indices.length - 1; i >= 0; i--) {
      if (iou(lastBox, boxes[indices[i]]) >= threshold) {
        indices.splice(i, 1);
      }
    }
  }

  return kept;
}

function iou(a: number[], b: number[]): number {
  const xx1 = Math.max(a[0], b[0]);
  const yy1 = Math.max(a[1], b[1]);
  const xx2 = Math.min(a[2], b[2]);
  const yy2 = Math.min(a[3], b[3]);
  const inter = Math.max(0, xx2 - xx1) * Math.max(0, yy2 - yy1);
  const areaA = (a[2] - a[0]) * (a[3] - a[1]);
  const areaB = (b[2] - b[0]) * (b[3] - b[1]);
  return inter / (areaA + areaB - inter);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
