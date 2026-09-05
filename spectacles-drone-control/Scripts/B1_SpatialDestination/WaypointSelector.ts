import { SIK } from 'SpectaclesInteractionKit.lspkg/SIK';
import { BaseHand } from 'SpectaclesInteractionKit.lspkg/Providers/HandInputData/BaseHand';
import { DroneEvents } from '../Core/DroneEvents';
import { HandSide } from '../Core/DroneTypes';
import { WaypointMarker } from './WaypointMarker';
import { clampGoVector } from './TelloGoVector';

/**
 * B1 — pick a waypoint by pinching near it. Whichever hand is pinching,
 * whichever marker is within selectionRadius of that hand's index
 * fingertip wins (nearest, if more than one is in range). Debounced so
 * one pinch fires exactly one command — "point at a marker and pinch,
 * the drone flies there."
 */
@component
export class WaypointSelector extends BaseScriptComponent {
  // Three individual reference inputs rather than an array — Lens Studio's
  // MCP tooling has a known gap setting array-of-component-reference script
  // inputs from outside the editor; single AssignableType references (the
  // pattern used everywhere else in this project) are unaffected.
  @input
  @allowUndefined
  waypoint1: WaypointMarker;

  @input
  @allowUndefined
  waypoint2: WaypointMarker;

  @input
  @allowUndefined
  waypoint3: WaypointMarker;

  @input
  @hint('How close (world units) a pinching fingertip must be to a marker to select it.')
  selectionRadius: number = 10;

  @input
  @hint('Minimum time between selections, to avoid re-firing on tracking jitter.')
  cooldownMs: number = 1200;

  private handInputData = SIK.HandInputData;
  private leftHand = this.handInputData.getHand(HandSide.Left);
  private rightHand = this.handInputData.getHand(HandSide.Right);
  private lastSelectedAtMs = -Infinity;

  onAwake(): void {
    this.createEvent('UpdateEvent').bind(() => this.tick());
  }

  private tick(): void {
    try {
      this.checkHand(this.leftHand);
      this.checkHand(this.rightHand);
    } catch (err) {
      print(`[WaypointSelector] Hand read failed (expected in some editor-preview states): ${err}`);
    }
  }

  private checkHand(hand: BaseHand): void {
    if (!hand.isTracked() || !hand.isPinching()) return;
    const now = getTime() * 1000;
    if (now - this.lastSelectedAtMs < this.cooldownMs) return;

    const candidates = [this.waypoint1, this.waypoint2, this.waypoint3].filter(
      (marker): marker is WaypointMarker => !!marker
    );
    if (candidates.length === 0) return;

    const fingertip = hand.indexTip.position;
    let nearest: WaypointMarker | null = null;
    let nearestDist = this.selectionRadius;
    for (const marker of candidates) {
      const dist = marker.getWorldPosition().distance(fingertip);
      if (dist <= nearestDist) {
        nearest = marker;
        nearestDist = dist;
      }
    }
    if (!nearest) return;

    this.lastSelectedAtMs = now;
    nearest.flashSelected();

    const clamped = clampGoVector(nearest.getOffsetCm());
    DroneEvents.onCommandRequested.invoke({
      type: 'goto',
      x: clamped.x,
      y: clamped.y,
      z: clamped.z,
      speed: nearest.getSpeedCmPerSec(),
    });
  }
}
