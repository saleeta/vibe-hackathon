import { TrackedObjectClass } from '../Core/VoiceMemoryTypes';
import { VoiceMemoryEvents } from '../Core/VoiceMemoryEvents';

/**
 * Pluggable seam: whatever recognizes "keys/phone/glasses/wallet/headphones"
 * in a frame feeds VoiceMemoryEvents.onObjectDetected. No such general
 * multi-class object detector/model exists yet in this project — the same
 * situation A3's OnDeviceObjectDetector was in for food classes. Until a
 * trained model is wired in, feed detections manually via
 * DebugVoiceMemoryHarness for testing.
 */
export interface IObjectDetector {
  start(): void;
  stop(): void;
}

/**
 * Small helper any real implementation calls into — kept here so the "how
 * to report a detection" shape lives in one place.
 *
 * Uses Date.now() (real wall-clock epoch), not getTime() (scene-relative,
 * resets every session) — ObjectMemoryStore needs actual calendar time for
 * "today" checks and for timestamps to still mean something after a restart.
 */
export function reportDetection(objectClass: TrackedObjectClass, confidence: number): void {
  VoiceMemoryEvents.onObjectDetected.invoke({ objectClass, confidence, timestampMillis: Date.now() });
}
