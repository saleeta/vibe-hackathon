import { VoiceMemoryEvents } from './Core/VoiceMemoryEvents';
import { ObjectMemoryStore } from './B2_ObjectMemoryStore/ObjectMemoryStore';
import { VoiceResponder } from './B3_VoiceAgent/VoiceResponder';
import { OpenEndedQAClient } from './B3_VoiceAgent/OpenEndedQAClient';

/**
 * Ties B3 (voice intent) to B2 (the store) and publishes the result for
 * B3's VoiceResponder and B4's RewindPopup to both react to independently —
 * neither needs to know the other exists, same decoupling philosophy as
 * spectacles-perception.
 *
 * Also owns the open-ended fallback path: anything VoiceListener couldn't
 * match locally goes to OpenEndedQAClient (Groq), and the reply is spoken
 * directly through VoiceResponder — this is the one place those two need
 * a direct reference to each other rather than talking purely through events,
 * since there's no separate UI step to publish a result for.
 */
@component
export class VoiceMemoryOrchestrator extends BaseScriptComponent {
  @input
  store: ObjectMemoryStore;

  @input
  voiceResponder: VoiceResponder;

  @input
  openEndedQAClient: OpenEndedQAClient;

  onAwake(): void {
    VoiceMemoryEvents.onVoiceIntent.add((intent) => {
      if (intent.type !== 'locate_object') return;
      const sighting = this.store.getLastSightingToday(intent.objectClass);
      VoiceMemoryEvents.onLocateObjectResult.invoke({ objectClass: intent.objectClass, sighting });
    });

    VoiceMemoryEvents.onOpenEndedQuery.add((query) => {
      this.openEndedQAClient
        .ask(query.rawText)
        .then((reply) => this.voiceResponder.speak(reply))
        .catch((err) => {
          print(`[VoiceMemoryOrchestrator] Open-ended query failed: ${err}`);
          this.voiceResponder.speak("Sorry, I couldn't get an answer for that.");
        });
    });
  }
}
