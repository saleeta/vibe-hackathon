import { VoiceMemoryEvents } from '../Core/VoiceMemoryEvents';
import { ObjectSighting, TrackedObjectClass } from '../Core/VoiceMemoryTypes';

/**
 * B2 — "the database." Keeps the most recent sighting per tracked object
 * class and answers "was this seen today, and if so when/where."
 *
 * Two tiers, deliberately:
 *  - In-memory (this session only): the full ObjectSighting including its
 *    snippetFrames (Texture[]) for the rewind playback.
 *  - Persisted (global.persistentStorageSystem.store, survives an app
 *    restart): timestamp + locationLabel only, as a JSON string. Texture
 *    data cannot go through this string-based key/value store, so a
 *    sighting from a previous session degrades gracefully — the voice
 *    agent can still truthfully say *when* an object was last seen, just
 *    without the visual rewind. That tradeoff is called out again in the
 *    module README; it's a real platform limitation, not an oversight.
 */
export interface IObjectMemoryStore {
  recordSighting(sighting: ObjectSighting): void;
  getLastSightingToday(objectClass: TrackedObjectClass): ObjectSighting | null;
}

interface PersistedMeta {
  timestampMillis: number;
  locationLabel: string | null;
}

@component
export class ObjectMemoryStore extends BaseScriptComponent implements IObjectMemoryStore {
  private sightingsInMemory = new Map<TrackedObjectClass, ObjectSighting>();

  onAwake(): void {
    VoiceMemoryEvents.onSightingRecorded.add((s) => this.recordSighting(s));
  }

  recordSighting(sighting: ObjectSighting): void {
    this.sightingsInMemory.set(sighting.objectClass, sighting);
    this.persistMeta(sighting);
  }

  getLastSightingToday(objectClass: TrackedObjectClass): ObjectSighting | null {
    const inMemory = this.sightingsInMemory.get(objectClass);
    if (inMemory && this.isToday(inMemory.timestampMillis)) return inMemory;

    // Not seen this session — check whether an earlier session logged it today.
    const meta = this.loadMeta(objectClass);
    if (meta && this.isToday(meta.timestampMillis)) {
      return {
        objectClass,
        timestampMillis: meta.timestampMillis,
        snippetFrames: [], // lost across the restart — see class doc
        locationLabel: meta.locationLabel ?? undefined,
      };
    }
    return null;
  }

  private isToday(epochMillis: number): boolean {
    const a = new Date(epochMillis);
    const b = new Date();
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  private storageKey(objectClass: TrackedObjectClass): string {
    return `voiceMemory.lastSighting.${objectClass}`;
  }

  private persistMeta(sighting: ObjectSighting): void {
    try {
      const meta: PersistedMeta = {
        timestampMillis: sighting.timestampMillis,
        locationLabel: sighting.locationLabel ?? null,
      };
      global.persistentStorageSystem.store.putString(this.storageKey(sighting.objectClass), JSON.stringify(meta));
    } catch (err) {
      print(`[ObjectMemoryStore] Failed to persist sighting metadata: ${err}`);
    }
  }

  private loadMeta(objectClass: TrackedObjectClass): PersistedMeta | null {
    try {
      const raw = global.persistentStorageSystem.store.getString(this.storageKey(objectClass));
      return raw ? (JSON.parse(raw) as PersistedMeta) : null;
    } catch (err) {
      print(`[ObjectMemoryStore] Failed to read persisted sighting metadata: ${err}`);
      return null;
    }
  }
}
