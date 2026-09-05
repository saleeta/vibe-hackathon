/**
 * On-device persistent log of "what was eaten, and when" — uses Lens
 * Studio's PersistentStorageSystem (a local key-value store that survives
 * across Lens sessions on the same device), not a remote database: no
 * network dependency beyond the Gemini call already required for
 * recognition, and no server to stand up/maintain for a hackathon build.
 *
 * Lens-coupled on purpose (global.persistentStorageSystem is a Lens Studio
 * global) — lives in Capture/ rather than Nutrition/ for that reason; every
 * other Nutrition/ file stays plain-TS/portable per that folder's own
 * convention (see Assets/README.md).
 */

export interface MealLogEntry {
  name: string;
  kcal: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  glycemicLoad?: number;
  timestampMillis: number;
}

const STORAGE_KEY = 'foodlens.mealLog';
/** Cap the log length so a long-running device doesn't grow the store unbounded. */
const MAX_ENTRIES = 500;

export function appendMealLogEntry(entry: MealLogEntry): MealLogEntry[] {
  const log = getMealLog();
  log.push(entry);
  if (log.length > MAX_ENTRIES) log.splice(0, log.length - MAX_ENTRIES);
  global.persistentStorageSystem.store.putString(STORAGE_KEY, JSON.stringify(log));
  return log;
}

export function getMealLog(): MealLogEntry[] {
  const raw = global.persistentStorageSystem.store.getString(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MealLogEntry[]) : [];
  } catch {
    return [];
  }
}

export function clearMealLog(): void {
  global.persistentStorageSystem.store.putString(STORAGE_KEY, '[]');
}
