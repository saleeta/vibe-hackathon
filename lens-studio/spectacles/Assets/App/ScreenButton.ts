import { PerceptionEvents } from '../Core/PerceptionEvents';
import { HandsSnapshot, HandState } from '../Core/PerceptionTypes';
import { AppEvents } from './Core/AppEvents';

/**
 * A screen-space button that works without SpectaclesInteractionKit's
 * Interactable + PhysicsCollider setup — deliberately avoided here since
 * this project has no tested path to wire that up blind, and its
 * world-space content isn't composited to the Spectacles display (only the
 * Orthographic/Canvas layer is). Instead: a hand "hovers" this button when
 * its index fingertip's camera-projected screen position falls inside the
 * button Text's own ScreenTransform rect (`Camera.worldSpaceToScreenSpace`,
 * [0,1] top-left-origin), and a pinch fires
 * `AppEvents.onButtonPressed(buttonId)` if the hand was hovering within the
 * last `hoverGraceMs` — not just at the instant the pinch lands, since a
 * real pinch pulls the fingertip slightly and can flicker hover false right
 * as the gesture completes.
 *
 * The visible panel is the button Text's Background fill (set at edit time,
 * never touched at runtime). Runtime feedback is on `Text.textFill.color`
 * (the property `UI/NutritionHUD.ts`'s fade already proves safe to
 * read/write), plus an optional click `AudioComponent`.
 */
@component
export class ScreenButton extends BaseScriptComponent {
  @input
  @hint('Identifies this button to whatever listens on AppEvents.onButtonPressed, e.g. "mode:food".')
  buttonId: string;

  @input
  buttonText: Text;

  @input
  worldCamera: Camera;

  @input
  @hint('A pinch still counts if the hand was hovering this button within the last N ms — covers the pinch motion itself nudging the fingertip out of the rect.')
  hoverGraceMs: number = 350;

  @input
  @hint('How long (ms) the bright "pressed" flash lasts before reverting to the normal/hover text color.')
  pressFlashMs: number = 200;

  @input
  @allowUndefined
  @hint('Optional click sound played once per press.')
  clickSound: AudioTrackAsset;

  @input
  @hint('Print a per-second [FitLens:Button] line with the fingertip screen pos vs this button\'s rect. Off by default — six buttons at 1 Hz floods the log.')
  showDiagnostics: boolean = false;

  private screenTransform: ScreenTransform;
  private gestureModule: GestureModule = require('LensStudio:GestureModule');
  private isHovering = false;
  private lastHoverTrueMillis = 0;
  private lastDiagnosticMillis = 0;

  private baseColor: vec4 | null = null;
  private flashUntilMillis = 0;
  private audio: AudioComponent | null = null;

  onAwake(): void {
    this.screenTransform = this.buttonText.getSceneObject().getComponent('Component.ScreenTransform');

    PerceptionEvents.onHandsUpdated.add((snapshot) => this.onHands(snapshot));
    this.gestureModule.getFilteredPinchDownEvent(GestureModule.HandType.Left).add(() => this.onPinch());
    this.gestureModule.getFilteredPinchDownEvent(GestureModule.HandType.Right).add(() => this.onPinch());
    this.createEvent('UpdateEvent').bind(() => this.onUpdateFlash());
    print(`[FitLens:Button] "${this.buttonId}" initialized. worldCamera=${!!this.worldCamera} screenTransform=${!!this.screenTransform}`);

    try {
      const fill = (this.buttonText as any).textFill;
      if (fill?.color) {
        const c = fill.color;
        this.baseColor = new vec4(c.r, c.g, c.b, c.a);
      }
    } catch (err) {
      print(`[FitLens:Button] "${this.buttonId}" — textFill unreadable, no color feedback: ${err}`);
    }

    if (this.clickSound) {
      this.audio = this.sceneObject.createComponent('Component.AudioComponent') as AudioComponent;
      this.audio.audioTrack = this.clickSound;
    }
  }

