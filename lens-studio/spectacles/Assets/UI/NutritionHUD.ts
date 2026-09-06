/**
 * The result of a confirmed (food-in-hand) eating event: a nutrition card
 * shown as a fixed screen-space panel — this project's Spectacles setup only
 * composites the Orthographic/Canvas layer to the display, so the card can't
 * be a world-anchored billboard.
 *
 * Compact by default: food name + kcal + Nutri-Score grade, with the card
 * background tinted green (A) → red (E). A pinch (`GestureModule`) expands it
 * to the full breakdown — macros, vision-estimated micros, estimated glycemic
 * load, confidence — and pinch again collapses it. Shows on every
 * `PerceptionEvents.onFoodAnalyzed`, then auto-fades after `displayDurationMs`.
 *
 * `cardRoot` is just a container that gets enabled/disabled; the text slots
 * and the background are ordinary screen-space Text objects positioned in the
 * scene.
 */

import { PerceptionEvents } from '../Core/PerceptionEvents';
import { FoodAnalysisResult } from '../Core/PerceptionTypes';

@component
export class NutritionHUD extends BaseScriptComponent {
  @input
  @hint('Container SceneObject for all the card text + background. Just toggled on/off — no positioning done here.')
  cardRoot: SceneObject;

  @input
  headlineText: Text; // e.g. "Chicken · 297 kcal" — always shown

  @input
  @hint('Optional — protein/carbs/fat + micros lines. Only shown after a pinch expands the card.')
  macrosText: Text | null = null;

  @input
  @hint('Optional — estimated glycemic load + category. Always labeled as an estimate, never "blood sugar". Only shown expanded.')
  glycemicText: Text | null = null;

  @input
  @hint('Optional — confidence breakdown, small/muted text. Only shown expanded.')
  confidenceText: Text | null = null;

  @input
  @hint('Optional — one-line Nutri-Score grade ("Nutri-Score: C"). Shown whenever a grade is available, compact or expanded.')
  nutriScoreText: Text | null = null;

  @input
  @hint('Optional — a Text with Background enabled sitting behind the card. Its background fill is tinted to the food\'s Nutri-Score colour (green A → red E).')
  cardBackground: Text | null = null;

  @input displayDurationMs: number = 6000;
  @input fadeOutMs: number = 500;

  private gestureModule: GestureModule = require('LensStudio:GestureModule');

  private hideCallback: DelayedCallbackEvent | null = null;
  private allTexts: Text[] = [];

  private latestResult: FoodAnalysisResult | null = null;
  private expanded = false;
  private visible = false;
  /** Base RGB (0–1) of the current Nutri-Score grade colour; only alpha is animated during the fade. */
  private latestGradeColor: { r: number; g: number; b: number } | null = null;

  onAwake(): void {
    this.allTexts = [
      this.headlineText,
      this.macrosText,
      this.glycemicText,
      this.confidenceText,
      this.nutriScoreText,
    ].filter((t): t is Text => !!t);
    for (const t of this.allTexts) {
      t.getSceneObject().enabled = false;
    }
    if (this.cardRoot) this.cardRoot.enabled = false;
    if (this.cardBackground) this.cardBackground.getSceneObject().enabled = false;

    PerceptionEvents.onFoodAnalyzed.add((result) => this.show(result));

    this.gestureModule.getFilteredPinchDownEvent(GestureModule.HandType.Left).add(() => this.onPinch());
    this.gestureModule.getFilteredPinchDownEvent(GestureModule.HandType.Right).add(() => this.onPinch());
  }

  private onPinch(): void {
    if (!this.visible || !this.latestResult) return; // nothing showing — not a HUD interaction
    this.expanded = !this.expanded;
    print(`[FoodLens:HUD] Pinch — card ${this.expanded ? 'expanded' : 'collapsed'}.`);
    this.render();
    this.scheduleHide(); // interacting with it counts as still wanting to see it
  }

  private show(result: FoodAnalysisResult): void {
    print(`[FoodLens:HUD] Displaying "${result.name}" · ${Math.round(result.kcal)} kcal.`);
    this.latestResult = result;
    this.expanded = false; // always start minimal on a new result
    this.visible = true;
    if (this.cardRoot) this.cardRoot.enabled = true;
    if (this.cardBackground) this.cardBackground.getSceneObject().enabled = true;
    this.render();
    this.scheduleHide();
  }

