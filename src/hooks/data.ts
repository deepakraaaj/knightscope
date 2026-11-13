import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/storage/database/db';
import { DEFAULT_SETTINGS, completedAnalysisByGame } from '@/storage/repositories';
import { DEFAULT_THRESHOLDS } from '@/chess/classification/classify';
import type { AppSettings } from '@/types';

export function useSettings(): AppSettings {
  const s = useLiveQuery(() => db.settings.get('app'), []);
  return { ...DEFAULT_SETTINGS, ...s, thresholds: { ...DEFAULT_THRESHOLDS, ...s?.thresholds }, usernames: { ...DEFAULT_SETTINGS.usernames, ...s?.usernames } };
}

/** All library data needed by dashboards. `undefined` while loading. */
export function useLibrary() {
  return useLiveQuery(async () => {
    const [games, mistakes, exercises, attempts, analyses] = await Promise.all([
      db.games.toArray(),
      db.mistakes.toArray(),
      db.exercises.toArray(),
      db.attempts.toArray(),
      completedAnalysisByGame(),
    ]);
    return { games, mistakes, exercises, attempts, analyses };
  }, []);
}
