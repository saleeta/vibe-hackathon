import { Signal } from '../../Core/Signal';
import { RepPayload, CurlRepPayload, WorkoutSummary } from './WorkoutTypes';

/**
 * The plug-and-play surface of the exercise-tracking module — same
 * convention as the nutrition pipeline's `Core/PerceptionEvents.ts`: every
 * tracker only talks to its neighbors through these signals, never by
 * holding direct references, so a tracker can be added/removed/swapped
 * without touching WorkoutManager or the HUD.
 *
 * `onCurlUp` vs `onCurlRep` are deliberately separate signals with
 * different jobs: `onCurlUp` fires the instant the wrist reaches "curled"
 * and exists purely as a fast, low-latency input signal (the dino-jump game
 * reacts to this); `onCurlRep` only fires once the arm has returned to
 * "extended", completing a full cycle, and is what actually increments the
 * rep counter. A jump should feel instant; a counted rep should require a
 * real full curl.
 */
class WorkoutEventBus {
  readonly onStep = new Signal<RepPayload>();
  readonly onSquat = new Signal<RepPayload>();
  readonly onCurlUp = new Signal<CurlRepPayload>();
  readonly onCurlRep = new Signal<CurlRepPayload>();
  readonly onWorkoutUpdated = new Signal<WorkoutSummary>();
}

export const WorkoutEvents = new WorkoutEventBus();
