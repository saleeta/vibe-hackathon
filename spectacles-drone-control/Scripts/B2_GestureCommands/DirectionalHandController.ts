import { SIK } from 'SpectaclesInteractionKit.lspkg/SIK';
import WorldCameraFinderProvider from 'SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider';
import { BaseHand } from 'SpectaclesInteractionKit.lspkg/Providers/HandInputData/BaseHand';
import { DroneEvents } from '../Core/DroneEvents';
import { HandSide } from '../Core/DroneTypes';
import { clampGoVector } from '../B1_SpatialDestination/TelloGoVector';

/**
 * B2 continued — LEFT/RIGHT/UP/DOWN, same discrete hold-gesture style as
 * HandCommandController's takeoff/land (deliberately not continuous
 * joystick control — see that file's header). Uses the LEFT hand so it
 * can't collide with takeoff/land, which are already the right hand:
 *
 *   Left hand open, raised above head, held    -> fly up
 *   Left hand open, lowered below head, held   -> fly down
 *   Left hand open, held out to the wearer's world-left, held  -> fly left
 *   Left hand open, held out to the wearer's world-right, held -> fly right
 *
 * Each fires one `goto` command for a fixed step distance, same "hold
 * -> fires -> re-arms immediately" behavior as HandCommandController's
 * takeoff/land (a held pose keeps re-firing every holdMs — that's existing,
 * accepted behavior there too, not a new gap introduced here).
 *
 * LEFT/RIGHT ARE WORLD-SPACE, NOT WEARER-FACING-RELATIVE: compared directly
 * against the head's world X position, the same way HandCommandController
 * already compares hand Y against head Y for takeoff/land. This means
 * "left" is a fixed world direction, not "to whichever way the wearer is
 * currently facing" — correct as long as the wearer stays facing roughly
 * one direction during a flight (fine for a demo), wrong if they turn
 * around mid-flight. Doing this properly needs the camera's actual facing
 * direction (its right vector), which WorldCameraFinderProvider may or may
 * not expose under a verified method name — rather than guess at an
 * unconfirmed API, this sticks to the same world-axis-comparison pattern
 * already proven working in this file's sibling. Revisit with a
 * camera-relative axis if wearers turning around becomes a real problem.
 */
@component
export class DirectionalHandController extends BaseScriptComponent {
  @input
  @hint('Average fingertip-to-palm distance (world units) above which a hand counts as an open flat hand.')
  openThreshold: number = 9;

  @input
  @hint('How far above head height (world units) counts as "raised" for up.')
  raiseAboveHead: number = 15;

  @input
  @hint('How far below head height (world units) counts as "lowered" for down.')
  lowerBelowHead: number = 35;

  @input
  @hint('How far to the world-left/right of head position (world units) counts as "held out" for left/right.')
  sidewaysFromHead: number = 20;

  @input
  @hint('How long the pose must be held before the command fires.')
  holdMs: number = 700;

  @input
  @hint('Relative flight distance per gesture, in cm. Tello go range is 20-500 per axis.')
  moveDistanceCm: number = 50;

  @input
  @hint('Flight speed for these moves, in cm/s. Tello range is 10-100.')
  speedCmPerSec: number = 40;

  private handInputData = SIK.HandInputData;
  private leftHand = this.handInputData.getHand(HandSide.Left);

  private upHoldStartMs: number | null = null;
  private downHoldStartMs: number | null = null;
  private leftHoldStartMs: number | null = null;
  private rightHoldStartMs: number | null = null;

  onAwake(): void {
    this.createEvent('UpdateEvent').bind(() => this.tick());
  }

  private tick(): void {
    try {
      this.checkDirections();
    } catch (err) {
      // Editor-preview fallback — hand data may be absent/mocked without real hardware.
      print(`[DirectionalHandController] Read failed (expected in some editor-preview states): ${err}`);
    }
  }

  private avgFingertipToPalmDistance(hand: BaseHand): number | null {
    const palm = hand.getPalmCenter();
    if (!palm) return null;
    const tips = [hand.thumbTip, hand.indexTip, hand.middleTip, hand.ringTip, hand.pinkyTip];
    const total = tips.reduce((sum, tip) => sum + tip.position.distance(palm), 0);
    return total / tips.length;
  }

  private headPosition(): vec3 {
    try {
      return WorldCameraFinderProvider.getInstance().getWorldPosition();
    } catch {
      return vec3.zero();
    }
  }

  private checkDirections(): void {
    if (!this.leftHand.isTracked()) {
      this.clearAllHolds();
      return;
    }

    const dist = this.avgFingertipToPalmDistance(this.leftHand);
    if (dist === null || dist < this.openThreshold) {
      this.clearAllHolds(); // must be an open hand, not mid-gesture
      return;
    }

    const palm = this.leftHand.getPalmCenter()!;
    const head = this.headPosition();
    const now = getTime() * 1000;

    const deltaY = palm.y - head.y;
    const deltaX = palm.x - head.x;

    // Vertical takes priority over horizontal when both exceed threshold at
    // once — a raised/lowered hand is usually also off-center sideways, and
    // treating that as "also sideways" would fire the wrong command.
    // Tello's go-vector convention (see TelloGoVector.ts / drone-bridge's
    // VOICE_SYSTEM_PROMPT): x = forward(+)/back(-), y = left(+)/right(-), z = up(+)/down(-).
    if (deltaY > this.raiseAboveHead) {
      this.holdFor('up', now, new vec3(0, 0, this.moveDistanceCm));
    } else if (deltaY < -this.lowerBelowHead) {
      this.holdFor('down', now, new vec3(0, 0, -this.moveDistanceCm));
    } else if (deltaX < -this.sidewaysFromHead) {
      this.holdFor('left', now, new vec3(0, this.moveDistanceCm, 0));
    } else if (deltaX > this.sidewaysFromHead) {
      this.holdFor('right', now, new vec3(0, -this.moveDistanceCm, 0));
    } else {
      this.clearAllHolds();
    }
  }

  private holdFor(direction: 'up' | 'down' | 'left' | 'right', now: number, offsetCm: vec3): void {
    const key = `${direction}HoldStartMs` as 'upHoldStartMs' | 'downHoldStartMs' | 'leftHoldStartMs' | 'rightHoldStartMs';
    this.clearAllHolds(key);
    if (this[key] === null) {
      this[key] = now;
    } else if (now - this[key]! >= this.holdMs) {
      this[key] = null;
      const clamped = clampGoVector(offsetCm);
      DroneEvents.onCommandRequested.invoke({ type: 'goto', x: clamped.x, y: clamped.y, z: clamped.z, speed: this.speedCmPerSec });
      print(`[DirectionalHandController] ${direction}`);
    }
  }

  /** Clears every hold timer except the one currently in progress (if any). */
  private clearAllHolds(except?: 'upHoldStartMs' | 'downHoldStartMs' | 'leftHoldStartMs' | 'rightHoldStartMs'): void {
    if (except !== 'upHoldStartMs') this.upHoldStartMs = null;
    if (except !== 'downHoldStartMs') this.downHoldStartMs = null;
    if (except !== 'leftHoldStartMs') this.leftHoldStartMs = null;
    if (except !== 'rightHoldStartMs') this.rightHoldStartMs = null;
  }
}
