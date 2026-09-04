import { VoiceMemoryEvents } from './Core/VoiceMemoryEvents';
import { ObjectMemoryStore } from './B2_ObjectMemoryStore/ObjectMemoryStore';

/**
 * Ties B3 (voice intent) to B2 (the store) and publishes the result for
 * B3's VoiceResponder and B4's RewindPopup to both react to independently —
 * neither needs to know the other exists, same decoupling philosophy as
 * spectacles-perception.
 */
@component
export class VoiceMemoryOrchestrator extends BaseScriptComponent {
  @input
  store: ObjectMemoryStore;

  onAwake(): void {
    VoiceMemoryEvents.onVoiceIntent.add((intent) => {
      if (intent.type !== 'locate_object') return;
      const sighting = this.store.getLastSightingToday(intent.objectClass);
      VoiceMemoryEvents.onLocateObjectResult.invoke({ objectClass: intent.objectClass, sighting });
    });
  }
}
