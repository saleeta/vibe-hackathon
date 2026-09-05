import { PerceptionEvents } from '../Core/PerceptionEvents';
import { RingBuffer } from '../Core/RingBuffer';
import { PerformanceProfiler } from './PerformanceProfiler';

/**
 * Continuous camera sampling.
 *
 *   camera -> sample frames -> run detection
 *
 * Design:
 *  - Runs ONE continuous CameraModule stream (Spectacles hardware exposes
 *    one active color-camera pipeline at a time) via `requestCamera()`, at
 *    `lowResSmallerDimension`.
 *  - A software gate (`sampleIntervalMs`, derived from `targetFPS`) throttles
 *    how often we actually *process* a frame, independent of the sensor's
 *    native delivery rate. This is the "10-15 FPS perception" budget.
 *  - `captureHighQuality()` just hands back this same continuous-stream
 *    texture — two other approaches were tried and confirmed broken on real
 *    hardware first: re-requesting `requestCamera()` at a higher resolution
 *    while the stream is active gets capped to the original stream's
 *    resolution (not the new one), and the dedicated
 *    `cameraModule.requestImage()` still-capture API throws "Image request
 *    not supported" (likely can't run concurrently with an active
 *    `requestCamera()` stream). So `lowResSmallerDimension` now does double
 *    duty as the effective capture quality too — raise it if recognition
 *    accuracy needs a sharper source image; the on-device object detector
 *    is the only other consumer of this same texture, so the perception-loop
 *    cost of a higher resolution only matters once that detector is actually
 *    running inference every sampled frame.
 *  - Self-throttles further (drops target FPS) if the perception loop is
 *    consistently over its per-frame time budget, so this doesn't become
 *    a battery hog on-device.
 *
 * `.control` is typed as the generic TextureProvider, which has no
 * onNewFrame — cast to CameraTextureProvider, which does (confirmed against
 * https://developers.snap.com/lens-studio/api/lens-scripting/interfaces/Built-In.CameraTextureProvider.html).
 */
@component
export class CameraSampler extends BaseScriptComponent {
  @input
  cameraModule: CameraModule;

  @input
  @hint('Perception loop rate. 10-15 FPS is the spec target.')
  targetFPS: number = 12;

  @input
  @hint('Native capture resolution (long edge) — used for continuous perception AND as the effective quality of the HQ capture sent to Gemini (see captureHighQuality). Raised from the original 320 since this is now doing double duty.')
  lowResSmallerDimension: number = 640;

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
    const request = CameraModule.createCameraRequest();
    request.cameraId = CameraModule.CameraId.Default_Color;
    request.imageSmallerDimension = this.lowResSmallerDimension;
    this.cameraTexture = this.cameraModule.requestCamera(request);
    (this.cameraTexture.control as CameraTextureProvider).onNewFrame.add((frame) => this.onNativeFrame(frame));
  }

  private onNativeFrame(_frame: CameraFrame): void {
    // Native sensor delivery can exceed our processing budget — gate here.
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
      print(`[FoodLens:Camera] Over perf budget — throttling to ${this.targetFPS} FPS`);
    }
  }

  /**
   * The eating-trigger stage calls this on a confirmed eating event.
   *
   * Two other approaches were tried first and confirmed broken on real
   * Spectacles hardware: re-requesting `requestCamera()` at a higher
   * `imageSmallerDimension` while the continuous stream is active gets
   * capped to the original stream's resolution, not the new one; and the
   * dedicated `cameraModule.requestImage()` still-capture API throws
   * "Image request not supported" — likely because it can't run
   * concurrently with an already-active `requestCamera()` stream, though
   * that's undocumented. Simplest reliable option: just hand back the
   * current continuous-stream texture. Lower resolution than a true HQ
   * capture would be, but it's the same texture the perception loop is
   * already reading successfully every frame, so it works with zero
   * additional camera-API surface — and it's still plenty for Gemini to
   * identify food from.
   *
   * Returns `copyFrame()`, not the live texture reference directly: the
   * live camera-stream texture keeps updating every native frame, and
   * handing that moving target to Base64.encodeTextureAsync() threw
   * "Value is not a native object" on real hardware — copyFrame() snapshots
   * the current pixels into a stable, independent Texture safe to encode.
   */
  async captureHighQuality(): Promise<Texture> {
    return this.cameraTexture.copyFrame();
  }

  getCurrentFPS(): number {
    return this.targetFPS;
  }
}
