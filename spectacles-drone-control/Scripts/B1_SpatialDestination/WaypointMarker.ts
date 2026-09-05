/**
 * B1 — a single fixed waypoint the wearer can pinch to send the drone to.
 *
 * Deliberately NOT computed from live spatial-anchor placement. Each
 * marker carries a pre-baked (x, y, z) offset in centimeters, sent
 * straight to Tello's `go` command relative to wherever the drone took
 * off. That trades "point anywhere in the room" for a small, reliable set
 * of pre-calibrated destinations — much better suited to a live demo than
 * runtime anchor math (see the module README for the tradeoff, and for
 * why the earlier anchor-based design was replaced with this one).
 *
 * Axis convention per Tello's own published SDK 2.0 documentation, not
 * yet verified against a real unit: x = forward(+)/back(-),
 * y = left(+)/right(-), z = up(+)/down(-), all in centimeters.
 */
@component
export class WaypointMarker extends BaseScriptComponent {
  @input
  @hint('Shown on the marker\'s glass tile, e.g. "FORWARD".')
  label: string = 'WAYPOINT';

  @input
  @hint('Forward(+)/back(-) offset from takeoff, in cm.')
  offsetX: number = 0;

  @input
  @hint('Left(+)/right(-) offset from takeoff, in cm.')
  offsetY: number = 0;

  @input
  @hint('Up(+)/down(-) offset from takeoff, in cm.')
  offsetZ: number = 0;

  @input
  @hint('Tello flight speed for this waypoint, cm/s (Tello range: 10-100).')
  speedCmPerSec: number = 40;

  @input
  markerText: Text;

  private baseFillColor: vec4;

  onAwake(): void {
    this.applyGlassStyle();
    this.markerText.text = this.label;
  }

  getOffsetCm(): vec3 {
    return new vec3(this.offsetX, this.offsetY, this.offsetZ);
  }

  getSpeedCmPerSec(): number {
    return this.speedCmPerSec;
  }

  getWorldPosition(): vec3 {
    return this.getTransform().getWorldPosition();
  }

  /** Brief highlight so the wearer sees which marker was picked. */
  flashSelected(): void {
    const bg = this.markerText.backgroundSettings;
    bg.fill.color = new vec4(0.42, 0.88, 0.62, 0.55);
    const delay = this.createEvent('DelayedCallbackEvent');
    delay.bind(() => {
      bg.fill.color = this.baseFillColor;
    });
    delay.reset(0.4);
  }

  private applyGlassStyle(): void {
    const text = this.markerText;
    text.size = 36;
    text.horizontalOverflow = HorizontalOverflow.Overflow;
    text.verticalOverflow = VerticalOverflow.Overflow;
    text.textFill.color = new vec4(0.93, 0.96, 1.0, 1);

    const bg = text.backgroundSettings;
    bg.enabled = true;
    bg.cornerRadius = 18;
    bg.fill.color = new vec4(0.62, 0.72, 0.85, 0.22);
    bg.margins = Rect.create(28, 28, 14, 14);
    this.baseFillColor = bg.fill.color;

    const shadow = text.dropshadowSettings;
    shadow.enabled = true;
    shadow.fill.color = new vec4(0, 0, 0, 0.45);
    shadow.offset = new vec2(0, -2);
  }
}
