import { DroneBridgeClient } from '../B3_DroneBridge/DroneBridgeClient';

// Built-in modules via require() — same zero-asset-wiring pattern used
// throughout this project. Fully standalone: does NOT import
// spectacles-voice-memory's VoiceListener, even though the pinch-trigger
// pattern below is the same proven one used there — per this module's
// "totally separate" requirement.
const nativeAsrModule: AsrModule = require('LensStudio:AsrModule');
const nativeGestureModule: GestureModule = require('LensStudio:GestureModule');

/**
 * B5 — push-to-talk voice control for the drone. Starts listening on
 * pinch-down, stops and sends on pinch-up. The raw transcript is shipped
 * to drone-bridge as-is ("take off", "fly forward one meter", "what's the
 * battery") — this file does no NLU itself; the bridge calls an LLM to
 * turn it into an actual DroneCommand (see drone-bridge/server.js).
 *
 * Gesture note: this uses LEFT-hand pinch. If Flow A (WaypointSelector) or
 * Flow B (AnchorDestinationController) are also enabled, their pinch
 * gestures can collide with this one — disable them for a voice-control
 * demo, same as the module README already recommends when A/B testing
 * the two destination flows against each other.
 */
@component
export class DroneVoiceListener extends BaseScriptComponent {
  @input
  bridgeClient: DroneBridgeClient;

  @input
  @hint('How long ASR waits for silence before finalizing the transcript.')
  silenceTimeoutMs: number = 1200;

  private listening = false;
  private finalHandled = false;
  private latestTranscript = '';

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.wirePinchTrigger());
  }

  private wirePinchTrigger(): void {
    // GestureModule's pinch events need real hand-tracking hardware and
    // throw an uncaught exception in the desktop simulator — same
    // editor-preview fallback used everywhere else in this project.
    try {
      nativeGestureModule.getPinchDownEvent(GestureModule.HandType.Left).add(() => this.startListening());
      nativeGestureModule.getPinchUpEvent(GestureModule.HandType.Left).add(() => this.stopListening());
    } catch (err) {
      print(`[DroneVoiceListener] Failed to wire pinch trigger (expected in some editor-preview states): ${err}`);
    }
  }

  startListening(): void {
    if (this.listening) return;
    this.listening = true;
    this.finalHandled = false;
    this.latestTranscript = '';

    try {
      const options = AsrModule.AsrTranscriptionOptions.create();
      options.silenceUntilTerminationMs = this.silenceTimeoutMs;
      options.onTranscriptionUpdateEvent.add((e) => {
        this.latestTranscript = e.text;
        if (e.isFinal) this.handleFinalTranscript(e.text);
      });
      options.onTranscriptionErrorEvent.add((err) => {
        print(`[DroneVoiceListener] ASR error: ${err}`);
      });
      nativeAsrModule.startTranscribing(options);
    } catch (err) {
      print(`[DroneVoiceListener] Failed to start transcribing (expected in some editor-preview states): ${err}`);
    }
  }

  stopListening(): void {
    if (!this.listening) return;
    this.listening = false;
    try {
      nativeAsrModule.stopTranscribing().then(() => {
        // Fallback for a quick pinch that released before ASR emitted isFinal.
        if (!this.finalHandled && this.latestTranscript) this.handleFinalTranscript(this.latestTranscript);
      });
    } catch (err) {
      print(`[DroneVoiceListener] Failed to stop transcribing: ${err}`);
    }
  }

  private handleFinalTranscript(text: string): void {
    if (this.finalHandled) return;
    this.finalHandled = true;
    print(`[DroneVoiceListener] Heard: "${text}"`);
    this.bridgeClient.sendVoiceCommand(text);
  }
}
