import { PerceptionEvents } from '../../Core/PerceptionEvents';
import { HandSide, HandsSnapshot, HandState } from '../../Core/PerceptionTypes';
import { WorkoutEvents } from '../Core/WorkoutEvents';
import { CurlState } from '../Core/WorkoutTypes';

/**
 * Bicep curl tracker. Reuses the existing `Hands/HandTracker.ts` component's
 * `onHandsUpdated` signal instead of a second hand-tracking path — this
 * module and the nutrition pipeline share one HandTracker instance.
 *
 * Tracks the tracked hand's **index-tip** height relative to the head
 * anchor. (Not the palm: SIK's palm centre needs a method call HandTracker
 * originally got wrong, so palm position read as the origin for a long time;
 * the index tip is a plain Keypoint that has always been valid and its
 * height swings the most across a curl anyway.)
 *
 * Reaching `curledHeightThreshold` (wrist near shoulder/chest height) fires
 * `onCurlUp` immediately — the fast, low-latency signal the dino-jump game
 * reacts to. Only dropping back to `extendedHeightThreshold` (arm hanging
 * down) completes the cycle and fires `onCurlRep`, which increments the rep
 * counter — so a game jump feels instant, but a counted rep needs a real
 * full curl.
 *
 * UNITS: centimetres (this scene's world/tracking scale). Captured
 * reference for a right-arm curl: index tip at ~-85 cm below head with the
 * arm hanging down, rising to ~-10 cm below head fully curled. Defaults
 * below (-25 curled, -60 extended) sit inside that range with margin. Tune
 * from the `[FitLens:Curl]` diagnostic log's live `relativeHeight` reading
 * if they don't match the wearer's build.
 */
@component
export class BicepCurlTracker extends BaseScriptComponent {
  @input
  @hint('Which hand to track for curls — "left" or "right".')
  hand: string = 'right';

  @input
  @hint('Anchor approximating head/camera height (e.g. the world camera object).')
  headAnchor: SceneObject;

  @input
  @hint('Index-tip height relative to the head anchor (cm) to count as "curled". Captured curl up-swings cross well above -20 (peaks -9..-17) while still tracked; the fully-held-up pose itself is out of the tracking volume, so this is a pass-through crossing, not an endpoint.')
  curledHeightThreshold: number = -20;

  @input
  @hint('Index-tip height relative to the head anchor (cm) to count as "extended". Captured down-swings reliably cross -45 while tracked (they bottom out -50..-66 but tracking often drops before then), so -45 not -60.')
  extendedHeightThreshold: number = -45;

  @input
  @hint('If stuck in the "curled" state longer than this (ms) — usually because the hand went out of the tracking volume at the top of a rep — silently reset to "extended" so the counter does not jam. No rep is counted.')
  curlTimeoutMs: number = 4000;

  @input
  @hint("Weight being curled, in kg — Spectacles can't sense actual load, so this is manual. Keep in sync with WorkoutManager.curlWeightKg.")
  curlWeightKg: number = 5;

  @input
  @hint('Smoothing factor for relativeHeight, 0-1. Higher = more responsive, noisier. Filters out single-frame tracking spikes.')
  heightSmoothing: number = 0.35;

  @input
  @hint('Ignore readings for this many ms right after the hand is (re)acquired — the first tracked position after acquisition is frequently garbage/stale.')
  trackingSettleMs: number = 300;

  @input
  @hint('If tracking drops for less than this many ms, hold the curl state instead of resetting — a curl routinely nudges the hand past the FOV edge mid-rep. Longer gaps are treated as a real loss (re-settle on re-acquire).')
  trackingGraceMs: number = 400;

  @input
  @hint('How often (ms) to print a diagnostic line with the live wrist height while tuning. 0 disables.')
  diagnosticIntervalMs: number = 500;

  @input
  @hint('Optional — a plain 3D Text (no ScreenTransform) pinned live to the tracked hand\'s actual world position, showing the live numbers. Lets you visually check whether the tracked point is really where your hand is.')
  handDebugMarker: SceneObject | null = null;

  @input
  handDebugText: Text | null = null;

  @input
  @hint('Optional — a plain 3D Text pinned to the head anchor\'s world position, for the same visual sanity check.')
  headDebugMarker: SceneObject | null = null;

  @input
  headDebugText: Text | null = null;

  private state: CurlState = CurlState.Extended;
  private lastDiagnosticMillis = 0;
  private wasTracked = false;
  private trackingAcquiredMillis = 0;
  private lastTrackedMillis = 0;
  private curlEnteredMillis = 0;
  private smoothedRelativeHeight: number | null = null;

  onAwake(): void {
    PerceptionEvents.onHandsUpdated.add((snapshot) => this.onHands(snapshot));

    // A world-tracking reset/relocalization can desync the head anchor's and
    // the hand's reported positions for a frame — drop the smoothed value so
    // the next reading starts fresh instead of blending against a now-stale
    // number (same rationale as StepCounter/SquatTracker's reset handling).
    this.createEvent('WorldTrackingResetEvent').bind(() => {
      print('[FitLens:Curl] World tracking reset — resettling.');
      this.smoothedRelativeHeight = null;
      this.trackingAcquiredMillis = getTime() * 1000;
    });
  }

