/**
 * The result of a confirmed eating event: a compact product card (food +
 * calories) pinned in 3D world space near the detected food, with the
 * fuller macros/glycemic/confidence breakdown revealed only on a pinch
 * gesture — minimal by default, expandable on demand.
 *
 * World-anchored, not screen-locked: `cardRoot` carries a Billboard
 * component (SIK) so the card always faces the wearer, but its *position*
 * is a real point in world space — pinned once per result via
 * `worldCamera.screenSpaceToWorldSpace()` at `cardDepthM` in front of the
 * camera, through the last known detection box's center. Because it's a
 * fixed world point rather than a screen overlay, turning away from the
 * food naturally takes the card out of view, the same way any other AR
 * object would — no extra visibility logic needed for that.
 *
 * Card placement source: the same `PerceptionEvents.onObjectsDetected`
 * signal `DetectionBoxDebugView` draws its 2D box from — same approximation
 * caveat as that box (see OnDeviceObjectDetector.ts): not pixel-precise,
 * good enough to land the card "near the food."
 *
 * Expand/collapse: `GestureModule.getFilteredPinchDownEvent` (same API
 * Snap's own RemoteServiceGateway example scripts use for tap-equivalent
 * input) toggles between compact and full card for whatever result is
 * currently showing, from either hand.
 */

import { PerceptionEvents } from '../Core/PerceptionEvents';
import { DetectedObject, FoodAnalysisResult } from '../Core/PerceptionTypes';

interface NormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

@component
export class NutritionHUD extends BaseScriptComponent {
  @input
  @hint('The Billboard-rotated parent of all the card text — this is what gets pinned in world space. Add a Billboard component (SIK) to it separately.')
  cardRoot: SceneObject;

  @input
  worldCamera: Camera;

  @input
  @hint('Distance in front of the camera (meters) to pin the card, projected through the detected food\'s screen position.')
  cardDepthM: number = 0.5;

  @input
  headlineText: Text; // e.g. "Chicken · 297 kcal" — always shown

  @input
  @hint('Optional — protein/carbs/fat line. Only shown after a pinch expands the card.')
  macrosText: Text | null = null;

  @input
  @hint('Optional — estimated glycemic load + category. Always labeled as an estimate, never "blood sugar". Only shown expanded.')
  glycemicText: Text | null = null;

  @input
  @hint('Optional — confidence breakdown, small/muted text. Only shown expanded.')
  confidenceText: Text | null = null;

  @input displayDurationMs: number = 4000;
  @input fadeOutMs: number = 500;

  private gestureModule: GestureModule = require('LensStudio:GestureModule');

  private hideCallback: DelayedCallbackEvent | null = null;
  private allTexts: Text[] = [];

  private latestResult: FoodAnalysisResult | null = null;
  private latestBox: NormalizedBox | null = null;
  private expanded = false;
  private visible = false;

  onAwake(): void {
    this.allTexts = [this.headlineText, this.macrosText, this.glycemicText, this.confidenceText].filter(
      (t): t is Text => !!t
    );
    for (const t of this.allTexts) {
      t.getSceneObject().enabled = false;
    }
    this.cardRoot.enabled = false;

    PerceptionEvents.onObjectsDetected.add((objects) => this.trackLatestBox(objects));
    PerceptionEvents.onFoodAnalyzed.add((result) => this.show(result));

    this.gestureModule.getFilteredPinchDownEvent(GestureModule.HandType.Left).add(() => this.onPinch());
    this.gestureModule.getFilteredPinchDownEvent(GestureModule.HandType.Right).add(() => this.onPinch());
  }

  private trackLatestBox(objects: DetectedObject[]): void {
    if (objects.length === 0) return;
    const best = objects.reduce((a, b) => (a.confidence >= b.confidence ? a : b));
    this.latestBox = best.boundingBox;
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
    this.cardRoot.enabled = true;
    this.pinCardInWorld();
    this.render();
    this.scheduleHide();
  }

  /**
   * Projects the last known detection box's center through the camera into
   * world space at `cardDepthM`, and pins `cardRoot` there once. Not
   * re-projected every frame — this is a "the food was here" marker for
   * the duration of the display, not a live tracker following hand sway.
   */
  private pinCardInWorld(): void {
    if (!this.worldCamera) {
      print('[FoodLens:HUD] ERROR — worldCamera is not set, cannot place the card in world space.');
      return;
    }
    const margin = 0.06; // keep the projection point off the extreme edge of the view
    const box = this.latestBox ?? { x: 0.3, y: 0.3, width: 0.4, height: 0.3 };
    const centerX = Math.max(margin, Math.min(1 - margin, box.x + box.width / 2));
    const centerY = Math.max(margin, Math.min(1 - margin, box.y + box.height / 2));

    const worldPos = this.worldCamera.screenSpaceToWorldSpace(new vec2(centerX, centerY), this.cardDepthM);
    this.cardRoot.getTransform().setWorldPosition(worldPos);
  }

  private render(): void {
    if (!this.latestResult) return;
    const result = this.latestResult;
    const kcalRounded = Math.round(result.kcal);
    const items = result.items ?? [];

    // Multiple foods: list each by name in the headline instead of collapsing
    // to "N foods (incl. X)" — the per-item nutrition breakdown lives in the
    // expanded macros line below.
    const foodLabel = items.length > 1 ? items.map((i) => i.food).join(', ') : result.name;
    this.headlineText.text = `${foodLabel} · ${kcalRounded} kcal`;
    this.headlineText.getSceneObject().enabled = true;

    if (this.macrosText) {
      const lines: string[] = [];
      if (items.length > 1) {
        // One line per food with its own kcal, so a plate reads as
        // "chicken · 220 kcal" / "rice · 200 kcal", not just a combined total.
        for (const item of items) {
          lines.push(`${item.food} · ${Math.round(item.kcal)} kcal`);
        }
      }
      const macroParts: string[] = [];
      if (typeof result.proteinG === 'number') macroParts.push(`${round1(result.proteinG)}g protein`);
      if (typeof result.carbsG === 'number') macroParts.push(`${round1(result.carbsG)}g carbs`);
      if (typeof result.fatG === 'number') macroParts.push(`${round1(result.fatG)}g fat`);
      if (macroParts.length > 0) lines.push(macroParts.join('  ·  '));

      this.macrosText.text = lines.join('\n');
      this.macrosText.getSceneObject().enabled = this.expanded && lines.length > 0;
    }

    if (this.glycemicText) {
      if (typeof result.glycemicLoad === 'number' && result.glycemicCategory) {
        // "Estimated" is load-bearing here — this is derived from food composition only,
        // never a measured blood glucose reading. See docs/COMPLIANCE.md.
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
        this.cardRoot.enabled = false;
        this.visible = false;
        this.latestResult = null;
        fadeEvent.enabled = false;
        return;
      }
      this.setOpacity(1 - t);
    });
  }

  private setOpacity(opacity: number): void {
    // TODO(verify): Text component's exact opacity property path in the
    // installed Lens Studio version (commonly textFill.color.a via getTextFill()).
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
