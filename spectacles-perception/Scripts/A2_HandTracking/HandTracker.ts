import { SIK } from 'SpectaclesInteractionKit.lspkg/SIK';
// Verified against installed SIK v0.17.2 source: WorldCameraFinderProvider is
// a DEFAULT export (`export default class WorldCameraFinderProvider`), and
// its constructor throws unless the main Camera's SceneObject has a
// DeviceTracking component present (mode doesn't matter for the check) —
// added one to Camera Object in-editor to satisfy this.
import WorldCameraFinderProvider from 'SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider';
import { BaseHand } from 'SpectaclesInteractionKit.lspkg/Providers/HandInputData/BaseHand';
import { PerceptionEvents } from '../Core/PerceptionEvents';
import { HandSide, HandState, HandsSnapshot } from '../Core/PerceptionTypes';

/**
 * A2 — Hand detection & tracking.
 *
 * Thin wrapper around the Spectacles Interaction Kit's HandInputData,
 * normalized into this module's own HandState shape so the rest of the
 * pipeline (A3/A4) doesn't depend on SIK types directly — if the hand
 * tracking source ever changes, only this file needs to change.
 *
 * Sticks to SIK's stable core surface only (HandInputData, BaseHand's
 * getPalmCenter()/indexTip/isTracked(), WorldCameraFinderProvider) per
 * spectacles-522-portable-design — verified present, unchanged, in the
 * installed SIK v0.17.2 source.
 *
 * Emits PerceptionEvents.onHandsUpdated every update tick with both hands'
 * tracked state, including a smoothed velocity estimate (used by A4 to
 * detect "hand approaching face").
 */
@component
export class HandTracker extends BaseScriptComponent {
  @input
  @allowUndefined
  @hint('Optional override for the face/mouth anchor. Left empty, this auto-uses the world camera (wearer\'s head pose) via WorldCameraFinderProvider — no manual wiring needed.')
  faceAnchorOverride: SceneObject;

  @input
  @hint('Smoothing factor for velocity estimate, 0-1. Higher = more responsive, noisier.')
  velocitySmoothing: number = 0.4;

  private handInputData = SIK.HandInputData;
  private leftHand = this.handInputData.getHand(HandSide.Left);
  private rightHand = this.handInputData.getHand(HandSide.Right);

  // Plain string-literal keys (not computed [HandSide.Left]) — HandSide.Left's
  // type is the HandSide union itself, not the narrowed literal 'left', so a
  // computed key here would widen the object to a string index signature and
  // fail the Record<HandSide, vec3> check.
  private prevPositions: Record<HandSide, vec3> = {
    left: vec3.zero(),
    right: vec3.zero(),
  };
  private smoothedVelocity: Record<HandSide, vec3> = {
    left: vec3.zero(),
    right: vec3.zero(),
  };

  onAwake(): void {
    this.createEvent('UpdateEvent').bind(() => this.onUpdate());
  }

  private onUpdate(): void {
    const dt = Math.max(getDeltaTime(), 1 / 240);
    // Editor-preview fallback: hand tracking data may be absent/mocked in
    // preview without a device — never let a read here throw and kill the
    // whole update loop.
    let left: HandState;
    let right: HandState;
    try {
      left = this.buildHandState(HandSide.Left, this.leftHand, dt);
      right = this.buildHandState(HandSide.Right, this.rightHand, dt);
    } catch (err) {
      print(`[HandTracker] read failed (expected in some editor-preview states): ${err}`);
      return;
    }
    PerceptionEvents.onHandsUpdated.invoke({ left, right });
  }

  private buildHandState(side: HandSide, hand: BaseHand, dt: number): HandState {
    const timestampMillis = getTime() * 1000;

    if (!hand.isTracked()) {
      return {
        side,
        isTracked: false,
        palmPosition: vec3.zero(),
        indexTipPosition: vec3.zero(),
        velocity: vec3.zero(),
        distanceToFace: Number.POSITIVE_INFINITY,
        timestampMillis,
      };
    }

    // getPalmCenter() is BaseHand's own documented "hand position" helper
    // (used internally by SIK for hand-overlap checks — exactly our
    // hand/object intersection use case); wrist.position is the fallback
    // for the rare frame where it returns null.
    const palmPosition: vec3 = hand.getPalmCenter() ?? hand.wrist.position;
    const indexTipPosition: vec3 = hand.indexTip.position;

    const instantVelocity = palmPosition.sub(this.prevPositions[side]).uniformScale(1 / dt);
    const smoothed = this.smoothedVelocity[side].uniformScale(1 - this.velocitySmoothing).add(
      instantVelocity.uniformScale(this.velocitySmoothing)
    );
    this.smoothedVelocity[side] = smoothed;
    this.prevPositions[side] = palmPosition;

    return {
      side,
      isTracked: true,
      palmPosition,
      indexTipPosition,
      velocity: smoothed,
      distanceToFace: indexTipPosition.distance(this.faceAnchorPosition()),
      timestampMillis,
    };
  }

  private faceAnchorPosition(): vec3 {
    if (this.faceAnchorOverride) return this.faceAnchorOverride.getTransform().getWorldPosition();
    try {
      return WorldCameraFinderProvider.getInstance().getWorldPosition();
    } catch (err) {
      print(`[HandTracker] WorldCameraFinderProvider unavailable, falling back to origin: ${err}`);
      return vec3.zero();
    }
  }

}
