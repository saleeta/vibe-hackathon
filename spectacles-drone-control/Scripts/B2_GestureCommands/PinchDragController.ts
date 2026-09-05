import { SIK } from 'SpectaclesInteractionKit.lspkg/SIK';
import { DroneEvents } from '../Core/DroneEvents';
import { HandSide } from '../Core/DroneTypes';
import { clampGoVector } from '../B1_SpatialDestination/TelloGoVector';

/**
 * B2 — "pinch and drag" left/right/up/down: pinch to grab control, then
 * move your hand and the drone follows, one step at a time. Different
 * interaction model from DirectionalHandController's hold-a-pose-relative-
 * to-head scheme (see that file) — this one is the simpler "grab and drag"
 * demo requested. Both exist side by side; enable only one at a time in
 * the Inspector, same discipline as Flow A vs Flow B in B1 (an ambiguous
 * gesture could trigger either).
 *
 *   Right hand pinch, then move the hand -> drone moves the same
 *   direction, one fixed step per `dragThresholdUnits` of real hand
 *   travel. Release the pinch to stop; pinch again to resume from
 *   wherever the hand currently is (not from the original start point).
 *
 * Uses the RIGHT hand's pinch — doesn't collide with HandCommandController
 * (right hand open+raised/lowered for takeoff/land): a pinch is fingers
 * together, an open hand is fingers apart, so the two hand shapes can't be
 * mistaken for each other. DOES collide with anything else that also uses
 * right-hand pinch (AnchorDestinationController's destination-placement,
 * WaypointSelector's marker selection) — disable those for this demo.
 *
 * Left/right/up/down are world-space (compared against where the pinch
 * started), same documented simplification as DirectionalHandController —
 * not the wearer's facing-relative directions. See that file's header for
 * why (no verified camera-facing-vector API to build on right now).
 */
@component
export class PinchDragController extends BaseScriptComponent {
  @input
  @hint('How far the pinch must travel (world units) from its last reset point before one move command fires.')
  dragThresholdUnits: number = 15;

  @input
  @hint('Relative flight distance per step, in cm. Tello go range is 20-500 per axis.')
  moveDistanceCm: number = 50;

  @input
  @hint('Flight speed for these moves, in cm/s. Tello range is 10-100.')
  speedCmPerSec: number = 40;

  @input
  @hint('Minimum time between fired moves, to avoid a double-fire from hand jitter right at the threshold.')
  cooldownMs: number = 400;

  private hand = SIK.HandInputData.getHand(HandSide.Right);

  /** Reset every time a move fires, or whenever the pinch is (re)started — "drag from here" each time. */
  private anchor: vec3 | null = null;
  private lastFireMs = -Infinity;

  onAwake(): void {
    this.createEvent('UpdateEvent').bind(() => this.tick());
  }

  private tick(): void {
    try {
      this.checkDrag();
    } catch (err) {
      // Editor-preview fallback — hand data may be absent/mocked without real hardware.
      print(`[PinchDragController] Read failed (expected in some editor-preview states): ${err}`);
    }
  }

  private checkDrag(): void {
    if (!this.hand.isTracked() || !this.hand.isPinching()) {
      this.anchor = null;
      return;
    }

    const current = this.hand.indexTip.position;
    if (this.anchor === null) {
      this.anchor = current; // pinch just started (or just resumed after a release) — drag from here
      return;
    }

    const now = getTime() * 1000;
    if (now - this.lastFireMs < this.cooldownMs) return;

    const deltaX = current.x - this.anchor.x;
    const deltaY = current.y - this.anchor.y;

    // Vertical takes priority when both exceed threshold at once — same
    // reasoning as DirectionalHandController: a mostly-vertical drag is
    // usually also a little off-axis sideways, and treating that as
    // "also sideways" would fire the wrong direction.
    // Tello's go-vector convention (TelloGoVector.ts): y = left(+)/right(-), z = up(+)/down(-).
    let offsetCm: vec3 | null = null;
    let label = '';
    if (deltaY > this.dragThresholdUnits) {
      offsetCm = new vec3(0, 0, this.moveDistanceCm);
      label = 'up';
    } else if (deltaY < -this.dragThresholdUnits) {
      offsetCm = new vec3(0, 0, -this.moveDistanceCm);
      label = 'down';
    } else if (deltaX < -this.dragThresholdUnits) {
      offsetCm = new vec3(0, this.moveDistanceCm, 0);
      label = 'left';
    } else if (deltaX > this.dragThresholdUnits) {
      offsetCm = new vec3(0, -this.moveDistanceCm, 0);
      label = 'right';
    }

    if (offsetCm !== null) {
      this.lastFireMs = now;
      this.anchor = current; // re-arm from here — continuing to drag further fires another step
      const clamped = clampGoVector(offsetCm);
      DroneEvents.onCommandRequested.invoke({ type: 'goto', x: clamped.x, y: clamped.y, z: clamped.z, speed: this.speedCmPerSec });
      print(`[PinchDragController] ${label}`);
    }
  }
}
