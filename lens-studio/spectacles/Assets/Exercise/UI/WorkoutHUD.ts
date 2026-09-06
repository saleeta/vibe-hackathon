import { WorkoutEvents } from '../Core/WorkoutEvents';
import { WorkoutSummary } from '../Core/WorkoutTypes';
import { AppEvents } from '../../App/Core/AppEvents';
import { GymExercise } from '../../App/Core/AppTypes';

/**
 * Binds WorkoutManager's running totals to Text components on a Screen
 * Transform — updates instantly on every `onWorkoutUpdated` broadcast, no
 * polling. Any optional Text left unset is simply not shown, same
 * convention as `UI/NutritionHUD.ts`.
 *
 * Only shows the row for whichever single exercise `AppModeManager`'s
 * picker currently has selected (`AppEvents.onGymExerciseChanged`) — never
 * all three at once, so Gym mode isn't a wall of stats the wearer didn't
 * ask to see.
 */
@component
export class WorkoutHUD extends BaseScriptComponent {
  @input
  stepsText: Text;

  @input
  squatsText: Text;

  @input
  curlsText: Text;

  @input
  @hint('Optional — rough calorie estimate. See WorkoutManager.estimateKcal for the caveat.')
  caloriesText: Text | null = null;

  private latestSummary: WorkoutSummary | null = null;
  private visibleExercise: GymExercise = GymExercise.None;

  onAwake(): void {
    WorkoutEvents.onWorkoutUpdated.add((summary) => this.render(summary));
    AppEvents.onGymExerciseChanged.add((exercise) => {
      this.visibleExercise = exercise;
      this.applyVisibility();
    });
    this.applyVisibility();
  }

  private render(summary: WorkoutSummary): void {
    this.latestSummary = summary;
    this.stepsText.text = `Steps: ${summary.steps}`;
    this.squatsText.text = `Squats: ${summary.squats}`;
    this.curlsText.text = `Curls: ${summary.curls} · ${summary.curlWeightKg}kg`;
    if (this.caloriesText) {
      this.caloriesText.text = `${Math.round(summary.kcalBurned)} kcal burned`;
    }
  }

  private applyVisibility(): void {
    this.stepsText.getSceneObject().enabled = this.visibleExercise === GymExercise.Steps;
    this.squatsText.getSceneObject().enabled = this.visibleExercise === GymExercise.Squats;
    this.curlsText.getSceneObject().enabled = this.visibleExercise === GymExercise.Curls;
    if (this.caloriesText) {
      this.caloriesText.getSceneObject().enabled = this.visibleExercise !== GymExercise.None && this.latestSummary !== null;
    }
  }
}
