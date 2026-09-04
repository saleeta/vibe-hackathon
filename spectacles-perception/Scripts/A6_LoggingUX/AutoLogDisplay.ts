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
 *   "Apple · ~95 kcal"   (or compactMode: "+95 kcal")
 *
 * shown for `displayDurationMs`, then faded out and hidden automatically.
 */
@component
export class AutoLogDisplay extends BaseScriptComponent {
  @input
  logText: Text;

  @input
  @hint('If true, shows just "+95 kcal" instead of "Apple · ~95 kcal".')
  compactMode: boolean = false;

  @input displayDurationMs: number = 2500;
  @input fadeOutMs: number = 400;

  private hideCallback: DelayedCallbackEvent | null = null;

  onAwake(): void {
    this.logText.getSceneObject().enabled = false;
    PerceptionEvents.onFoodAnalyzed.add((result) => this.show(result));
  }

  private show(result: FoodAnalysisResult): void {
    const kcalRounded = Math.round(result.kcal);
    this.logText.text = this.compactMode ? `+${kcalRounded} kcal` : `${result.name} · ~${kcalRounded} kcal`;

    const sceneObject = this.logText.getSceneObject();
    sceneObject.enabled = true;
    this.setOpacity(1);

    // Cancel any pending hide from a previous log so back-to-back bites
    // each get their own full display window.
    if (this.hideCallback) {
      this.hideCallback.enabled = false;
    }

    this.hideCallback = this.createEvent('DelayedCallbackEvent');
    this.hideCallback.bind(() => this.beginFadeOut());
    this.hideCallback.reset(this.displayDurationMs / 1000);
  }

  private beginFadeOut(): void {
    const startTime = getTime();
    const fadeEvent = this.createEvent('UpdateEvent');
    fadeEvent.bind(() => {
      const t = (getTime() - startTime) / (this.fadeOutMs / 1000);
      if (t >= 1) {
        this.setOpacity(0);
        this.logText.getSceneObject().enabled = false;
        fadeEvent.enabled = false;
        return;
      }
      this.setOpacity(1 - t);
    });
  }

  private setOpacity(opacity: number): void {
    // TODO(verify): Text component's exact opacity property path in
    // Lens Studio 5.15.4 (commonly textFill.color.a via getTextFill()).
    const fill = (this.logText as any).textFill;
    if (fill?.color) {
      const c = fill.color;
      fill.color = new vec4(c.r, c.g, c.b, opacity);
    }
  }
}
