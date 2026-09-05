import { PerceptionEvents } from '../Core/PerceptionEvents';
import { FoodAnalysisResult } from '../Core/PerceptionTypes';

/**
 * A6 — Automatic logging UX.
 *
 * No "Log it?" prompt, no button, no interaction of any kind. The result
 * from Person B's backend is treated as already logged the moment it
 * arrives; this component's only job is a brief, self-dismissing glanceable
 * confirmation.
 *
 *   Apple · ~95 kcal    (or compactMode: +95 kcal)
 *
 * Styled entirely in code as a clean glass tile — cool, translucent,
 * desaturated — matching standard AR-HUD conventions (HoloLens/Vision-Pro
 * style frosted panels) rather than a solid opaque card. Soft-white text,
 * a subtle drop shadow for legibility over a live camera feed. Dropping
 * this into the main app needs zero manual Inspector styling — just wire
 * `logText` to a bare Text component. Deliberately plain: no icons, no
 * emoji, no color accents beyond one neutral cool-glass palette.
 *
 * Note: Text.backgroundSettings has no stroke/border property, so the
 * "glass edge" highlight real glassmorphism uses isn't available here —
 * compensated with a lighter, cooler, more translucent fill instead.
 */
@component
export class AutoLogDisplay extends BaseScriptComponent {
  @input
  logText: Text;

  @input
  @hint('If true, shows just "+95 kcal" instead of "Apple · ~95 kcal".')
  compactMode: boolean = false;

  @input displayDurationMs: number = 2500;
  @input fadeMs: number = 220;

  @input
  @widget(new SliderWidget(24, 72, 1))
  fontSize: number = 42;

  @input
  @allowUndefined
  @hint('Short confirmation chime played the moment something is auto-logged. Optional.')
  logChimeAudio: AudioComponent;

  private hideCallback: DelayedCallbackEvent | null = null;
  private activeAnim: UpdateEvent | null = null;

  onAwake(): void {
    this.applyCardStyle();
    this.logText.getSceneObject().enabled = false;
    PerceptionEvents.onFoodAnalyzed.add((result) => this.show(result));
  }

  /** One-time visual setup — dark glass card, soft-white text, subtle shadow. No manual styling needed in the Inspector. */
  private applyCardStyle(): void {
    const text = this.logText;
    text.size = this.fontSize;
    text.horizontalOverflow = HorizontalOverflow.Overflow;
    text.verticalOverflow = VerticalOverflow.Overflow;

    // Cool, slightly blue-tinted off-white — reads as "glass", not paper.
    text.textFill.color = new vec4(0.93, 0.96, 1.0, 1);

    const bg = text.backgroundSettings;
    bg.enabled = true;
    bg.cornerRadius = 22; // soft rounded tile, not a sharp card
    bg.fill.color = new vec4(0.62, 0.72, 0.85, 0.22); // cool, light, translucent — frosted glass, not solid
    // TODO(verify): Rect.create's argument order (assumed left, right, bottom, top).
    bg.margins = Rect.create(40, 40, 20, 20);

    // Slightly stronger shadow than a solid card would need — the frosted
    // fill alone is too translucent to separate the text from a busy
    // real-world background without it.
    const shadow = text.dropshadowSettings;
    shadow.enabled = true;
    shadow.fill.color = new vec4(0, 0, 0, 0.45);
    shadow.offset = new vec2(0, -2);
  }

  private show(result: FoodAnalysisResult): void {
    const kcalRounded = Math.round(result.kcal);
    this.logText.text = this.compactMode ? `+${kcalRounded} kcal` : `${result.name} · ~${kcalRounded} kcal`;

    const sceneObject = this.logText.getSceneObject();
    sceneObject.enabled = true;
    this.animateOpacity(0, 1, this.fadeMs);
    this.playChime();

    // Cancel any pending hide from a previous log so back-to-back bites
    // each get their own full display window.
    if (this.hideCallback) this.hideCallback.enabled = false;
    this.hideCallback = this.createEvent('DelayedCallbackEvent');
    this.hideCallback.bind(() => this.animateOpacity(1, 0, this.fadeMs, () => (sceneObject.enabled = false)));
    this.hideCallback.reset(this.displayDurationMs / 1000);
  }

  /** Smooth ease-out opacity tween — used for both the entrance and exit, so neither is an abrupt pop. */
  private animateOpacity(from: number, to: number, durationMs: number, onDone?: () => void): void {
    if (this.activeAnim) this.activeAnim.enabled = false;
    const startTime = getTime();
    const durationSec = Math.max(durationMs, 1) / 1000;
    const anim = this.createEvent('UpdateEvent');
    this.activeAnim = anim;
    anim.bind(() => {
      const t = Math.min(1, (getTime() - startTime) / durationSec);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      this.setOpacity(from + (to - from) * eased);
      if (t >= 1) {
        anim.enabled = false;
        onDone?.();
      }
    });
  }

  /**
   * A missing/unassigned audioTrack on `logChimeAudio` throws
   * `InternalError: [AudioComponent] Audio player is not enabled` from
   * `.play()` — confirmed live on real hardware, and uncaught it takes
   * down the entire running Lens (not just this component). A decorative
   * chime failing to play must never be allowed to do that.
   */
  private playChime(): void {
    if (!this.logChimeAudio) return;
    try {
      this.logChimeAudio.play(1);
    } catch (err) {
      print(`[AutoLogDisplay] Chime failed to play (is logChimeAudio.audioTrack assigned in the Inspector?): ${err}`);
    }
  }

  // Base alphas from applyCardStyle() — fade multiplies toward these, not toward fully opaque.
  private static readonly BG_BASE_ALPHA = 0.22;
  private static readonly SHADOW_BASE_ALPHA = 0.45;

  private setOpacity(opacity: number): void {
    const text = this.logText;
    const c = text.textFill.color;
    text.textFill.color = new vec4(c.r, c.g, c.b, opacity);
    const bgColor = text.backgroundSettings.fill.color;
    text.backgroundSettings.fill.color = new vec4(bgColor.r, bgColor.g, bgColor.b, opacity * AutoLogDisplay.BG_BASE_ALPHA);
    const shadowColor = text.dropshadowSettings.fill.color;
    text.dropshadowSettings.fill.color = new vec4(shadowColor.r, shadowColor.g, shadowColor.b, opacity * AutoLogDisplay.SHADOW_BASE_ALPHA);
  }
}