  private onHands(snapshot: HandsSnapshot): void {
    if (!this.headAnchor) {
      print('[FitLens:Curl] ERROR — headAnchor is not set, cannot compute relative wrist height.');
      return;
    }

    const handState: HandState = this.hand === HandSide.Left ? snapshot.left : snapshot.right;
    const nowMillis = getTime() * 1000;

    // Auto-unjam. The top of a curl is outside the hand-tracking volume (captured:
    // 0% tracked while a fully-curled arm was held), so the "returned to extended"
    // crossing can be missed entirely. If we've been Curled too long, reset without
    // counting rather than stalling the counter. Runs regardless of tracking state.
    if (this.state === CurlState.Curled && nowMillis - this.curlEnteredMillis > this.curlTimeoutMs) {
      this.state = CurlState.Extended;
      this.smoothedRelativeHeight = null;
      print('[FitLens:Curl] Curl state timed out (hand likely left the tracking volume at the top) — reset, no rep.');
    }

    // Head marker updates regardless of hand-tracking state — it's just "where the
    // head anchor currently is," useful as a fixed reference point for comparison.
    const headY = this.headAnchor.getTransform().getWorldPosition().y;
    if (this.headDebugMarker) {
      this.headDebugMarker.enabled = true;
      this.headDebugMarker.getTransform().setWorldPosition(this.headAnchor.getTransform().getWorldPosition());
    }
    if (this.headDebugText) {
      this.headDebugText.text = `head y=${headY.toFixed(2)}`;
    }

    if (!handState.isTracked) {
      const goneMs = nowMillis - this.lastTrackedMillis;
      if (this.wasTracked && goneMs < this.trackingGraceMs) {
        return; // brief mid-rep dropout — hold state, don't reset or re-settle
      }
      if (this.wasTracked) {
        print(`[FitLens:Curl] "${this.hand}" hand lost tracking (gone ${goneMs.toFixed(0)}ms).`);
      }
      this.wasTracked = false;
      this.smoothedRelativeHeight = null; // don't carry a stale smoothed value into the next acquisition
      if (this.handDebugMarker) this.handDebugMarker.enabled = false;
      return;
    }
    if (!this.wasTracked) {
      print(`[FitLens:Curl] "${this.hand}" hand acquired tracking — settling for ${this.trackingSettleMs}ms.`);
      this.trackingAcquiredMillis = nowMillis;
    }
    this.wasTracked = true;
    this.lastTrackedMillis = nowMillis;

    // Index tip, not palm — see the class doc. This is the height signal the
    // curl state machine runs on.
    const wristPos = handState.indexTipPosition;
    const rawRelativeHeight = wristPos.y - headY;

    // Marker follows the raw tracked position immediately, even during the
    // settle window — seeing it (even if jumpy at first) is the whole point
    // of a visual debug aid; only the state-machine logic below waits.
    if (this.handDebugMarker) {
      this.handDebugMarker.enabled = true;
      this.handDebugMarker.getTransform().setWorldPosition(wristPos);
    }
    if (this.handDebugText) {
      this.handDebugText.text = `hand y=${wristPos.y.toFixed(1)}  d=${rawRelativeHeight.toFixed(1)}`;
    }

    if (nowMillis - this.trackingAcquiredMillis < this.trackingSettleMs) {
      return; // first reading(s) after acquisition are frequently a stale/garbage position
    }

    this.smoothedRelativeHeight =
      this.smoothedRelativeHeight === null
        ? rawRelativeHeight
        : this.smoothedRelativeHeight * (1 - this.heightSmoothing) + rawRelativeHeight * this.heightSmoothing;
    const relativeHeight = this.smoothedRelativeHeight;

    if (this.handDebugText) {
      this.handDebugText.text = `hand y=${wristPos.y.toFixed(1)}  d=${relativeHeight.toFixed(1)}  ${CurlState[this.state]}`;
    }

    if (this.diagnosticIntervalMs > 0 && nowMillis - this.lastDiagnosticMillis > this.diagnosticIntervalMs) {
      this.lastDiagnosticMillis = nowMillis;
      print(
        `[FitLens:Curl] relativeHeight=${relativeHeight.toFixed(3)} (raw=${rawRelativeHeight.toFixed(3)}) state=${CurlState[this.state]} ` +
          `curledAt>${this.curledHeightThreshold} extendedAt<${this.extendedHeightThreshold}`
      );
    }

    if (this.state === CurlState.Extended && relativeHeight > this.curledHeightThreshold) {
      this.state = CurlState.Curled;
      this.curlEnteredMillis = nowMillis;
      WorkoutEvents.onCurlUp.invoke({ weightKg: this.curlWeightKg, timestampMillis: nowMillis });
      print(`[FitLens:Curl] Curled (relativeHeight=${relativeHeight.toFixed(3)}) — jump signal fired.`);
    } else if (this.state === CurlState.Curled && relativeHeight < this.extendedHeightThreshold) {
      this.state = CurlState.Extended;
      WorkoutEvents.onCurlRep.invoke({ weightKg: this.curlWeightKg, timestampMillis: nowMillis });
      print(`[FitLens:Curl] Extended (relativeHeight=${relativeHeight.toFixed(3)}) — rep counted.`);
    }
  }
}
