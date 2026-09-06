/** Top-level navigation state — which pipeline's UI is currently on screen. */
export enum AppMode {
  Landing = 0,
  Food = 1,
  Gym = 2,
}

/** Within Gym mode, which single exercise's tracker/HUD is currently visible. None = the picker hasn't been used yet. */
export enum GymExercise {
  None = 0,
  Steps = 1,
  Squats = 2,
  Curls = 3,
}
