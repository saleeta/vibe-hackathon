import { PerceptionEvents } from '../Core/PerceptionEvents';
import { DetectedObject } from '../Core/PerceptionTypes';

/**
 * Debug-only visual: highlights the highest-confidence detection from
 * whatever IObjectDetector is plugged in (a semi-transparent box + a
 * "label NN%" line), so you can see on-screen that food detection is
 * actually firing before trusting the rest of the pipeline. Not part of
 * the functional pipeline — safe to disable/remove once detection is
 * confirmed working.
 *
 * Box placement is approximate, not pixel-precise: `DetectedObject.boundingBox`
 * is left in the detector model's own normalized input-space coordinates
 * (see OnDeviceObjectDetector.ts's decode() comment) rather than remapped
 * through the camera's actual aspect ratio, so the highlighted region will
 * drift somewhat from the real on-screen food position on a non-square
 * camera frame — good enough to confirm detection is firing.
 */
@component
export class DetectionBoxDebugView extends BaseScriptComponent {
  @input
  @hint('A Text component with backgroundSettings enabled — its fill acts as the "box", its text as the label.')
  boxText: Text;

  @input
  @hint('Hide the box if no new detection arrives within this many ms, so a stale box does not linger once food leaves view.')
  hideAfterMs: number = 600;

  private boxTransform: ScreenTransform;
  private hideCallback: DelayedCallbackEvent | null = null;

  onAwake(): void {
    this.boxTransform = this.boxText.getSceneObject().getComponent('Component.ScreenTransform');
    this.boxText.getSceneObject().enabled = false;
    PerceptionEvents.onObjectsDetected.add((objects) => this.show(objects));
  }

  private show(objects: DetectedObject[]): void {
    if (objects.length === 0) return;
    const best = objects.reduce((a, b) => (a.confidence >= b.confidence ? a : b));

    // DetectedObject.boundingBox is normalized [0-1], origin top-left.
    // ScreenTransform anchors are [-1,1], origin center, y-up — convert.
    const anchors = this.boxTransform.anchors;
    anchors.left = best.boundingBox.x * 2 - 1;
    anchors.right = (best.boundingBox.x + best.boundingBox.width) * 2 - 1;
    anchors.top = 1 - best.boundingBox.y * 2;
    anchors.bottom = 1 - (best.boundingBox.y + best.boundingBox.height) * 2;
    this.boxTransform.anchors = anchors;

    this.boxText.text = `${best.label} ${Math.round(best.confidence * 100)}%`;
    this.boxText.getSceneObject().enabled = true;

    if (this.hideCallback) this.hideCallback.enabled = false;
    this.hideCallback = this.createEvent('DelayedCallbackEvent');
    this.hideCallback.bind(() => {
      this.boxText.getSceneObject().enabled = false;
    });
    this.hideCallback.reset(this.hideAfterMs / 1000);
  }
}
