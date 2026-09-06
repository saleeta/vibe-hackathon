import { WorkoutEvents } from '../Core/WorkoutEvents';
import { WorkoutSummary } from '../Core/WorkoutTypes';
import { AppEvents } from '../../App/Core/AppEvents';
import { AppMode, GymExercise } from '../../App/Core/AppTypes';

/**
 * The always-on sports mini-card: a small two-line panel (kept parked in a
 * screen corner by its ScreenTransform) that shows live stats for whichever
 * single exercise `AppModeManager`'s picker currently has selected
 * (`AppEvents.onGymExerciseChanged`) — never all three at once. Updates
 * instantly on every `onWorkoutUpdated`, no polling. Same "any optional slot
 * left unset is just not shown" convention as `UI/NutritionHUD.ts`.
 *
 *   Steps   → "Steps: 128"   / "~53 m · ~4 kcal"
 *   Squats  → "Squats: 12"   / "~4 kcal"
 *   Curls   → "Curls: 9 · 5kg" / "~1 kcal"
 *
 * The whole card (background + both lines) is hidden while no exercise is
 * picked (`GymExercise.None`).
 */
@component
export class WorkoutHUD extends BaseScriptComponent {
  @input
  @hint('Top line — the rep/step count, e.g. "Squats: 12".')
  headlineText: Text;

  @input
  @hint('Second line — the derived metric(s) for the picked exercise, e.g. "~53 m · ~4 kcal".')
  detailText: Text;

  @input
  @allowUndefined
  @hint('Optional — the card background: a Text with Background enabled and empty text, sized to sit behind both lines. Hidden with the text when no exercise is picked.')
  background: Text;

  private latestSummary: WorkoutSummary | null = null;
  private visibleExercise: GymExercise = GymExercise.None;
  private inGym = false;

  onAwake(): void {
    WorkoutEvents.onWorkoutUpdated.add((summary) => {
      this.latestSummary = summary;
      this.render();
    });
    AppEvents.onGymExerciseChanged.add((exercise) => {
      this.visibleExercise = exercise;
      this.render();
    });
    // Belt-and-braces: leaving Gym mode at all hides the card, even if the
    // exercise-changed event is somehow missed.
    AppEvents.onModeChanged.add((mode) => {
      this.inGym = mode === AppMode.Gym;
      if (!this.inGym) this.visibleExercise = GymExercise.None;
      this.render();
    });
    this.render();
  }

  private render(): void {
    const show = this.inGym && this.visibleExercise !== GymExercise.None;
    this.headlineText.getSceneObject().enabled = show;
    this.detailText.getSceneObject().enabled = show;
    if (this.background) this.background.getSceneObject().enabled = show;
    if (!show) return;

    const s = this.latestSummary;
    if (!s) {
      this.headlineText.text = this.headlineFor(this.visibleExercise, 0, 0);
      this.detailText.text = '';
      return;
    }

    switch (this.visibleExercise) {
      case GymExercise.Steps:
        this.headlineText.text = `Steps: ${s.steps}`;
        this.detailText.text = `~${Math.round(s.distanceM)} m  ·  ~${Math.round(s.stepKcal)} kcal`;
        break;
      case GymExercise.Squats:
        this.headlineText.text = `Squats: ${s.squats}`;
        this.detailText.text = `~${Math.round(s.squatKcal)} kcal`;
        break;
      case GymExercise.Curls:
        this.headlineText.text = `Curls: ${s.curls}  ·  ${s.curlWeightKg}kg`;
        this.detailText.text = `~${Math.round(s.curlKcal)} kcal`;
        break;
    }
  }

  private headlineFor(exercise: GymExercise, count: number, _weight: number): string {
    switch (exercise) {
      case GymExercise.Steps:
        return `Steps: ${count}`;
      case GymExercise.Squats:
        return `Squats: ${count}`;
      case GymExercise.Curls:
        return `Curls: ${count}`;
      default:
        return '';
    }
  }
}
