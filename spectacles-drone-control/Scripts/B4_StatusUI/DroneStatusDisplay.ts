import { DroneEvents } from '../Core/DroneEvents';
import { DroneCommand, DroneStatusMessage } from '../Core/DroneTypes';

/**
 * B4 — a small, always-visible status line (not auto-hiding, unlike
 * spectacles-perception's AutoLogDisplay — this is ongoing operational
 * status for as long as a flight is in progress, not a one-off toast).
 * Same clean glass-tile styling as the other two modules for visual
 * consistency across the project.
 */
@component
export class DroneStatusDisplay extends BaseScriptComponent {
  @input
  statusText: Text;

  private lastAction = 'idle';
  private batteryPercent: number | null = null;

  onAwake(): void {
    this.applyGlassStyle();
    this.render();
    DroneEvents.onCommandRequested.add((cmd) => this.onCommand(cmd));
    DroneEvents.onStatusReceived.add((msg) => this.onStatus(msg));
    DroneEvents.onAnchorPlaced.add((e) => {
      this.lastAction = `${e.role} anchor placed`;
      this.render();
    });
  }

  private applyGlassStyle(): void {
    const text = this.statusText;
    text.size = 32;
    text.horizontalOverflow = HorizontalOverflow.Overflow;
    text.verticalOverflow = VerticalOverflow.Overflow;
    text.textFill.color = new vec4(0.93, 0.96, 1.0, 1);

    const bg = text.backgroundSettings;
    bg.enabled = true;
    bg.cornerRadius = 22;
    bg.fill.color = new vec4(0.62, 0.72, 0.85, 0.22);
    bg.margins = Rect.create(32, 32, 16, 16);

    const shadow = text.dropshadowSettings;
    shadow.enabled = true;
    shadow.fill.color = new vec4(0, 0, 0, 0.45);
    shadow.offset = new vec2(0, -2);
  }

  private onCommand(cmd: DroneCommand): void {
    this.lastAction = cmd.type === 'goto' ? this.describeGoto(cmd) : cmd.type;
    this.render();
  }

  /**
   * A clear direction word instead of generic "flying to destination" —
   * matters for a demo whose whole point is showing the drone follow a
   * specific gesture (see PinchDragController/DirectionalHandController,
   * which each only ever set one nonzero axis at a time). Falls back to
   * "flying" for anything with more than one axis set (e.g. a diagonal
   * waypoint or an arbitrary DebugDroneHarness.simulateFlyToDestination()
   * call) rather than guessing a combined label.
   */
  private describeGoto(cmd: DroneCommand): string {
    const x = cmd.x ?? 0;
    const y = cmd.y ?? 0;
    const z = cmd.z ?? 0;
    const nonzeroAxes = [x, y, z].filter((v) => v !== 0).length;
    if (nonzeroAxes !== 1) return 'flying';

    // Tello's go-vector convention (TelloGoVector.ts): x = forward(+)/back(-), y = left(+)/right(-), z = up(+)/down(-).
    if (z > 0) return 'moving up';
    if (z < 0) return 'moving down';
    if (y > 0) return 'moving left';
    if (y < 0) return 'moving right';
    if (x > 0) return 'moving forward';
    return 'moving back';
  }

  private onStatus(msg: DroneStatusMessage): void {
    if (msg.type === 'state' && msg.batteryPercent !== undefined) {
      this.batteryPercent = msg.batteryPercent;
    }
    if (msg.type === 'error') {
      this.lastAction = `error (${msg.raw ?? 'unknown'})`;
    }
    this.render();
  }

  private render(): void {
    const batterySuffix = this.batteryPercent !== null ? ` · ${this.batteryPercent}% battery` : '';
    this.statusText.text = `Drone: ${this.lastAction}${batterySuffix}`;
  }
}
