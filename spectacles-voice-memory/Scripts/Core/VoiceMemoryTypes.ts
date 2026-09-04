/**
 * Shared types for the voice-agent + lost-object-memory module (B1-B4).
 *
 * Self-contained on purpose — this module doesn't import from
 * spectacles-perception, even though both live in the same Lens Studio
 * project, so either can be dropped into a different project alone.
 */

/** Canonical classes of "frequently lost" objects this module tracks. Extend freely. */
export type TrackedObjectClass = 'keys' | 'phone' | 'glasses' | 'wallet' | 'headphones';

export const TRACKED_OBJECT_CLASSES: TrackedObjectClass[] = ['keys', 'phone', 'glasses', 'wallet', 'headphones'];

/** One detection of a tracked object in a frame — the input feed B1 consumes. */
export interface ObjectDetection {
  objectClass: TrackedObjectClass;
  confidence: number;
  timestampMillis: number;
}

/**
 * A finalized "last seen" record for one object class: the object was
 * visible, then stopped being detected — this is the snapshot from just
 * before it disappeared from view, which is the honest reading of
 * "the last instance you had it."
 */
export interface ObjectSighting {
  objectClass: TrackedObjectClass;
  timestampMillis: number;
  /**
   * Short frame sequence leading up to the last-seen moment, oldest first,
   * for the "rewind" playback. In-memory only for this session — see
   * ObjectMemoryStore's README note on why snippets don't survive an app
   * restart, only the sighting's timestamp does.
   */
  snippetFrames: Texture[];
  /**
   * Optional human-readable location ("the table", "the counter"). Left
   * undefined unless something upstream can actually determine it — no
   * real scene/surface understanding is implemented yet, so this is never
   * fabricated. See VoiceResponder's honest fallback phrasing.
   */
  locationLabel?: string;
}

/** Parsed result of a spoken command. */
export interface VoiceIntent {
  type: 'locate_object';
  objectClass: TrackedObjectClass;
  rawText: string;
}

/** What VoiceResponder says back, and what RewindPopup shows. */
export interface LocateObjectResult {
  objectClass: TrackedObjectClass;
  sighting: ObjectSighting | null; // null = not seen today
}