  /**
   * True only if this button AND every ancestor is enabled. `SceneObject.enabled`
   * is the object's OWN flag — a button under a disabled `GymMenuRoot` still
   * reports `enabled: true` itself, so without walking up it would keep eating
   * pinches (and firing navigation) while invisible on another mode's screen.
   * The hand/pinch callbacks come off global event buses, not the UpdateEvent,
   * so LS's own "disabled objects don't tick" rule doesn't cover them.
   */
  private isPageActive(): boolean {
    let o: SceneObject | null = this.getSceneObject();
    for (let depth = 0; o && depth < 32; depth++) {
      if (!o.enabled) return false;
      o = o.getParent();
    }
    return true;
  }

  private onHands(snapshot: HandsSnapshot): void {
    if (!this.worldCamera || !this.isPageActive()) {
      if (this.isHovering) {
        this.isHovering = false;
        this.applyColor();
      }
      return;
    }
    const hands: HandState[] = [snapshot.left, snapshot.right];
    let hovering = false;
    let closestScreenPoint: vec2 | null = null;
    for (const hand of hands) {
      if (!hand.isTracked) continue;
      const screenPoint = this.worldCamera.worldSpaceToScreenSpace(hand.indexTipPosition);
      closestScreenPoint = screenPoint;
      if (this.isInsideButton(screenPoint)) {
        hovering = true;
        break;
      }
    }

    const nowMillis = getTime() * 1000;
    if (hovering) this.lastHoverTrueMillis = nowMillis;

    if (this.showDiagnostics && closestScreenPoint && nowMillis - this.lastDiagnosticMillis > 1000) {
      this.lastDiagnosticMillis = nowMillis;
      const a = this.screenTransform.anchors;
      print(
        `[FitLens:Button] "${this.buttonId}" hand screen=(${closestScreenPoint.x.toFixed(2)},${closestScreenPoint.y.toFixed(2)}) ` +
          `rect anchors L${a.left.toFixed(2)} R${a.right.toFixed(2)} T${a.top.toFixed(2)} B${a.bottom.toFixed(2)} hovering=${hovering}`
      );
    }

    if (hovering !== this.isHovering) {
      this.isHovering = hovering;
      print(`[FitLens:Button] "${this.buttonId}" hover -> ${hovering}.`);
      this.applyColor();
    }
  }

  private isInsideButton(screenPoint: vec2): boolean {
    const anchors = this.screenTransform.anchors;
    const left = (anchors.left + 1) / 2;
    const right = (anchors.right + 1) / 2;
    const top = 1 - (anchors.top + 1) / 2;
    const bottom = 1 - (anchors.bottom + 1) / 2;
    return screenPoint.x >= left && screenPoint.x <= right && screenPoint.y >= top && screenPoint.y <= bottom;
  }

  private onPinch(): void {
    if (!this.isPageActive()) return;
    const nowMillis = getTime() * 1000;
    const recentlyHovering = this.isHovering || nowMillis - this.lastHoverTrueMillis < this.hoverGraceMs;
    if (!recentlyHovering) return;

    print(`[FitLens:Button] "${this.buttonId}" pressed.`);
    if (this.audio) this.audio.play(1);
    this.flashUntilMillis = nowMillis + this.pressFlashMs;
    this.applyColor();
    AppEvents.onButtonPressed.invoke(this.buttonId);
  }

  /** Reverts the press flash back to the normal/hover color once pressFlashMs elapses — checked every frame since there's no event for "a timeout with no work to do until it fires". */
  private onUpdateFlash(): void {
    if (this.flashUntilMillis === 0) return;
    if (getTime() * 1000 >= this.flashUntilMillis) {
      this.flashUntilMillis = 0;
      this.applyColor();
    }
  }

  private applyColor(): void {
    if (this.baseColor === null) return;
    try {
      const fill = (this.buttonText as any).textFill;
      if (!fill) return;
      const c = this.baseColor;
      const nowMillis = getTime() * 1000;
      if (nowMillis < this.flashUntilMillis) {
        fill.color = new vec4(1, 1, 0.3, c.a); // bright yellow flash — unmistakably "you pressed this"
      } else if (this.isHovering) {
        fill.color = new vec4(Math.min(c.r + 0.3, 1), Math.min(c.g + 0.3, 1), Math.min(c.b + 0.3, 1), c.a);
      } else {
        fill.color = c;
      }
    } catch (err) {
      print(`[FitLens:Button] "${this.buttonId}" — failed to set text color feedback: ${err}`);
    }
  }
}
