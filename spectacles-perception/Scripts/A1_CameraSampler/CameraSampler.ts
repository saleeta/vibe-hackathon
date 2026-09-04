import { PerceptionEvents } from '../Core/PerceptionEvents';
import { RingBuffer } from '../Core/RingBuffer';
import { PerformanceProfiler } from './PerformanceProfiler';

// Built-in modules (any type named *Module) can be grabbed via require()
// with the "LensStudio:" prefix — no need to add a CameraModule asset to
// the project or wire an @input for it at all (per Lens Studio's Script
// Modules > Native Modules docs). One less manual Inspector connection.
const nativeCameraModule: CameraModule = require('LensStudio:CameraModule');

/**
 * A1 — Continuous camera sampling.
 *
 *   camera -> sample frames -> run detection
 *
 * Design:
 *  - Runs ONE continuous CameraModule.requestCamera stream at
 *    `lowResSmallerDimension` — cheap, native-downscaled frames, good enough
 *    for detection. A software gate (`sampleIntervalMs`, derived from
 *    `targetFPS`) throttles how often we actually *process* a frame,
 *    independent of the sensor's native delivery rate — the "10-15 FPS
 *    perception" budget from the spec.
 *  - `captureHighQuality()` uses the dedicated one-shot
 *    `CameraModule.requestImage()` API for the HQ frame — this does NOT
 *    disturb the ongoing low-res stream at all (confirmed via
 *    QueryLensStudioRag against the installed Lens Studio 5.15.4 docs),
 *    unlike re-requesting the stream at a different resolution.
 *  - Self-throttles further (drops target FPS) if the perception loop is
 *    consistently over its per-frame time budget, so this doesn't become
 *    a battery hog on-device.
 */
@component
export class CameraSampler extends BaseScriptComponent {
  @input
  @hint('Perception loop rate. 10-15 FPS is the spec target.')
  targetFPS: number = 12;

  @input
  @hint('Native capture resolution (long edge) used for cheap, continuous perception.')
  lowResSmallerDimension: number = 320;

  @input
  @hint('Capture width (px) used only for the one-off HQ frame sent to the backend.')
  hqWidth: number = 1280;

  @input
  @hint('Capture height (px) used only for the one-off HQ frame sent to the backend.')
  hqHeight: number = 960;

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

  onAwake(): void {
    this.sampleIntervalMs = 1000 / Math.max(1, this.targetFPS);
    this.createEvent('OnStartEvent').bind(() => this.startLowResStream());
    this.createEvent('UpdateEvent').bind(() => this.onUpdate());
  }

  private startLowResStream(): void {
    // Editor-preview fallback: webcam/preview camera behavior can differ from
    // on-device — never let a startup failure here take down the rest of the
    // perception pipeline (per spectacles-522-portable-design's "give every
    // feature an isEditor() fallback" rule).
    try {
      const request = CameraModule.createCameraRequest();
      request.cameraId = CameraModule.CameraId.Default_Color;
      request.imageSmallerDimension = this.lowResSmallerDimension;
      this.cameraTexture = nativeCameraModule.requestCamera(request);
    } catch (err) {
      print(`[CameraSampler] Failed to start camera stream (expected in some editor-preview states): ${err}`);
    }
  }

  private onUpdate(): void {
    if (!this.cameraTexture) return;
    this.msSinceLastSample += getDeltaTime() * 1000;
    if (this.msSinceLastSample < this.sampleIntervalMs) return;
    this.msSinceLastSample = 0;

    this.profiler.begin();
    const timestampMillis = getTime() * 1000;
    this.sampleHistory.push({ timestampMillis });
    PerceptionEvents.onFrameSampled.invoke({ texture: this.cameraTexture, timestampMillis });
    this.profiler.end();

    this.maybeThrottle();
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
   * A5 calls this on a confirmed eating event. One-shot HQ capture via
   * CameraModule.requestImage() — doesn't touch the ongoing low-res stream.
   * ImageRequest has no cameraId (always the default camera) and takes an
   * explicit `resolution` vec2 rather than imageSmallerDimension.
   */
  captureHighQuality(): Promise<Texture> {
    const request = CameraModule.createImageRequest();
    request.resolution = new vec2(this.hqWidth, this.hqHeight);
    return nativeCameraModule.requestImage(request).then((imageFrame) => imageFrame.texture);
  }

  getCurrentFPS(): number {
    return this.targetFPS;
  }
}
