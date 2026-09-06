import { WorkoutEvents } from '../Core/WorkoutEvents';
import { SquatState } from '../Core/WorkoutTypes';
import { AppEvents } from '../../App/Core/AppEvents';
import { GymExercise } from '../../App/Core/AppTypes';

/**
 * Squat tracker — attach directly to the Camera scene object. Tracks the
 * camera's absolute world Y against a calibrated standing baseline: a dip
 * past `dipThresholdCm` below baseline enters `Squatting`, and returning to
 * within `returnMarginCm` of baseline counts the rep and resets to
 * `Standing`.
 *
 * UNITS: this scene's world/tracking units are centimetres. Captured
 * reference values: standing-still noise < 1 cm; a walking head-bob dips
 * ~7 cm; a real squat drops the head 40-47 cm and returns to standing in
 * 1.1-1.3 s.
 *
 * SIT vs SQUAT: sitting in a chair drops the head to the *same* depth as a
 * squat (~40-45 cm), so depth alone can't tell them apart — but a squat
 * returns within ~1.3 s while a sit stays down for many seconds. So if the
 * dip is held longer than `maxSquatMs`, it's treated as "sat down": no rep
 * is counted, and the baseline is re-sampled on the way back up (the old
 * baseline was for standing, not for the chair).
 *
 * The baseline is sampled once, `calibrationDelayMs` after this component
 * wakes — call `recalibrate()` again any time the posture reference needs
 * resetting (e.g. a "start squats" menu action).
 */
@component
export class SquatTracker extends BaseScriptComponent {
  @input
  @hint('How far below the standing baseline (cm) counts as a squat. Walking only dips ~7 cm; a real squat is 40+ cm. 18 leaves margin for an imperfect baseline.')
  dipThresholdCm: number = 18;

  @input
  @hint('Once dipped, must rise back within this many cm of the baseline to count as "returned to standing". 12 tolerates a few cm of baseline drift.')
  returnMarginCm: number = 12;

  @input
  @hint('Only if the dip is held longer than this (ms) is it treated as a sit (no rep, re-sample baseline on standing up). Set generously — even a slow controlled squat rep is well under 9 s; a sit is 10 s+.')
  maxSquatMs: number = 9000;

  @input
  @hint('Delay after onAwake before sampling the standing baseline height, ms.')
  calibrationDelayMs: number = 1500;

  @input
  @hint('How often (ms) to print a diagnostic line with the live baseline / height / dip / state while tuning. 0 disables.')
  diagnosticIntervalMs: number = 1000;

  private baselineY: number | null = null;
  private state: SquatState = SquatState.Standing;
  private squatEnteredMs = 0;
  private lastDiagnosticMs = 0;
  /** Set once a Squatting dip outlasts maxSquatMs: it's a sit, so don't count the rep on return. */
  private sittingOut = false;

  onAwake(): void {
    const calibrate = this.createEvent('DelayedCallbackEvent');
    calibrate.bind(() => this.recalibrate());
    calibrate.reset(this.calibrationDelayMs / 1000);

    this.createEvent('UpdateEvent').bind(() => this.onUpdate());

    // A world-tracking reset/relocalization jumps the reported position
    // discontinuously — the old baseline is meaningless against the new
    // coordinate frame, so recalibrate immediately rather than reading the
    // jump as a giant (fake) dip.
    this.createEvent('WorldTrackingResetEvent').bind(() => {
      print('[FitLens:Squat] World tracking reset — recalibrating baseline.');
      this.state = SquatState.Standing;
      this.sittingOut = false;
      this.recalibrate();
    });

    // Selecting "Squats" in the Gym picker is the moment the wearer is actually
    // standing ready — re-sample the baseline then, so a stale launch-time
    // calibration (they were still putting the headset on / walking to a spot)
    // can't make every squat read as too shallow to count.
    AppEvents.onGymExerciseChanged.add((exercise) => {
      if (exercise === GymExercise.Squats) {
        this.state = SquatState.Standing;
        this.sittingOut = false;
        this.recalibrate();
        print('[FitLens:Squat] Squats selected — baseline re-sampled.');
      }
    });
  }

  /** Re-samples the standing baseline from the camera's current world height. */
  recalibrate(): void {
    this.baselineY = this.getSceneObject().getTransform().getWorldPosition().y;
    print(`[FitLens:Squat] Baseline standing height calibrated: ${this.baselineY.toFixed(1)} cm`);
  }

  private onUpdate(): void {
    if (this.baselineY === null) return;

    const y = this.getSceneObject().getTransform().getWorldPosition().y;
    const dip = this.baselineY - y;
    const nowMs = getTime() * 1000;

    if (this.diagnosticIntervalMs > 0 && nowMs - this.lastDiagnosticMs > this.diagnosticIntervalMs) {
      this.lastDiagnosticMs = nowMs;
      print(
        `[FitLens:Squat] baseline=${this.baselineY.toFixed(1)} y=${y.toFixed(1)} dip=${dip.toFixed(1)} ` +
          `(enter>${this.dipThresholdCm} exit<${this.returnMarginCm}) state=${SquatState[this.state]}`
      );
    }

    if (this.state === SquatState.Standing) {
      if (dip > this.dipThresholdCm) {
        this.state = SquatState.Squatting;
        this.squatEnteredMs = nowMs;
        this.sittingOut = false;
        print(`[FitLens:Squat] Dip detected (${dip.toFixed(1)} cm) — squatting.`);
      }
      return;
    }

    // state === Squatting
    if (!this.sittingOut && nowMs - this.squatEnteredMs > this.maxSquatMs) {
      this.sittingOut = true;
      print(`[FitLens:Squat] Dip held ${((nowMs - this.squatEnteredMs) / 1000).toFixed(1)}s — treating as a sit, will not count.`);
    }

    if (dip < this.returnMarginCm) {
      this.state = SquatState.Standing;
      if (this.sittingOut) {
        print('[FitLens:Squat] Stood up from a sit — recalibrating baseline, no rep counted.');
        this.recalibrate();
      } else {
        WorkoutEvents.onSquat.invoke({ timestampMillis: nowMs });
        print('[FitLens:Squat] Returned to standing — squat counted.');
      }
    }
  }
}
