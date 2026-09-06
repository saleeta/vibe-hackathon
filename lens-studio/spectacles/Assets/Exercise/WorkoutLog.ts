/**
 * On-device persistent log of completed workout sessions — same pattern as
 * `Capture/MealLog.ts`: Lens Studio's PersistentStorageSystem, no server.
 */

export interface WorkoutLogEntry {
  steps: number;
  squats: number;
  curls: number;
  curlWeightKg: number;
  kcalBurned: number;
  timestampMillis: number;
}

const STORAGE_KEY = 'fitlens.workoutLog';
/** Cap the log length so a long-running device doesn't grow the store unbounded. */
const MAX_ENTRIES = 500;

export function appendWorkoutLogEntry(entry: WorkoutLogEntry): WorkoutLogEntry[] {
  const log = getWorkoutLog();
  log.push(entry);
  if (log.length > MAX_ENTRIES) log.splice(0, log.length - MAX_ENTRIES);
  global.persistentStorageSystem.store.putString(STORAGE_KEY, JSON.stringify(log));
  return log;
}

export function getWorkoutLog(): WorkoutLogEntry[] {
  const raw = global.persistentStorageSystem.store.getString(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as WorkoutLogEntry[]) : [];
  } catch {
    return [];
  }
}

export function clearWorkoutLog(): void {
  global.persistentStorageSystem.store.putString(STORAGE_KEY, '[]');
}
