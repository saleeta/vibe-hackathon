import { DetectedObject, HandState } from '../Core/PerceptionTypes';

/**
 * A2 — hand/object intersection helpers.
 *
 * Pure functions, no scene dependency, so both A3 (food-in-hand) and any
 * debug HUD can reuse them.
 *
 * Two strategies are supported:
 *  1. World-space distance, when the detector/backend can supply a 3D
 *     `worldPosition` for the object (e.g. via depth or a world-query hit
 *     test).
 *  2. Screen-space overlap fallback, projecting the hand's index tip into
 *     screen space and checking it against the object's 2D bounding box —
 *     works with a plain 2D object detector and no depth data, which is
 *     the more likely MVP case.
 */

const WORLD_PROXIMITY_UNITS = 8; // ~8cm in a cm-scaled scene

export function isHandNearObjectWorldSpace(hand: HandState, obj: DetectedObject): boolean {
  if (!hand.isTracked || !obj.worldPosition) return false;
  return hand.indexTipPosition.distance(obj.worldPosition) <= WORLD_PROXIMITY_UNITS;
}

export function isHandNearObjectScreenSpace(
  hand: HandState,
  obj: DetectedObject,
  camera: Camera,
  screenTransform: ScreenTransform,
  marginNormalized: number = 0.03
): boolean {
  if (!hand.isTracked) return false;

  const screenPos = camera.worldSpaceToScreenSpace(hand.indexTipPosition);
  const box = obj.boundingBox;

  return (
    screenPos.x >= box.x - marginNormalized &&
    screenPos.x <= box.x + box.width + marginNormalized &&
    screenPos.y >= box.y - marginNormalized &&
    screenPos.y <= box.y + box.height + marginNormalized
  );
}

/** Picks the closest matching food-class object to a hand, or null. Tries world-space first, falls back to screen-space if a camera is supplied. */
export function findNearestFoodObject(
  hand: HandState,
  objects: DetectedObject[],
  camera?: Camera,
  screenTransform?: ScreenTransform
): DetectedObject | null {
  const foodObjects = objects.filter((o) => o.isFoodClass);
  if (foodObjects.length === 0 || !hand.isTracked) return null;

  const withWorldPos = foodObjects.filter((o) => !!o.worldPosition);
  if (withWorldPos.length > 0) {
    let best: DetectedObject | null = null;
    let bestDist = Infinity;
    for (const obj of withWorldPos) {
      const d = hand.indexTipPosition.distance(obj.worldPosition as vec3);
      if (d < bestDist && d <= WORLD_PROXIMITY_UNITS) {
        best = obj;
        bestDist = d;
      }
    }
    if (best) return best;
  }

  if (camera && screenTransform) {
    const nearby = foodObjects.filter((o) => isHandNearObjectScreenSpace(hand, o, camera, screenTransform));
    if (nearby.length > 0) {
      return nearby.reduce((a, b) => (a.confidence >= b.confidence ? a : b));
    }
  }

  return null;
}
