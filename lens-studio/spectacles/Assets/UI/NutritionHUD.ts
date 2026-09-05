/**
 * The on-screen result of a confirmed eating event: a compact product card
 * (food + calories) that appears beside the detected food's bounding box,
 * with the fuller macros/glycemic/confidence breakdown revealed only on a
 * pinch gesture — minimal by default, expandable on demand, never a wall of
 * text shown unconditionally.
 *
 * Card placement: tracks the same `PerceptionEvents.onObjectsDetected`
 * signal `DetectionBoxDebugView` draws its box from, and places itself just
 * outside that box (to the right if there's room, otherwise the left) —
 * same approximation caveat as that box (see OnDeviceObjectDetector.ts):
 * not pixel-precise, good enough to read as "next to the food."
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
  private headlineTransform: ScreenTransform;
  private macrosTransform: ScreenTransform | null = null;
  private glycemicTransform: ScreenTransform | null = null;
  private confidenceTransform: ScreenTransform | null = null;

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

    this.headlineTransform = this.headlineText.getSceneObject().getComponent('Component.ScreenTransform');
    this.macrosTransform = this.macrosText?.getSceneObject().getComponent('Component.ScreenTransform') ?? null;
    this.glycemicTransform = this.glycemicText?.getSceneObject().getComponent('Component.ScreenTransform') ?? null;
    this.confidenceTransform = this.confidenceText?.getSceneObject().getComponent('Component.ScreenTransform') ?? null;

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
    this.positionNearBox();
    this.render();
    this.scheduleHide();
  }

  /**
   * Places the card just outside the last known food bounding box — right if
   * there's room, else left — but always fully clamped within a safe margin
   * of the visible frame first, so the card itself is never the thing that
   * decides whether it's fully on-screen; the "beside the box" placement is
   * a preference applied on top of that guarantee, not instead of it.
   */
  private positionNearBox(): void {
    const margin = 0.04; // keep the card off the very edge of the visible frame
    const box = this.latestBox ?? { x: 0.3, y: 0.3, width: 0.4, height: 0.3 };
    const cardWidth = 0.42;
    const rowHeight = 0.065; // smaller now that font sizes shrank
    const gap = 0.03;

    // The macros slot grows by one row per extra food item (each gets its own
    // "food · kcal" line) plus one row for the aggregate protein/carbs/fat —
    // a two-item plate needs more vertical room than a single-food result.
    const itemCount = this.latestResult?.items?.length ?? 0;
    const macrosRows = itemCount > 1 ? itemCount + 1 : 1;
    const totalRows = 1 /* headline */ + macrosRows + 1 /* glycemic */ + 1 /* confidence */;
    const cardHeight = rowHeight * totalRows;

    const minLeft = margin;
    const maxLeft = 1 - margin - cardWidth;

    let cardLeft: number;
    if (box.x + box.width + gap + cardWidth <= 1 - margin) {
      cardLeft = box.x + box.width + gap; // room to the right
    } else if (box.x - gap - cardWidth >= margin) {
      cardLeft = box.x - gap - cardWidth; // room to the left
    } else {
      cardLeft = box.x > 0.5 ? minLeft : maxLeft; // box spans most of the frame — pick whichever side has more room
    }
    cardLeft = Math.max(minLeft, Math.min(maxLeft, cardLeft));
    const cardRight = cardLeft + cardWidth;

    const startTop = Math.max(margin, Math.min(1 - margin - cardHeight, box.y));

    const macrosTop = startTop + rowHeight;
    const macrosBottom = macrosTop + rowHeight * macrosRows;

    this.applyAnchor(this.headlineTransform, cardLeft, cardRight, startTop, macrosTop);
    if (this.macrosTransform) this.applyAnchor(this.macrosTransform, cardLeft, cardRight, macrosTop, macrosBottom);
    if (this.glycemicTransform) this.applyAnchor(this.glycemicTransform, cardLeft, cardRight, macrosBottom, macrosBottom + rowHeight);
    if (this.confidenceTransform) this.applyAnchor(this.confidenceTransform, cardLeft, cardRight, macrosBottom + rowHeight, macrosBottom + rowHeight * 2);
  }

  /** left/right/top/bottom in normalized [0-1], origin top-left -> ScreenTransform anchors [-1,1], origin center, y-up. */
  private applyAnchor(transform: ScreenTransform, leftNorm: number, rightNorm: number, topNorm: number, bottomNorm: number): void {
    const anchors = transform.anchors;
    anchors.left = leftNorm * 2 - 1;
    anchors.right = rightNorm * 2 - 1;
    anchors.top = 1 - topNorm * 2;
    anchors.bottom = 1 - bottomNorm * 2;
    transform.anchors = anchors;
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
