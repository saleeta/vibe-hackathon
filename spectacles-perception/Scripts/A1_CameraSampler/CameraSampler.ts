import { PerceptionEvents } from '../Core/PerceptionEvents';
import { RingBuffer } from '../Core/RingBuffer';
import { PerformanceProfiler } from './PerformanceProfiler';

/**
 * A1 — Continuous camera sampling.
 *
 *   camera -> sample frames -> run detection
 *
 * Design:
 *  - Runs ONE continuous CameraModule stream (Spectacles hardware exposes
 *    one active color-camera pipeline at a time — re-requesting a second
 *    stream at a different resolution is not something to rely on).
 *  - The stream itself is requested at `lowResSmallerDimension` — cheap,
 *    native-downscaled frames, good enough for detection.
 *  - A software gate (`sampleIntervalMs`, derived from `targetFPS`) throttles
 *    how often we actually *process* a frame, independent of the sensor's
 *    native delivery rate. This is the "10-15 FPS perception" budget.
 *  - `captureHighQuality()` re-issues the CameraRequest at
 *    `hqSmallerDimension` for a single frame, then drops back to the cheap
 *    resolution. This is only ever called by A5, on a confirmed eating
 *    event — never on every frame.
 *  - Self-throttles further (drops target FPS) if the perception loop is
 *    consistently over its per-frame time budget, so this doesn't become
 *    a battery hog on-device.
 *
 * TODO(verify in-editor): confirm CameraRequest re-configuration behavior
 * (switching imageSmallerDimension on an already-running stream) against
 * the installed Lens Studio 5.15.4 CameraModule — fall back to tearing
 * down/recreating the texture request if hot-swapping resolution isn't
 * supported.
 */
@component
export class CameraSampler extends BaseScriptComponent {
  @input
  cameraModule: CameraModule;

  @input
  @hint('Perception loop rate. 10-15 FPS is the spec target.')
  targetFPS: number = 12;

  @input
  @hint('Native capture resolution (long edge) used for cheap, continuous perception.')
  lowResSmallerDimension: number = 320;

  @input
  @hint('Capture resolution (long edge) used only for the one-off HQ frame sent to the backend.')
  hqSmallerDimension: number = 1280;

  @input
  @hint('How many recent sample timestamps to keep for FPS/perf bookkeeping.')
  historySize: number = 30;

  @input
  @hint('If the loop is consistently slower than this, targetFPS is halved automatically (min 4).')
  perFrameBudgetMillis: number = 60;

  private cameraTexture: Texture;
  private sampleIntervalMs: number = 0;
  private msSinceLastSample: number = 0;
  private profiler = new PerformanceProfiler(30);
  private sampleHistory = new RingBuffer<{ timestampMillis: number }>(this.historySize);
  private hqCapturePending: ((tex: Texture) => void) | null = null;

  onAwake(): void {
    this.sampleIntervalMs = 1000 / Math.max(1, this.targetFPS);
    this.createEvent('OnStartEvent').bind(() => this.startLowResStream());
    this.createEvent('UpdateEvent').bind(() => this.onUpdate());
  }

  private startLowResStream(): void {
    const request = CameraModule.createCameraRequest();
    request.cameraId = CameraModule.CameraId.Default_Color;
    request.imageSmallerDimension = this.lowResSmallerDimension;
    this.cameraTexture = this.cameraModule.requestCamera(request);
    this.cameraTexture.control.onNewFrame.add((frame) => this.onNativeFrame(frame));
  }

  private onNativeFrame(frame: CameraFrame): void {
    // Native sensor delivery can exceed our processing budget — gate here.
    if (this.hqCapturePending) {
      // We're mid HQ-capture: this frame is the (higher-res) one we asked for.
      const cb = this.hqCapturePending;
      this.hqCapturePending = null;
      cb(this.cameraTexture);
      this.dropBackToLowRes();
      return;
    }

    if (this.msSinceLastSample < this.sampleIntervalMs) return;
    this.msSinceLastSample = 0;

    this.profiler.begin();
    const timestampMillis = getTime() * 1000;
    this.sampleHistory.push({ timestampMillis });
    PerceptionEvents.onFrameSampled.invoke({ texture: this.cameraTexture, timestampMillis });
    this.profiler.end();

    this.maybeThrottle();
  }

  private onUpdate(): void {
    this.msSinceLastSample += getDeltaTime() * 1000;
  }

  private maybeThrottle(): void {
    if (this.targetFPS <= 4) return;
    if (this.profiler.isOverBudget(this.perFrameBudgetMillis)) {
      this.targetFPS = Math.max(4, Math.floor(this.targetFPS / 2));
      this.sampleIntervalMs = 1000 / this.targetFPS;
      print(`[CameraSampler] Over perf budget — throttling to ${this.targetFPS} FPS`);
    }
  }

  /**
   * A5 calls this on a confirmed eating event. Resolves with a single
   * higher-resolution frame, then the stream drops back to the cheap
   * perception resolution automatically.
   */
  captureHighQuality(): Promise<Texture> {
    return new Promise((resolve) => {
      this.hqCapturePending = resolve;
      const request = CameraModule.createCameraRequest();
      request.cameraId = CameraModule.CameraId.Default_Color;
      request.imageSmallerDimension = this.hqSmallerDimension;
      this.cameraTexture = this.cameraModule.requestCamera(request);
      this.cameraTexture.control.onNewFrame.add((frame) => this.onNativeFrame(frame));
    });
  }

  private dropBackToLowRes(): void {
    const request = CameraModule.createCameraRequest();
    request.cameraId = CameraModule.CameraId.Default_Color;
    request.imageSmallerDimension = this.lowResSmallerDimension;
    this.cameraTexture = this.cameraModule.requestCamera(request);
    this.cameraTexture.control.onNewFrame.add((frame) => this.onNativeFrame(frame));
  }

  getCurrentFPS(): number {
    return this.targetFPS;
  }
}
