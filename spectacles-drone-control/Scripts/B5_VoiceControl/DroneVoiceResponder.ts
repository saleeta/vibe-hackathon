import { DroneEvents } from '../Core/DroneEvents';

// Built-in module via require() — no @input asset wiring needed. Fully
// standalone: does NOT import spectacles-voice-memory's VoiceResponder,
// per this module's "totally separate" requirement.
const nativeTts: TextToSpeechModule = require('LensStudio:TextToSpeechModule');

/**
 * B5 — speaks the bridge's spoken-confirmation text using Lens Studio's
 * "Sasha" voice (the same confirmed-working TTS setup used in
 * spectacles-voice-memory). Listens on the shared DroneEvents.onStatusReceived
 * signal and only speaks when a message actually carries spokenText — plain
 * gesture-triggered acks/state updates have none, so they stay silent here.
 */
@component
export class DroneVoiceResponder extends BaseScriptComponent {
  @input
  voiceAudio: AudioComponent;

  onAwake(): void {
    DroneEvents.onStatusReceived.add((msg) => {
      if (msg.spokenText) this.speak(msg.spokenText);
    });
  }

  speak(text: string): void {
    const options = TextToSpeech.Options.create();
    options.voiceName = 'Sasha';

    nativeTts.synthesize(
      text,
      options,
      (audioTrackAsset: AudioTrackAsset) => {
        this.voiceAudio.audioTrack = audioTrackAsset;
        this.voiceAudio.play(1);
      },
      (error: unknown, description: unknown) => {
        print(`[DroneVoiceResponder] TTS error: ${error} - ${description}`);
      }
    );
  }
}
