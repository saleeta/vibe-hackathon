import { VoiceMemoryEvents } from './Core/VoiceMemoryEvents';
import { reportDetection } from './B1_ObjectSighting/IObjectDetector';
import { TrackedObjectClass } from './Core/VoiceMemoryTypes';

/**
 * Debug/testing harness — lets every B1-B4 state be reached without a
 * trained object-detection model, a microphone, or waiting on real
 * hardware, same purpose as spectacles-perception's DebugHarness.
 *
 * IMPORTANT: there is no built-in Lens Studio feature to call a script
 * method from the Inspector or Logger panel (confirmed against Snap's own
 * docs). So `autoRun` fires `simulateFoundWithLocation('keys', ...)`
 * automatically a few seconds after the Lens starts, to actually show the
 * RewindPopup + spoken response on real hardware. Turn `autoRun` off in
 * the Inspector once you're done watching it (it will otherwise fire on
 * every launch, which can interleave oddly with a real voice query a few
 * seconds later).
 */
@component
export class DebugVoiceMemoryHarness extends BaseScriptComponent {
  @input
  @hint("Automatically call simulateFoundWithLocation() a few seconds after the Lens starts. There's no way to invoke a method from the Inspector/Logger, so this is how to see the effect on real hardware.")
  autoRun: boolean = true;

  @input
  @hint('Delay in seconds before autoRun fires.')
  autoRunDelaySeconds: number = 3;

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => {
      print('[DebugVoiceMemoryHarness] Ready. autoRun will call simulateFoundWithLocation() automatically — see the autoRun input to disable.');
      if (this.autoRun) {
        const delay = this.createEvent('DelayedCallbackEvent');
        delay.bind(() => this.simulateFoundWithLocation());
        delay.reset(this.autoRunDelaySeconds);
      }
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
