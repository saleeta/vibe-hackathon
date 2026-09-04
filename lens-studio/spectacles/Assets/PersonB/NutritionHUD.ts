/**
 * Person B's visual for "food detected in hand -> calories and nutrition on
 * screen." Subscribes to the same event Person A's AutoLogDisplay (A6)
 * does — `PerceptionEvents.onFoodAnalyzed` — but shows the fuller nutrition
 * breakdown that endpoint now carries (protein/carbs/fat, estimated
 * glycemic load, confidence) instead of just "Apple · ~95 kcal".
 *
 * Per PersonA/README.md's own documented pattern ("Main-app-owns-the-UI:
 * disable AutoLogDisplay, subscribe to onFoodAnalyzed from the main app's
 * own script instead") — disable AutoLogDisplay's SceneObject and use this
 * instead, or run both side by side if a compact confirmation AND a fuller
 * card both have a place in the scene.
 *
 * Same no-button, self-dismissing UX as AutoLogDisplay: nothing to tap,
 * shows on every onFoodAnalyzed, fades out automatically.
 */

import { PerceptionEvents } from '../PersonA/Core/PerceptionEvents';
import { FoodAnalysisResult } from '../PersonA/Core/PerceptionTypes';

@component
export class NutritionHUD extends BaseScriptComponent {
  @input
  headlineText: Text; // e.g. "Chicken · 297 kcal"

  @input
  @hint('Optional — protein/carbs/fat line. Leave unset to fold everything into headlineText instead.')
  macrosText: Text | null = null;

  @input
  @hint('Optional — estimated glycemic load + category. Always labeled as an estimate, never "blood sugar".')
  glycemicText: Text | null = null;

  @input
  @hint('Optional — confidence breakdown, small/muted text.')
  confidenceText: Text | null = null;

  @input displayDurationMs: number = 4000;
  @input fadeOutMs: number = 500;

  private hideCallback: DelayedCallbackEvent | null = null;
  private allTexts: Text[] = [];

  onAwake(): void {
    this.allTexts = [this.headlineText, this.macrosText, this.glycemicText, this.confidenceText].filter(
      (t): t is Text => !!t
    );
    for (const t of this.allTexts) {
      t.getSceneObject().enabled = false;
    }
    PerceptionEvents.onFoodAnalyzed.add((result) => this.show(result));
  }

  private show(result: FoodAnalysisResult): void {
    const kcalRounded = Math.round(result.kcal);
    const foodLabel =
      result.items && result.items.length > 1
        ? `${result.items.length} foods (incl. ${result.name})`
        : result.name;

    this.headlineText.text = `${foodLabel} · ${kcalRounded} kcal`;
    this.headlineText.getSceneObject().enabled = true;

    if (this.macrosText) {
      const parts: string[] = [];
      if (typeof result.proteinG === 'number') parts.push(`${round1(result.proteinG)}g protein`);
      if (typeof result.carbsG === 'number') parts.push(`${round1(result.carbsG)}g carbs`);
      if (typeof result.fatG === 'number') parts.push(`${round1(result.fatG)}g fat`);
      this.macrosText.text = parts.join('  ·  ');
      this.macrosText.getSceneObject().enabled = parts.length > 0;
    }

    if (this.glycemicText) {
      if (typeof result.glycemicLoad === 'number' && result.glycemicCategory) {
        // "Estimated" is load-bearing here — this is derived from food composition only,
        // never a measured blood glucose reading. See docs/COMPLIANCE.md.
        this.glycemicText.text = `Est. glycemic load: ${round1(result.glycemicLoad)} (${result.glycemicCategory})`;
        this.glycemicText.getSceneObject().enabled = true;
      } else {
        this.glycemicText.getSceneObject().enabled = false;
      }
    }

    if (this.confidenceText) {
      if (typeof result.confidence === 'number') {
        this.confidenceText.text = `Confidence: ${Math.round(result.confidence * 100)}%`;
        this.confidenceText.getSceneObject().enabled = true;
      } else {
        this.confidenceText.getSceneObject().enabled = false;
      }
    }

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
        for (const text of this.allTexts) {
          text.getSceneObject().enabled = false;
        }
        fadeEvent.enabled = false;
        return;
      }
      this.setOpacity(1 - t);
    });
  }

  private setOpacity(opacity: number): void {
    // TODO(verify): Text component's exact opacity property path in the
    // installed Lens Studio version — mirrors AutoLogDisplay's same TODO
    // (commonly textFill.color.a via getTextFill()).
    for (const text of this.allTexts) {
      const fill = (text as any).textFill;
      if (fill?.color) {
        const c = fill.color;
        fill.color = new vec4(c.r, c.g, c.b, opacity);
      }
    }
  }
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
