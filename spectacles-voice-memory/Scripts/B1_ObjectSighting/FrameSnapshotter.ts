import { RingBuffer } from '../Core/RingBuffer';

// Built-in module via require() — no @input asset wiring needed (same
// pattern verified in spectacles-perception's CameraSampler).
const nativeCameraModule: CameraModule = require('LensStudio:CameraModule');

/**
 * B1 — a slow, cheap, independent camera sampler feeding the "rewind"
 * snippet buffer. Deliberately separate from spectacles-perception's
 * CameraSampler (which runs at 10-15 FPS for eating detection): object
 * permanence for "is this still on the table" doesn't need that rate, and
 * this module has to stand alone without depending on that one.
 *
 * If both modules end up in the same app, running two independent
 * CameraModule.requestCamera streams at once has not been verified — worth
 * checking for on device. If it's a problem, point this at the same
 * texture spectacles-perception's CameraSampler already holds instead of
 * requesting a second stream.
 */
@component
export class FrameSnapshotter extends BaseScriptComponent {
  @input
  @hint('Sampling rate for the rewind snippet buffer — low on purpose, this is not the eating-detection loop.')
  sampleFPS: number = 2;

  @input
  smallerDimension: number = 240;

  @input
  @hint('How many frames to keep — at 2 FPS, 10 frames is a 5-second lookback.')
  bufferSize: number = 10;

  private cameraTexture: Texture;
  private buffer: RingBuffer<Texture>;
  private sampleIntervalMs = 0;
  private msSinceLastSample = 0;

  onAwake(): void {
    this.buffer = new RingBuffer<Texture>(this.bufferSize);
    this.sampleIntervalMs = 1000 / Math.max(1, this.sampleFPS);
    this.createEvent('OnStartEvent').bind(() => this.start());
    this.createEvent('UpdateEvent').bind(() => this.onUpdate());
  }

  private start(): void {
    try {
      const request = CameraModule.createCameraRequest();
      request.cameraId = CameraModule.CameraId.Default_Color;
      request.imageSmallerDimension = this.smallerDimension;
      this.cameraTexture = nativeCameraModule.requestCamera(request);
    } catch (err) {
      print(`[FrameSnapshotter] Failed to start camera stream (expected in some editor-preview states): ${err}`);
    }
  }

  private onUpdate(): void {
    if (!this.cameraTexture) return;
    this.msSinceLastSample += getDeltaTime() * 1000;
    if (this.msSinceLastSample < this.sampleIntervalMs) return;
    this.msSinceLastSample = 0;

    // IMPORTANT: cameraTexture is a live-updating stream reference — pushing
    // it directly would make every buffered "frame" show whatever is
    // currently on camera by the time the buffer is read back, not a real
    // history. copyFrame() snapshots the current pixels into an independent
    // Texture. TODO(verify): exact method name/signature against the
    // installed CameraTextureProvider — referenced in Lens Studio docs for
    // this exact "freeze the current frame" purpose.
    const snapshot = (this.cameraTexture as any).copyFrame?.() ?? this.cameraTexture;
    this.buffer.push(snapshot);
  }

  /** Oldest-first snapshot of the current buffer contents — call this the moment a sighting needs recording. */
  getRecentFrames(): Texture[] {
    return this.buffer ? this.buffer.all() : [];
  }
}
