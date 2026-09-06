import { AppEvents } from './Core/AppEvents';
import { AppMode, GymExercise } from './Core/AppTypes';

/**
 * Top-level navigation: gates which UI root is visible so Food and Gym
 * mode are never on screen at once, and so Gym mode only ever shows the
 * single exercise currently picked — not all three trackers' stats
 * stacked up together.
 *
 * Every root here is toggled purely via `.enabled`; none of the underlying
 * pipelines (nutrition detection, workout trackers) are touched, so
 * switching modes never loses calibration or in-progress counts, only
 * visibility. Buttons don't call this directly — they fire
 * `AppEvents.onButtonPressed` with a plain id string (see `ScreenButton.ts`)
 * and this is the only thing that interprets those ids.
 */
@component
export class AppModeManager extends BaseScriptComponent {
  @input
  @hint('Root containing the Food/Gym choice buttons.')
  landingRoot: SceneObject;

  @input
  @hint('Root containing NutritionHUD + DetectionBoxDebugView — the whole food-tracking visual stack.')
  foodUIRoot: SceneObject;

  @input
  @hint('Root containing the Back button + Steps/Squats/Curls picker buttons — visible for the whole Gym session.')
  gymMenuRoot: SceneObject;

  @input
  @hint('Root containing WorkoutHUD + DinoGame. WorkoutHUD/DinoGame further self-filter to only the picked exercise via AppEvents.onGymExerciseChanged.')
  gymUIRoot: SceneObject;

  @input
  @allowUndefined
  @hint('Optional root holding a single shared Back button — shown in every mode except Landing so Health mode has a way out too.')
  navBackRoot: SceneObject;

  private mode: AppMode = AppMode.Landing;
  private exercise: GymExercise = GymExercise.None;

  onAwake(): void {
    AppEvents.onButtonPressed.add((id) => this.onButtonPressed(id));
    this.applyMode();
  }

  private onButtonPressed(id: string): void {
    switch (id) {
      case 'mode:food':
        this.setMode(AppMode.Food);
        break;
      case 'mode:gym':
        this.setMode(AppMode.Gym);
        break;
      case 'nav:back':
        this.setMode(AppMode.Landing);
        break;
      case 'exercise:steps':
        this.setExercise(GymExercise.Steps);
        break;
      case 'exercise:squats':
        this.setExercise(GymExercise.Squats);
        break;
      case 'exercise:curls':
        this.setExercise(GymExercise.Curls);
        break;
      default:
        print(`[FitLens:App] Unrecognized button id "${id}".`);
    }
  }

  private setMode(mode: AppMode): void {
    this.mode = mode;
    if (mode !== AppMode.Gym) this.exercise = GymExercise.None;
    print(`[FitLens:App] Mode -> ${AppMode[mode]}.`);
    this.applyMode();
    AppEvents.onModeChanged.invoke(mode);
    AppEvents.onGymExerciseChanged.invoke(this.exercise);
  }

  private setExercise(exercise: GymExercise): void {
    this.exercise = exercise;
    print(`[FitLens:App] Exercise -> ${GymExercise[exercise]}.`);
    AppEvents.onGymExerciseChanged.invoke(exercise);
  }

  private applyMode(): void {
    this.landingRoot.enabled = this.mode === AppMode.Landing;
    this.foodUIRoot.enabled = this.mode === AppMode.Food;
    this.gymMenuRoot.enabled = this.mode === AppMode.Gym;
    this.gymUIRoot.enabled = this.mode === AppMode.Gym;
    if (this.navBackRoot) this.navBackRoot.enabled = this.mode !== AppMode.Landing;
  }
}
