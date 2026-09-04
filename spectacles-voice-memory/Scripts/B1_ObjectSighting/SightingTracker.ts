import { VoiceMemoryEvents } from '../Core/VoiceMemoryEvents';
import { ObjectSighting, TrackedObjectClass } from '../Core/VoiceMemoryTypes';
import { FrameSnapshotter } from './FrameSnapshotter';

/**
 * B1 — turns a raw stream of per-frame object detections into "last seen"
 * events. An object counts as no-longer-in-view once it hasn't been
 * detected for `settleMs`; at that point the sighting is finalized with a
 * snapshot of the frames leading up to it — an honest reading of
 * "the last instance you had it," not a guess at when it was "put down."
 */
@component
export class SightingTracker extends BaseScriptComponent {
  @input
  frameSnapshotter: FrameSnapshotter;

  @input
  @hint('How long an object must be unseen before its last detection is finalized as a sighting.')
  settleMs: number = 2000;

  @input
  minConfidence: number = 0.5;

  private lastSeenMillis = new Map<TrackedObjectClass, number>();
  private finalized = new Set<TrackedObjectClass>();

  onAwake(): void {
    VoiceMemoryEvents.onObjectDetected.add((d) => {
      if (d.confidence < this.minConfidence) return;
      this.lastSeenMillis.set(d.objectClass, d.timestampMillis);
      this.finalized.delete(d.objectClass); // seen again — no longer finalized, can re-finalize later
    });
    this.createEvent('UpdateEvent').bind(() => this.tick());
  }

  private tick(): void {
    const now = Date.now(); // wall-clock, to match the Date.now() timestamps detections carry
    for (const [objectClass, lastSeen] of this.lastSeenMillis) {
      if (this.finalized.has(objectClass)) continue;
      if (now - lastSeen < this.settleMs) continue;

      const sighting: ObjectSighting = {
        objectClass,
        timestampMillis: lastSeen,
        snippetFrames: this.frameSnapshotter.getRecentFrames(),
      };
      this.finalized.add(objectClass);
      VoiceMemoryEvents.onSightingRecorded.invoke(sighting);
    }
  }
}
