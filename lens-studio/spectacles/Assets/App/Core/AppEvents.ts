import { Signal } from '../../Core/Signal';
import { AppMode, GymExercise } from './AppTypes';

/**
 * Top-level navigation signal bus — same plug-and-play convention as
 * `Core/PerceptionEvents.ts` and `Exercise/Core/WorkoutEvents.ts`. Any
 * button fires `onButtonPressed` with its own id string; `AppModeManager`
 * is the only thing that interprets those ids, so buttons themselves stay
 * generic and don't need to know what they do.
 */
class AppEventBus {
  readonly onButtonPressed = new Signal<string>();
  readonly onModeChanged = new Signal<AppMode>();
  readonly onGymExerciseChanged = new Signal<GymExercise>();
}

export const AppEvents = new AppEventBus();
