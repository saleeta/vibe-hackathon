import { SIK } from 'SpectaclesInteractionKit.lspkg/SIK';
// TODO(verify): confirm exact export path for WorldCameraFinderProvider in the
// installed SIK 0.16.4 — per spectacles-522-portable-design, it's part of SIK's
// stable core surface across 0.16.4-0.18, used here to auto-derive a "face"
// anchor (the wearer's own head/camera pose) with zero manual scene wiring.
import { WorldCameraFinderProvider } from 'SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider';
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
 * Sticks to SIK's stable core surface only (HandInputData wrist/indexTip,
 * WorldCameraFinderProvider) per spectacles-522-portable-design — these are
 * confirmed unchanged across SIK 0.16.4-0.18, so this file needs no rework
 * regardless of which SIK version the main app ends up on.
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

  private prevPositions: Record<HandSide, vec3> = {
    [HandSide.Left]: vec3.zero(),
    [HandSide.Right]: vec3.zero(),
  };
  private smoothedVelocity: Record<HandSide, vec3> = {
    [HandSide.Left]: vec3.zero(),
    [HandSide.Right]: vec3.zero(),
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

  private buildHandState(side: HandSide, hand: any, dt: number): HandState {
    const isTracked: boolean = typeof hand.isTracked === 'function' ? hand.isTracked() : !!hand.isTracked;
    const timestampMillis = getTime() * 1000;

    if (!isTracked) {
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

    // `wrist` + `indexTip` are the two joints spectacles-522-portable-design
    // calls out as SIK's confirmed-stable read surface. `wrist` stands in for
    // "hand anchor position" here (PerceptionTypes keeps the field named
    // `palmPosition` for readability elsewhere in the pipeline).
    const palmPosition: vec3 = hand.wrist?.position ?? vec3.zero();
    const indexTipPosition: vec3 = hand.indexTip?.position ?? palmPosition;

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
