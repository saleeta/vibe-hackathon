import { WorkoutEvents } from './Core/WorkoutEvents';
import { WorkoutSummary } from './Core/WorkoutTypes';
import { appendWorkoutLogEntry } from './WorkoutLog';
import { AppEvents } from '../App/Core/AppEvents';
import { AppMode } from '../App/Core/AppTypes';

/**
 * Central state for the exercise-tracking MVP: step/squat/curl counts plus
 * a rough calorie estimate. Every tracker script (StepCounter, SquatTracker,
 * BicepCurlTracker) only reaches this through `WorkoutEvents` — never a
 * direct reference — same plug-and-play convention as the nutrition
 * pipeline's WorkoutManager-equivalent (`Capture/EatingTrigger.ts`).
 *
 * There's no way for Spectacles to sense actual load, so `curlWeightKg` is
 * a manual @input the wearer sets before a set — used only for the calorie
 * estimate and the "kg lifted" stat, not detected.
 */
@component
export class WorkoutManager extends BaseScriptComponent {
  @input
  @hint("Weight being curled, in kg — set this before a set. Spectacles can't sense actual load, so this is manual.")
  curlWeightKg: number = 5;

  @input
  @hint('Body weight in kg, used for the walking/squat calorie estimate.')
  bodyWeightKg: number = 65;

  @input
  @hint('Height in cm, used to approximate stride length for the walking calorie estimate.')
  heightCm: number = 170;

  private steps = 0;
  private squats = 0;
  private curls = 0;

  onAwake(): void {
    WorkoutEvents.onStep.add(() => this.incrementSteps());
    WorkoutEvents.onSquat.add(() => this.incrementSquats());
    WorkoutEvents.onCurlRep.add((payload) => this.incrementCurls(payload.weightKg));
    // Entering Gym mode starts a fresh session — steps/squats/curls all back to 0
    // every time "Sports Monitoring" is chosen, so a previous visit's counts
    // never carry over into a new one.
    AppEvents.onModeChanged.add((mode) => {
      if (mode === AppMode.Gym) {
        this.resetSession();
        print('[FitLens:Workout] Gym mode entered — counts reset to 0.');
      }
    });
    this.publish();
  }

  incrementSteps(): void {
    this.steps += 1;
    print(`[FitLens:Workout] Step ${this.steps}.`);
    this.publish();
  }

  incrementSquats(): void {
    this.squats += 1;
    print(`[FitLens:Workout] Squat ${this.squats}.`);
    this.publish();
  }

  incrementCurls(weightKg: number): void {
    this.curls += 1;
    this.curlWeightKg = weightKg;
    print(`[FitLens:Workout] Curl ${this.curls} (@ ${weightKg}kg).`);
    this.publish();
  }

  /** Persists the current session totals — wire to a pinch/menu action to end a workout. */
  saveSession(): void {
    appendWorkoutLogEntry({
      steps: this.steps,
      squats: this.squats,
      curls: this.curls,
      curlWeightKg: this.curlWeightKg,
      kcalBurned: this.estimateKcal(),
      timestampMillis: getTime() * 1000,
    });
    print('[FitLens:Workout] Session saved.');
  }

  resetSession(): void {
    this.steps = 0;
    this.squats = 0;
    this.curls = 0;
    this.publish();
  }

  private estimateKcal(): number {
    return this.computeMetrics().kcalBurned;
  }

  /**
   * Rough per-rep/per-step heuristic constants, not a calibrated measurement —
   * same "estimate" framing as the nutrition side's glycemic load (see
   * docs/COMPLIANCE.md). Good enough for an MVP progress number, not a
   * fitness-tracker-grade calorie count.
   *
   * Steps: stride length approximated from height (a standard pedometer-app
   * heuristic, ~0.414 * height for a walking stride), then a common
   * kcal-per-kg-per-km walking approximation — this is why both heightCm and
   * bodyWeightKg matter here, unlike squats/curls which only need weight.
   */
  private computeMetrics(): { distanceM: number; stepKcal: number; squatKcal: number; curlKcal: number; kcalBurned: number } {
    const strideM = (this.heightCm / 100) * 0.414;
    const distanceM = this.steps * strideM;
    const stepKcal = (distanceM / 1000) * this.bodyWeightKg * 0.9;
    const squatKcal = this.squats * (0.005 * this.bodyWeightKg);
    const curlKcal = this.curls * (this.curlWeightKg * 0.01 + 0.1);
    return { distanceM, stepKcal, squatKcal, curlKcal, kcalBurned: stepKcal + squatKcal + curlKcal };
  }

  private publish(): void {
    const m = this.computeMetrics();
    const summary: WorkoutSummary = {
      steps: this.steps,
      squats: this.squats,
      curls: this.curls,
      curlWeightKg: this.curlWeightKg,
      kcalBurned: m.kcalBurned,
      distanceM: m.distanceM,
      stepKcal: m.stepKcal,
      squatKcal: m.squatKcal,
      curlKcal: m.curlKcal,
    };
    WorkoutEvents.onWorkoutUpdated.invoke(summary);
  }
}
