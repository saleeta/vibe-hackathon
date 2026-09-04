import { VoiceMemoryEvents } from '../Core/VoiceMemoryEvents';
import { LocateObjectResult } from '../Core/VoiceMemoryTypes';

// Built-in module via require() — no @input asset wiring needed.
const nativeTts: TextToSpeechModule = require('LensStudio:TextToSpeechModule');

/**
 * B3 — speaks the answer using Lens Studio's "Sasha" voice, the officially
 * documented natural/humanistic TTS voice (as opposed to a robotic default).
 *
 * TODO(verify): sample scripts reference `voiceStyle`/`voicePace` on
 * TextToSpeech.Options for picking among Sasha's 1-6 style presets and
 * adjusting speaking speed, but tsc rejects both against this project's
 * installed Lens Studio 5.15.4 types — only `voiceName` compiles. Left
 * out rather than guessing further; worth re-checking directly in the
 * Scripting API reference panel once in-editor.
 *
 * Sentence wording is honest about what this module actually knows: it
 * never invents a location. "Near {locationLabel}" is only said when a
 * sighting genuinely carries one — right now nothing populates that field
 * (no scene/surface understanding is implemented), so in practice this
 * currently always falls back to the plain "last saw" phrasing until a
 * location-labeling capability exists to feed it. DebugVoiceMemoryHarness
 * can set one manually to preview the intended experience.
 */
@component
export class VoiceResponder extends BaseScriptComponent {
  @input
  voiceAudio: AudioComponent;

  onAwake(): void {
    VoiceMemoryEvents.onLocateObjectResult.add((result) => this.respond(result));
  }

  private respond(result: LocateObjectResult): void {
    this.speak(this.buildSentence(result));
  }

  private buildSentence(result: LocateObjectResult): string {
    const { objectClass, sighting } = result;
    if (!sighting) return `I haven't seen your ${objectClass} yet today.`;

    const ago = this.humanizeElapsed(Date.now() - sighting.timestampMillis);
    if (sighting.locationLabel) {
      return `You left your ${objectClass} near ${sighting.locationLabel} ${ago}.`;
    }
    return `I last saw your ${objectClass} ${ago}.`;
  }

  private humanizeElapsed(ms: number): string {
    const minutes = Math.round(ms / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 6) return `about ${hours} hour${hours === 1 ? '' : 's'} ago`;
    return 'earlier today';
  }

  /** Public — anything can ask VoiceResponder to say something, not just the locate-object flow. */
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
        print(`[VoiceResponder] TTS error: ${error} - ${description}`);
      }
    );
  }
}
