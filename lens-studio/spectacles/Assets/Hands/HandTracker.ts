import { SIK } from 'SpectaclesInteractionKit.lspkg/SIK';
import { PerceptionEvents } from '../Core/PerceptionEvents';
import { HandSide, HandState, HandsSnapshot } from '../Core/PerceptionTypes';

/**
 * Hand detection & tracking.
 *
 * Thin wrapper around the Spectacles Interaction Kit's HandInputData,
 * normalized into this module's own HandState shape so the rest of the
 * pipeline (food-in-hand classification, eating-event detection) doesn't
 * depend on SIK types directly — if the hand tracking source ever changes,
 * only this file needs to change.
 *
 * Emits PerceptionEvents.onHandsUpdated every update tick with both hands'
 * tracked state, including a smoothed velocity estimate (available for any
 * future gesture logic — the eating-event detector itself currently only
 * needs the food-in-hand signal, not hand motion).
 */
@component
export class HandTracker extends BaseScriptComponent {
  @input
  @hint('Anchor approximating the wearer\'s own face/mouth (e.g. the world camera object, or a small offset from it). Used for hand-to-face distance.')
  faceAnchor: SceneObject;

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
    const snapshot: HandsSnapshot = {
      left: this.buildHandState(HandSide.Left, this.leftHand, dt),
      right: this.buildHandState(HandSide.Right, this.rightHand, dt),
    };
    PerceptionEvents.onHandsUpdated.invoke(snapshot);
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
        timestampMillis,
      };
    }

    const palmPosition: vec3 = hand.palmCenter?.position ?? vec3.zero();
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
      timestampMillis,
    };
  }

  /** World-space distance from a hand to the face anchor, in the scene's world units (cm if the project uses cm scale). */
  distanceToFace(hand: HandState): number {
    if (!hand.isTracked || !this.faceAnchor) return Number.POSITIVE_INFINITY;
    const facePos = this.faceAnchor.getTransform().getWorldPosition();
    return hand.indexTipPosition.distance(facePos);
  }
}