  private render(): void {
    if (!this.latestResult) return;
    const result = this.latestResult;
    const kcalRounded = Math.round(result.kcal);
    const items = result.items ?? [];

    const foodLabel = items.length > 1 ? items.map((i) => i.food).join(', ') : result.name;
    this.headlineText.text = `${foodLabel} · ${kcalRounded} kcal`;
    this.headlineText.getSceneObject().enabled = true;

    if (this.macrosText) {
      const lines: string[] = [];
      if (items.length > 1) {
        for (const item of items) {
          lines.push(`${item.food} · ${Math.round(item.kcal)} kcal`);
        }
      }
      const macroParts: string[] = [];
      if (typeof result.proteinG === 'number') macroParts.push(`${round1(result.proteinG)}g protein`);
      if (typeof result.carbsG === 'number') macroParts.push(`${round1(result.carbsG)}g carbs`);
      if (typeof result.fatG === 'number') macroParts.push(`${round1(result.fatG)}g fat`);
      if (macroParts.length > 0) lines.push(macroParts.join('  ·  '));

      const microParts: string[] = [];
      if (typeof result.sugarsG === 'number') microParts.push(`${round1(result.sugarsG)}g sugars`);
      if (typeof result.satFatG === 'number') microParts.push(`${round1(result.satFatG)}g sat fat`);
      if (typeof result.sodiumMg === 'number') microParts.push(`${Math.round(result.sodiumMg)}mg sodium`);
      if (typeof result.fiberG === 'number') microParts.push(`${round1(result.fiberG)}g fibre`);
      if (microParts.length > 0) lines.push(microParts.join('  ·  '));

      this.macrosText.text = lines.join('\n');
      this.macrosText.getSceneObject().enabled = this.expanded && lines.length > 0;
    }

    // Nutri-Score: grade letter (compact or expanded) + card background tinted green (A) → red (E).
    if (result.nutriScore) {
      this.latestGradeColor = result.nutriScore.color;
      if (this.nutriScoreText) {
        this.nutriScoreText.text = `Nutri-Score: ${result.nutriScore.grade}`;
        this.nutriScoreText.getSceneObject().enabled = true;
      }
    } else {
      this.latestGradeColor = null;
      if (this.nutriScoreText) this.nutriScoreText.getSceneObject().enabled = false;
    }

    if (this.glycemicText) {
      if (typeof result.glycemicLoad === 'number' && result.glycemicCategory) {
        // "Estimated" is load-bearing — food composition only, never a measured glucose reading. See docs/COMPLIANCE.md.
        this.glycemicText.text = `Est. glycemic load: ${round1(result.glycemicLoad)} (${result.glycemicCategory})`;
        this.glycemicText.getSceneObject().enabled = this.expanded;
      } else {
        this.glycemicText.getSceneObject().enabled = false;
      }
    }

    if (this.confidenceText) {
      if (typeof result.confidence === 'number') {
        this.confidenceText.text = `Confidence: ${Math.round(result.confidence * 100)}%`;
        this.confidenceText.getSceneObject().enabled = this.expanded;
      } else {
        this.confidenceText.getSceneObject().enabled = false;
      }
    }

    this.setOpacity(1);
  }

  private scheduleHide(): void {
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
        if (this.cardRoot) this.cardRoot.enabled = false;
        if (this.cardBackground) this.cardBackground.getSceneObject().enabled = false;
        this.visible = false;
        this.latestResult = null;
        fadeEvent.enabled = false;
        return;
      }
      this.setOpacity(1 - t);
    });
  }

  private setOpacity(opacity: number): void {
    for (const text of this.allTexts) {
      const fill = (text as any).textFill;
      if (fill?.color) {
        const c = fill.color;
        fill.color = new vec4(c.r, c.g, c.b, opacity);
      }
    }

    if (this.cardBackground) {
      const g = this.latestGradeColor ?? { r: 0.1, g: 0.12, b: 0.16 };
      const bg = (this.cardBackground as any).backgroundSettings;
      if (bg?.fill?.color) {
        bg.fill.color = new vec4(g.r, g.g, g.b, opacity * 0.82);
      }
    }
  }
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
