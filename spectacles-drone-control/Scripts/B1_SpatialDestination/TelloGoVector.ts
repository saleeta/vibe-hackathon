/**
 * Tello's `go x y z speed` command has a real, documented quirk (Tello SDK
 * 2.0): x/y/z are each either exactly 0 or have a magnitude of at least 20
 * (cm) — a nonzero value between -20 and 20 is rejected. This clamps a
 * computed offset into a vector Tello will actually accept, and caps each
 * axis to the SDK's ±500 cm range.
 */
export function clampGoVector(offsetCm: vec3): vec3 {
  return new vec3(clampAxis(offsetCm.x), clampAxis(offsetCm.y), clampAxis(offsetCm.z));
}

function clampAxis(value: number): number {
  const capped = Math.max(-500, Math.min(500, value));
  if (Math.abs(capped) < 1) return 0; // treat near-zero as "no movement on this axis"
  if (Math.abs(capped) < 20) return capped < 0 ? -20 : 20; // bump up to Tello's minimum nonzero magnitude
  return Math.round(capped);
}
