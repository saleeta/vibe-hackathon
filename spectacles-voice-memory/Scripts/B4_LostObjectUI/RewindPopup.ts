import { VoiceMemoryEvents } from '../Core/VoiceMemoryEvents';
import { LocateObjectResult } from '../Core/VoiceMemoryTypes';

/**
 * B4 — the visual half of "where are my keys": a brief rewind through the
 * frames leading up to the object's last-seen moment, playing backwards
 * (fastest-first, like scrubbing a tape) alongside the spoken response.
 *
 * Same clean glass-tile aesthetic as spectacles-perception's
 * AutoLogDisplay (cool, translucent, no emoji, no icons) — the styling
 * code is duplicated rather than shared, consistent with this module
 * being standalone.
 *
 * `rewindSound` is deliberately left unwired by default: nothing in
 * Lens Studio's searchable asset/music libraries turned up a short
 * "tape rewind" SFX (only full-length licensed music tracks with
 * "rewind" in the title) — wire in a real short SFX asset here rather
 * than leaving a wrong one attached.
 */
@component
export class RewindPopup extends BaseScriptComponent {
  @input
  previewImage: Image;

  @input
  captionText: Text;

  @input
  @allowUndefined
  @hint('Short "tape rewind" SFX. Left unassigned by default — see class doc.')
  rewindSound: AudioComponent;

  @input
  @hint('Playback speed through the snippet frames, backwards.')
  frameIntervalMs: number = 90;

  @input
  holdMs: number = 1800;

  private activeSequenceToken = 0;

  onAwake(): void {
    this.applyGlassStyle();
    this.setVisible(false);
    VoiceMemoryEvents.onLocateObjectResult.add((result) => {
      if (result.sighting) this.show(result);
    });
  }

  private applyGlassStyle(): void {
    const text = this.captionText;
    text.size = 36;
    text.horizontalOverflow = HorizontalOverflow.Overflow;
    text.verticalOverflow = VerticalOverflow.Overflow;
    text.textFill.color = new vec4(0.93, 0.96, 1.0, 1);

    const bg = text.backgroundSettings;
    bg.enabled = true;
    bg.cornerRadius = 22;
    bg.fill.color = new vec4(0.62, 0.72, 0.85, 0.22);
    bg.margins = Rect.create(36, 36, 18, 18);

    const shadow = text.dropshadowSettings;
    shadow.enabled = true;
    shadow.fill.color = new vec4(0, 0, 0, 0.45);
    shadow.offset = new vec2(0, -2);
  }

  private show(result: LocateObjectResult): void {
    const sighting = result.sighting!;
    const token = ++this.activeSequenceToken;

    this.setVisible(true);
    this.captionText.text = `${result.objectClass} · last seen`;
    this.rewindSound?.play(1);

    const framesOldestFirst = sighting.snippetFrames;
    const framesForRewind = framesOldestFirst.slice().reverse(); // play backwards, most-recent first

    if (framesForRewind.length === 0) {
      this.previewImage.getSceneObject().enabled = false;
    } else {
      this.previewImage.getSceneObject().enabled = true;
      this.playFrameSequence(framesForRewind, 0, token);
    }

    const totalMs = framesForRewind.length * this.frameIntervalMs + this.holdMs;
    const hide = this.createEvent('DelayedCallbackEvent');
    hide.bind(() => {
      if (token === this.activeSequenceToken) this.setVisible(false);
    });
    hide.reset(totalMs / 1000);
  }

  private playFrameSequence(frames: Texture[], index: number, token: number): void {
    if (token !== this.activeSequenceToken || index >= frames.length) return;
    this.previewImage.mainPass.baseTex = frames[index];
    const step = this.createEvent('DelayedCallbackEvent');
    step.bind(() => this.playFrameSequence(frames, index + 1, token));
    step.reset(this.frameIntervalMs / 1000);
  }

  private setVisible(visible: boolean): void {
    this.captionText.getSceneObject().enabled = visible;
    if (!visible) this.previewImage.getSceneObject().enabled = false;
  }
}
