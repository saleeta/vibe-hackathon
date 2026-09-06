import { WorkoutEvents } from '../Core/WorkoutEvents';

/**
 * Egocentric step counter — attach directly to the Camera scene object.
 * Spectacles' outward-facing cameras can't see the wearer's legs, so a real
 * gait/body-tracking step count isn't possible; instead this approximates
 * "a step happened" from the head's own rhythmic vertical bob while
 * walking, tracked via the camera's local Y velocity.
 *
 * Two gates keep sitting-still head jitter from registering as steps: a
 * smoothed velocity (raw frame-to-frame velocity is noisy) has to cross
 * `dipVelocityThreshold`, AND the actual peak-to-trough position swing of
 * that dip has to clear `minBobAmplitudeCm` — a real walking head-bob moves
 * several centimeters; sitting-still sensor noise/breathing does not.
 *
 * UNITS: this scene's world/tracking units are centimetres (a captured
 * squat drops the head ~45 cm; standing-still noise is < 1 cm; a walking
 * step swings the head 7-11 cm at 14-22 cm/s). All defaults below are in
 * cm / cm-per-second — do NOT read them as metres.
 */
@component
export class StepCounter extends BaseScriptComponent {
  @input
  @hint('Downward local-Y velocity (cm/sec, smoothed) that counts as the dip of a step\'s head bob. Lowered to 3 after 6 barely registered gentle/in-place walking; standing-still noise is still well under this.')
  dipVelocityThreshold: number = 3;

  @input
  @hint('Smoothing factor for the velocity estimate, 0-1. Higher = more responsive, noisier — same convention as Hands/HandTracker.ts.')
  velocitySmoothing: number = 0.4;

  @input
  @hint('Minimum peak-to-trough vertical movement (cm) during a dip to count as a real step, not sensor noise. Standing-still noise is < 1 cm; lowered to 1.5 after 3 missed gentle walking.')
  minBobAmplitudeCm: number = 1.5;

  @input
  @hint('Minimum time between two counted steps, ms — the same "one event, one count" debounce EatingTrigger uses for eating sessions.')
  debounceMs: number = 300;

  @input
  @hint('Delay after onAwake before reacting, ms — device tracking can report unstable/jumpy positions for the first moment after start, same rationale as SquatTracker.calibrationDelayMs.')
  startupSettleMs: number = 800;

  @input
  @hint('Instantaneous velocity above this (cm/sec) is treated as a tracking glitch/relocalization jump, not real head motion, and ignored. Real walking head motion stays under ~30 cm/s; a relocalization jump is metres = hundreds of cm.')
  maxPlausibleVelocity: number = 150;

  @input
  @hint('How often (ms) to print a diagnostic line with the live velocity/position while tuning. 0 disables.')
  diagnosticIntervalMs: number = 1000;

  private prevY = 0;
  private smoothedVelocity = 0;
  private wasDipping = false;
  private dipStartY = 0;
  private lastStepMillis = 0;
  private lastDiagnosticMillis = 0;
  private awakeMillis = 0;

  onAwake(): void {
    this.prevY = this.getSceneObject().getTransform().getLocalPosition().y;
    this.dipStartY = this.prevY;
    this.awakeMillis = getTime() * 1000;
    this.createEvent('UpdateEvent').bind(() => this.onUpdate());

    // World tracking can reset/relocalize (tap-to-reset, or recovering from a
    // lost-tracking state) and jump the reported position discontinuously —
    // treat that exactly like a fresh start rather than reading the jump as
    // real motion.
    this.createEvent('WorldTrackingResetEvent').bind(() => {
      print('[FitLens:Step] World tracking reset — resettling.');
      this.prevY = this.getSceneObject().getTransform().getLocalPosition().y;
      this.dipStartY = this.prevY;
      this.smoothedVelocity = 0;
      this.wasDipping = false;
      this.awakeMillis = getTime() * 1000;
    });
  }

  private onUpdate(): void {
    const dt = Math.max(getDeltaTime(), 1 / 240);
    const y = this.getSceneObject().getTransform().getLocalPosition().y;
    const instantVelocity = (y - this.prevY) / dt;
    this.prevY = y;
    const nowMillis = getTime() * 1000;

    if (nowMillis - this.awakeMillis < this.startupSettleMs) {
      return; // device tracking hasn't settled yet — don't trust early readings
    }
    if (Math.abs(instantVelocity) > this.maxPlausibleVelocity) {
      print(`[FitLens:Step] Ignoring implausible velocity spike (${instantVelocity.toFixed(2)}) — likely a tracking glitch.`);
      return; // a single-frame teleport, not real motion — don't let it feed the smoothed velocity or dip state
    }
    this.smoothedVelocity = this.smoothedVelocity * (1 - this.velocitySmoothing) + instantVelocity * this.velocitySmoothing;

    const isDipping = this.smoothedVelocity < -this.dipVelocityThreshold;

    if (isDipping && !this.wasDipping) {
      this.dipStartY = y; // mark the top of the dip so we can measure its amplitude
    }

    if (this.wasDipping && !isDipping) {
      const amplitude = Math.abs(this.dipStartY - y);
      if (amplitude >= this.minBobAmplitudeCm && nowMillis - this.lastStepMillis > this.debounceMs) {
        this.lastStepMillis = nowMillis;
        WorkoutEvents.onStep.invoke({ timestampMillis: nowMillis });
        print(`[FitLens:Step] Step counted (amplitude=${amplitude.toFixed(3)}).`);
      } else {
        print(`[FitLens:Step] Dip rejected — amplitude=${amplitude.toFixed(3)} (need >= ${this.minBobAmplitudeCm}), sinceLast=${(nowMillis - this.lastStepMillis).toFixed(0)}ms.`);
      }
    }
    this.wasDipping = isDipping;

    if (this.diagnosticIntervalMs > 0 && nowMillis - this.lastDiagnosticMillis > this.diagnosticIntervalMs) {
      this.lastDiagnosticMillis = nowMillis;
      print(`[FitLens:Step] y=${y.toFixed(3)} velocity=${this.smoothedVelocity.toFixed(3)} (threshold=${this.dipVelocityThreshold}) dipping=${isDipping}`);
    }
  }
}
