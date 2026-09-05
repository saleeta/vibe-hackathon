import { SIK } from 'SpectaclesInteractionKit.lspkg/SIK';
import WorldCameraFinderProvider from 'SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider';
import { BaseHand } from 'SpectaclesInteractionKit.lspkg/Providers/HandInputData/BaseHand';
import { DroneEvents } from '../Core/DroneEvents';
import { HandSide } from '../Core/DroneTypes';

/**
 * B2 — discrete hand-pose commands, deliberately not continuous joystick-
 * style control (see the module README for that as a documented V2
 * extension using Tello's `rc` stick-emulation command):
 *
 *   Right hand open, raised above head, held   -> takeoff
 *   Right hand open, lowered below head, held  -> land
 *   Both hands closed into fists               -> emergency stop
 *
 * "Open"/"fist" are read from BaseHand's real fingertip + palm-center API
 * (average fingertip-to-palm distance), not a trained gesture model — no
 * such model exists for this project, same honest situation as the other
 * two modules' object detectors.
 */
@component
export class HandCommandController extends BaseScriptComponent {
  @input
  @hint('Average fingertip-to-palm distance (world units) below which a hand counts as a closed fist.')
  fistThreshold: number = 5;

  @input
  @hint('Average fingertip-to-palm distance (world units) above which a hand counts as an open flat hand.')
  openThreshold: number = 9;

  @input
  @hint('How far above head height (world units) counts as "raised" for takeoff.')
  raiseAboveHead: number = 15;

  @input
  @hint('How far below head height counts as "lowered" for landing.')
  lowerBelowHead: number = 35;

  @input
  @hint('How long the pose must be held before the command fires.')
  holdMs: number = 700;

  private handInputData = SIK.HandInputData;
  private leftHand = this.handInputData.getHand(HandSide.Left);
  private rightHand = this.handInputData.getHand(HandSide.Right);

  private raiseHoldStartMs: number | null = null;
  private lowerHoldStartMs: number | null = null;
  private emergencyFired = false; // one fist-hold fires exactly one emergency command, not a stream of them

  onAwake(): void {
    this.createEvent('UpdateEvent').bind(() => this.tick());
  }

  private tick(): void {
    try {
      this.checkTakeoffLand();
      this.checkEmergency();
    } catch (err) {
      // Editor-preview fallback — hand data may be absent/mocked without real hardware.
      print(`[HandCommandController] Read failed (expected in some editor-preview states): ${err}`);
    }
  }

  private avgFingertipToPalmDistance(hand: BaseHand): number | null {
    const palm = hand.getPalmCenter();
    if (!palm) return null;
    const tips = [hand.thumbTip, hand.indexTip, hand.middleTip, hand.ringTip, hand.pinkyTip];
    const total = tips.reduce((sum, tip) => sum + tip.position.distance(palm), 0);
    return total / tips.length;
  }

  private faceY(): number {
    try {
      return WorldCameraFinderProvider.getInstance().getWorldPosition().y;
    } catch {
      return 0;
    }
  }

  private checkTakeoffLand(): void {
    if (!this.rightHand.isTracked()) {
      this.raiseHoldStartMs = null;
      this.lowerHoldStartMs = null;
      return;
    }

    const dist = this.avgFingertipToPalmDistance(this.rightHand);
    if (dist === null || dist < this.openThreshold) {
      this.raiseHoldStartMs = null;
      this.lowerHoldStartMs = null;
      return; // must be an open hand, not mid-gesture
    }

    const handY = this.rightHand.getPalmCenter()!.y;
    const face = this.faceY();
    const now = getTime() * 1000;

    if (handY > face + this.raiseAboveHead) {
      this.lowerHoldStartMs = null;
      if (this.raiseHoldStartMs === null) {
        this.raiseHoldStartMs = now;
      } else if (now - this.raiseHoldStartMs >= this.holdMs) {
        this.raiseHoldStartMs = null;
        DroneEvents.onCommandRequested.invoke({ type: 'takeoff' });
      }
    } else if (handY < face - this.lowerBelowHead) {
      this.raiseHoldStartMs = null;
      if (this.lowerHoldStartMs === null) {
        this.lowerHoldStartMs = now;
      } else if (now - this.lowerHoldStartMs >= this.holdMs) {
        this.lowerHoldStartMs = null;
        DroneEvents.onCommandRequested.invoke({ type: 'land' });
      }
    } else {
      this.raiseHoldStartMs = null;
      this.lowerHoldStartMs = null;
    }
  }

  private checkEmergency(): void {
    const leftFist = this.leftHand.isTracked() && (this.avgFingertipToPalmDistance(this.leftHand) ?? Infinity) < this.fistThreshold;
    const rightFist = this.rightHand.isTracked() && (this.avgFingertipToPalmDistance(this.rightHand) ?? Infinity) < this.fistThreshold;

    if (leftFist && rightFist) {
      if (!this.emergencyFired) {
        this.emergencyFired = true;
        DroneEvents.onCommandRequested.invoke({ type: 'emergency' });
        print('[HandCommandController] EMERGENCY — both hands closed.');
      }
    } else {
      this.emergencyFired = false;
    }
  }
}
