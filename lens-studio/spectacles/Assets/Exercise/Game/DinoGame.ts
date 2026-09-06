import { WorkoutEvents } from '../Core/WorkoutEvents';
import { AppEvents } from '../../App/Core/AppEvents';
import { AppMode, GymExercise } from '../../App/Core/AppTypes';

/**
 * MVP gamification for the curl tracker: Chrome's offline dino-runner game,
 * where the ONLY input is a bicep curl. `WorkoutEvents.onCurlUp` (the
 * instant the wrist reaches "curled" — see BicepCurlTracker.ts, fired
 * before the rep itself is even counted) is the jump trigger, so the
 * up-and-down motion of curling doubles as literal game input.
 *
 * Deliberately minimal for an MVP: one dino sprite, one looping obstacle, a
 * survival score. Sprites are two `Text` components with just a background
 * fill color and no displayed text (same trick `FoodDetection/DetectionBoxDebugView.ts`
 * uses for its bounding-box overlay) instead of separate Image assets — no
 * art pipeline needed for a hackathon build.
 *
 * All positions are normalized [0-1] screen space, origin top-left, same
 * convention as `Core/PerceptionTypes.ts`'s `DetectedObject.boundingBox`.
 */
@component
export class DinoGame extends BaseScriptComponent {
  @input
  dinoText: Text;

  @input
  obstacleText: Text;

  @input
  @allowUndefined
  @hint('Optional — running survival score.')
  scoreText: Text;

  @input
  @allowUndefined
  @hint('Optional — status line. Currently unused (kept so existing scene wiring does not break).')
  statusText: Text;

  @input
  @allowUndefined
  @hint('Optional — the panel/board background SceneObject (a screen-space Text with a fill), shown/hidden with the game so it reads as a framed play area.')
  board: SceneObject;

  @input
  @hint('Normalized [0-1] Y where the dino\'s feet rest (top-left origin).')
  groundY: number = 0.75;

  @input
  spriteHalfWidth: number = 0.03;

  @input
  spriteHalfHeight: number = 0.05;

  @input
  @hint('How high (normalized units) the dino jumps.')
  jumpHeight: number = 0.18;

  @input
  jumpDurationMs: number = 500;

  @input
  @hint('Obstacle scroll speed, normalized units/sec.')
  obstacleSpeed: number = 0.35;

  private dinoTransform: ScreenTransform;
  private obstacleTransform: ScreenTransform;

  private readonly dinoX = 0.15;
  private obstacleX = 1.1;

  private isJumping = false;
  private jumpStartMillis = 0;
  private score = 0;
  private isActive = false;

  onAwake(): void {
    this.dinoTransform = this.dinoText.getSceneObject().getComponent('Component.ScreenTransform');
    this.obstacleTransform = this.obstacleText.getSceneObject().getComponent('Component.ScreenTransform');

    WorkoutEvents.onCurlUp.add(() => this.onCurl());
    AppEvents.onGymExerciseChanged.add((exercise) => this.setActive(exercise === GymExercise.Curls));
    AppEvents.onModeChanged.add((mode) => {
      if (mode !== AppMode.Gym) this.setActive(false); // leaving Gym always tears the game down
    });
    this.createEvent('UpdateEvent').bind(() => this.onUpdate());

    this.resetRound();
    this.setActive(false);
  }

  /** Only Curls should drive (or even show) this game — gated by AppModeManager's picker via AppEvents. */
  private setActive(active: boolean): void {
    this.isActive = active;
    this.dinoText.getSceneObject().enabled = active;
    this.obstacleText.getSceneObject().enabled = active;
    if (this.board) this.board.enabled = active;
    if (this.scoreText) this.scoreText.getSceneObject().enabled = active;
    if (this.statusText) this.statusText.getSceneObject().enabled = false;
    if (active) this.resetRound();
  }

  private onCurl(): void {
    if (!this.isActive) return;
    this.jump();
  }

  private jump(): void {
    if (this.isJumping) return;
    this.isJumping = true;
    this.jumpStartMillis = getTime() * 1000;
    print('[FitLens:DinoGame] Jump.');
  }

  private resetRound(): void {
    this.score = 0;
    this.obstacleX = 1.1;
    if (this.statusText) this.statusText.getSceneObject().enabled = false;
    if (this.scoreText) this.scoreText.text = 'Score: 0';
  }

  private onUpdate(): void {
    if (!this.isActive) return;
    const dt = Math.max(getDeltaTime(), 1 / 240);

    // A simple symmetric up-then-down tween — no physics engine needed for MVP.
    let dinoY = this.groundY;
    if (this.isJumping) {
      const elapsed = getTime() * 1000 - this.jumpStartMillis;
      const t = Math.min(elapsed / this.jumpDurationMs, 1);
      const arc = Math.sin(t * Math.PI); // 0 -> 1 -> 0
      dinoY = this.groundY - arc * this.jumpHeight;
      if (t >= 1) this.isJumping = false;
    }

    this.obstacleX -= this.obstacleSpeed * dt;
    if (this.obstacleX < -this.spriteHalfWidth) {
      this.obstacleX = 1.1;
      this.score += 1;
      if (this.scoreText) this.scoreText.text = `Score: ${this.score}`;
    }

    // No collision / no game-over: a curl always just makes the dino hop, and the
    // obstacle loops forever. The game-over + "curl to restart" flow was removed
    // since the dino sprites aren't visible on this device anyway.

    this.applySprite(this.dinoTransform, this.dinoX, dinoY);
    this.applySprite(this.obstacleTransform, this.obstacleX, this.groundY);
  }

  /** Normalized [0-1] top-left-origin center -> ScreenTransform anchors [-1,1], origin center, y-up. */
  private applySprite(transform: ScreenTransform, centerXNorm: number, centerYNorm: number): void {
    const anchors = transform.anchors;
    anchors.left = (centerXNorm - this.spriteHalfWidth) * 2 - 1;
    anchors.right = (centerXNorm + this.spriteHalfWidth) * 2 - 1;
    anchors.top = 1 - (centerYNorm - this.spriteHalfHeight) * 2;
    anchors.bottom = 1 - (centerYNorm + this.spriteHalfHeight) * 2;
    transform.anchors = anchors;
  }
}
