import { VoiceMemoryEvents } from '../Core/VoiceMemoryEvents';
import { TrackedObjectClass } from '../Core/VoiceMemoryTypes';

// Built-in modules via require() — same zero-asset-wiring pattern as
// spectacles-perception's CameraSampler/FoodAnalysisClient.
const nativeAsrModule: AsrModule = require('LensStudio:AsrModule');
const nativeGestureModule: GestureModule = require('LensStudio:GestureModule');

/** Synonyms mapped to canonical object classes — extend as needed. */
const OBJECT_SYNONYMS: Record<TrackedObjectClass, string[]> = {
  keys: ['keys', 'key'],
  phone: ['phone', 'mobile', 'cell phone', 'cellphone'],
  glasses: ['glasses', 'sunglasses', 'specs'],
  wallet: ['wallet', 'purse'],
  headphones: ['headphones', 'earbuds', 'airpods', 'headphone'],
};

/**
 * Lightweight, local, real-time intent parser — deliberately not an LLM
 * round-trip. "Realtime" mattered more here than open-ended conversation:
 * this resolves instantly, on-device, for the one command shape this
 * feature actually needs. Swap for a fuller NLU/LLM later without
 * touching anything downstream — it only ever produces the same
 * VoiceIntent shape.
 */
export function parseLocateObjectIntent(text: string): TrackedObjectClass | null {
  const lower = text.toLowerCase();
  if (!/\bwhere\b/.test(lower)) return null;
  for (const objectClass of Object.keys(OBJECT_SYNONYMS) as TrackedObjectClass[]) {
    if (OBJECT_SYNONYMS[objectClass].some((syn) => lower.includes(syn))) return objectClass;
  }
  return null;
}

/**
 * B3 — push-to-talk voice input. Starts listening on pinch-down, stops and
 * parses on pinch-up, rather than always-on listening — better for
 * battery and privacy, and a familiar wearable interaction pattern.
 */
@component
export class VoiceListener extends BaseScriptComponent {
  @input
  @hint('How long ASR waits for silence before finalizing the transcript.')
  silenceTimeoutMs: number = 1200;

  @input
  @widget(new ComboBoxWidget([new ComboBoxItem('right', 'right'), new ComboBoxItem('left', 'left'), new ComboBoxItem('both', 'both')]))
  @hint('Which hand\'s pinch triggers listening.')
  listenHand: string = 'right';

  private latestTranscript = '';
  private listening = false;
  private finalHandled = false;

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.wirePinchTrigger());
  }

  private wirePinchTrigger(): void {
    // Editor-preview fallback: GestureModule's pinch events depend on real
    // hand-tracking hardware and threw an uncaught exception in the desktop
    // simulator during testing (unlike CameraModule's calls, which fail
    // gracefully with a catchable error) — same "give every feature an
    // isEditor() fallback" rule as CameraSampler/FrameSnapshotter, just a
    // harder failure mode here.
    try {
      const hands: string[] = this.listenHand === 'both' ? ['left', 'right'] : [this.listenHand];
      for (const hand of hands) {
        const handType = hand === 'left' ? GestureModule.HandType.Left : GestureModule.HandType.Right;
        nativeGestureModule.getPinchDownEvent(handType).add(() => this.startListening());
        nativeGestureModule.getPinchUpEvent(handType).add(() => this.stopListening());
      }
    } catch (err) {
      print(`[VoiceListener] Failed to wire pinch trigger (expected in some editor-preview states): ${err}`);
    }
  }

  startListening(): void {
    if (this.listening) return;
    this.listening = true;
    this.finalHandled = false;
    this.latestTranscript = '';

    const options = AsrModule.AsrTranscriptionOptions.create();
    options.silenceUntilTerminationMs = this.silenceTimeoutMs;
    // No explicit param type — let it infer from onTranscriptionUpdateEvent's
    // real signature (TranscriptionUpdateEvent), confirmed via tsc rather
    // than guessed.
    options.onTranscriptionUpdateEvent.add((e) => {
      this.latestTranscript = e.text;
      if (e.isFinal) this.handleFinalTranscript(e.text);
    });
    options.onTranscriptionErrorEvent.add((err) => {
      print(`[VoiceListener] ASR error: ${err}`);
    });
    nativeAsrModule.startTranscribing(options);
  }

  stopListening(): void {
    if (!this.listening) return;
    this.listening = false;
    nativeAsrModule.stopTranscribing().then(() => {
      // Fallback for a quick pinch that released before ASR emitted isFinal.
      if (!this.finalHandled && this.latestTranscript) this.handleFinalTranscript(this.latestTranscript);
    });
  }

  private handleFinalTranscript(text: string): void {
    if (this.finalHandled) return;
    this.finalHandled = true;
    print(`[VoiceListener] Heard: "${text}"`);

    const objectClass = parseLocateObjectIntent(text);
    if (objectClass) {
      VoiceMemoryEvents.onVoiceIntent.invoke({ type: 'locate_object', objectClass, rawText: text });
    } else {
      // Doesn't match the fast local pattern — hand it to the open-ended
      // LLM fallback (OpenEndedQAClient) rather than dropping it.
      VoiceMemoryEvents.onOpenEndedQuery.invoke({ rawText: text });
    }
  }
}
