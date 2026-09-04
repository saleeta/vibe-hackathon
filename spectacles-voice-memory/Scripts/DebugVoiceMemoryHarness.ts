import { VoiceMemoryEvents } from './Core/VoiceMemoryEvents';
import { reportDetection } from './B1_ObjectSighting/IObjectDetector';
import { TrackedObjectClass } from './Core/VoiceMemoryTypes';

/**
 * Debug/testing harness — lets every B1-B4 state be reached without a
 * trained object-detection model, a microphone, or waiting on real
 * hardware, same purpose as spectacles-perception's DebugHarness. Call
 * these from the Logger panel.
 */
@component
export class DebugVoiceMemoryHarness extends BaseScriptComponent {
  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => {
      print('[DebugVoiceMemoryHarness] Ready. Try simulateObjectSeenThenGone(), simulateVoiceQuery(), or simulateFoundWithLocation().');
    });
  }

  /**
   * Reports one detection of `objectClass`. SightingTracker will finalize
   * it into a sighting once its settle window elapses without a repeat
   * detection — call this once, then wait ~2s (SightingTracker's default
   * settleMs) rather than needing a real detector to stop seeing it.
   */
  simulateObjectSeenThenGone(objectClass: TrackedObjectClass = 'keys'): void {
    reportDetection(objectClass, 0.95);
    print(`[DebugVoiceMemoryHarness] Reported one ${objectClass} detection — it will finalize as "last seen" once SightingTracker's settle window elapses.`);
  }

  /** Simulates the wearer asking "where are my X" without a microphone. */
  simulateVoiceQuery(objectClass: TrackedObjectClass = 'keys'): void {
    VoiceMemoryEvents.onVoiceIntent.invoke({
      type: 'locate_object',
      objectClass,
      rawText: `where are my ${objectClass}`,
    });
  }

  /**
   * Skips straight to a found result with a canned location and timestamp
   * — previews the intended full experience (voice + rewind UI) with a
   * location label, since nothing upstream can genuinely determine one yet.
   */
  simulateFoundWithLocation(objectClass: TrackedObjectClass = 'keys', locationLabel: string = 'the table', minutesAgo: number = 12): void {
    VoiceMemoryEvents.onLocateObjectResult.invoke({
      objectClass,
      sighting: {
        objectClass,
        timestampMillis: Date.now() - minutesAgo * 60 * 1000,
        snippetFrames: [],
        locationLabel,
      },
    });
  }

  /** Simulates asking about an object that was never seen today. */
  simulateNotFound(objectClass: TrackedObjectClass = 'wallet'): void {
    VoiceMemoryEvents.onLocateObjectResult.invoke({ objectClass, sighting: null });
  }
}
