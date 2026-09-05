import { SIK } from 'SpectaclesInteractionKit.lspkg/SIK';
import { AnchorModule } from 'Spatial Anchors.lspkg/AnchorModule';
import { AnchorSession, AnchorSessionOptions } from 'Spatial Anchors.lspkg/AnchorSession';
import { WorldAnchor } from 'Spatial Anchors.lspkg/WorldAnchor';
import { DroneEvents } from '../Core/DroneEvents';
import { HandSide } from '../Core/DroneTypes';
import { clampGoVector } from './TelloGoVector';

/**
 * B1 — spatial-anchor destinations, placed by pinch gesture:
 *
 *   LEFT hand quick pinch  -> place/update the HOME anchor
 *                             (do this once, right after takeoff, at the
 *                             drone's actual position — everything else is
 *                             computed relative to this point, since Tello
 *                             has no absolute positioning of its own)
 *   RIGHT hand quick pinch -> place/update the DESTINATION anchor
 *   RIGHT hand pinch HELD  -> commit: send the drone to the destination
 *                             (a relative `go` command, home->destination)
 *
 * "Point where you want it to go, hold to commit" — a quick pinch alone
 * only repositions the marker, it never sends a command by itself.
 */
@component
export class AnchorDestinationController extends BaseScriptComponent {
  @input
  anchorModule: AnchorModule;

  @input
  @hint('Minimum time between pinch-triggered anchor placements, to avoid re-placing on tracking jitter.')
  debounceMs: number = 800;

  @input
  @hint('How long the right-hand pinch must be held to commit to flying, after the destination marker updates.')
  flyHoldMs: number = 1200;

  @input
  flySpeedCmPerSec: number = 40;

  private session: AnchorSession;
  private homeAnchor: WorldAnchor | null = null;
  private destinationAnchor: WorldAnchor | null = null;

  private lastPlacedAtMs = { left: -Infinity, right: -Infinity };
  private rightPinchStartMs: number | null = null;
  private rightFlyTriggered = false;

  private handInputData = SIK.HandInputData;
  private leftHand = this.handInputData.getHand(HandSide.Left);
  private rightHand = this.handInputData.getHand(HandSide.Right);

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.start());
  }

  private async start(): Promise<void> {
    try {
      const options = new AnchorSessionOptions();
      options.area = 'drone-control';
      options.scanForWorldAnchors = false; // this session only cares about anchors it places itself
      this.session = await this.anchorModule.openSession(options);
    } catch (err) {
      print(`[AnchorDestinationController] Failed to open anchor session (expected in some editor-preview states): ${err}`);
      return;
    }
    this.createEvent('UpdateEvent').bind(() => this.tick());
  }

  private tick(): void {
    this.checkLeftHome();
    this.checkRightDestination();
  }

  private checkLeftHome(): void {
    if (!this.session || !this.leftHand.isTracked()) return;
    const now = getTime() * 1000;
    if (now - this.lastPlacedAtMs.left < this.debounceMs) return;
    if (!this.leftHand.isPinching()) return;

    this.lastPlacedAtMs.left = now;
    this.placeAnchor('home', this.leftHand.indexTip.position);
  }

  private checkRightDestination(): void {
    if (!this.session || !this.rightHand.isTracked()) {
      this.rightPinchStartMs = null;
      this.rightFlyTriggered = false;
      return;
    }

    const now = getTime() * 1000;
    if (!this.rightHand.isPinching()) {
      this.rightPinchStartMs = null;
      this.rightFlyTriggered = false;
      return;
    }

    if (this.rightPinchStartMs === null) {
      this.rightPinchStartMs = now;
      if (now - this.lastPlacedAtMs.right >= this.debounceMs) {
        this.lastPlacedAtMs.right = now;
        this.placeAnchor('destination', this.rightHand.indexTip.position);
      }
    } else if (!this.rightFlyTriggered && now - this.rightPinchStartMs >= this.flyHoldMs) {
      this.rightFlyTriggered = true;
      this.triggerFlyToDestination();
    }
  }

  private async placeAnchor(role: 'home' | 'destination', worldPosition: vec3): Promise<void> {
    try {
      // Translation-only pose — we only need a destination point, not an orientation.
      const pose = mat4.fromTranslation(worldPosition);
      const anchor = await this.session.createWorldAnchor(pose);
      if (role === 'home') this.homeAnchor = anchor;
      else this.destinationAnchor = anchor;
      DroneEvents.onAnchorPlaced.invoke({ role, worldPosition });
    } catch (err) {
      print(`[AnchorDestinationController] Failed to place ${role} anchor: ${err}`);
    }
  }

  private triggerFlyToDestination(): void {
    const relative = this.getRelativeDestinationCm();
    if (!relative) {
      print('[AnchorDestinationController] Need both a home and a destination anchor before flying.');
      return;
    }
    const clamped = clampGoVector(relative);
    DroneEvents.onCommandRequested.invoke({
      type: 'goto',
      x: clamped.x,
      y: clamped.y,
      z: clamped.z,
      speed: this.flySpeedCmPerSec,
    });
  }

  /**
   * Home -> destination vector. Assumes the scene's world units are already
   * centimeters (matching Tello's `go` command units) and that the drone
   * hasn't rotated significantly since takeoff — see TelloGoVector.ts and
   * the module README for why that second assumption is a real, documented
   * V1 limitation, not an oversight.
   */
  private getRelativeDestinationCm(): vec3 | null {
    const homePose = this.homeAnchor?.toWorldFromAnchor;
    const destPose = this.destinationAnchor?.toWorldFromAnchor;
    if (!homePose || !destPose) return null;
    return positionFromMat4(destPose).sub(positionFromMat4(homePose));
  }
}

function positionFromMat4(m: mat4): vec3 {
  // TODO(verify): exact mat4 accessor for the translation column against the
  // installed Lens Studio 5.15.4 types — assumed column-major, translation
  // in column3, matching the fromTranslation/mult pattern used to build
  // poses elsewhere in this file.
  const column3 = (m as unknown as { column3: vec4 }).column3;
  return new vec3(column3.x, column3.y, column3.z);
}
