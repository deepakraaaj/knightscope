import Dexie, { type Table } from 'dexie';
import type { Analysis, AppSettings, EngineResult, Game, Mistake, PositionAnalysis, QueueJob, TrainingAttempt, TrainingExercise } from '@/types';

export interface RawResultRow {
  /** `${gameId}|${settingsKey}|${index}|${stage}` */
  key: string;
  gameId: string;
  settingsKey: string;
  index: number;
  stage: 'screening' | 'deep';
  result: EngineResult;
}

export interface EngineCacheRow {
  /** `${engineId}|${epd}|${multiPv}` */
  key: string;
  depth: number;
  /** Depth that was requested (may exceed `depth` when a time cap stopped the search). */
  requestedDepth?: number;
  result: EngineResult;
  updatedAt: number;
}

export const DB_NAME = 'knightscope';

/**
 * Schema history (never edit an old version; add a new one):
 *  v1 initial schema
 *  v2 adds engine result cache + raw results for resumable analysis, and the games.userColor index
 *     (upgrade backfills userColor = null on older game rows)
 */
export class KnightScopeDB extends Dexie {
  games!: Table<Game, string>;
  analyses!: Table<Analysis, string>;
  positions!: Table<PositionAnalysis, string>;
  mistakes!: Table<Mistake, string>;
  exercises!: Table<TrainingExercise, string>;
  attempts!: Table<TrainingAttempt, string>;
  settings!: Table<AppSettings, string>;
  queue!: Table<QueueJob, string>;
  rawResults!: Table<RawResultRow, string>;
  engineCache!: Table<EngineCacheRow, string>;

  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores({
      games: 'id, source, date, importedAt, timeClass',
      analyses: 'id, gameId, status, completedAt',
      positions: 'id, analysisId, gameId',
      mistakes: 'id, gameId, analysisId, category, createdAt',
      exercises: 'id, sourceMistakeId, nextReviewAt, category',
      attempts: 'id, exerciseId, attemptedAt',
      settings: 'id',
      queue: 'id, gameId, status, createdAt',
    });
    this.version(2)
      .stores({
        games: 'id, source, date, importedAt, timeClass, userColor',
        mistakes: 'id, gameId, analysisId, category, createdAt, isUserMove',
        attempts: 'id, exerciseId, attemptedAt, category',
        rawResults: 'key, gameId, settingsKey',
        engineCache: 'key, updatedAt',
      })
      .upgrade(async (tx) => {
        await tx.table('games').toCollection().modify((g: Partial<Game>) => {
          if (g.userColor === undefined) g.userColor = null;
        });
        await tx.table('mistakes').toCollection().modify((m: Partial<Mistake>) => {
          if (m.isUserMove === undefined) m.isUserMove = false;
        });
      });
  }
}

export const db = new KnightScopeDB();

/** Ask the browser to keep our data even under storage pressure (best effort). */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export function describeStorageError(e: unknown): string {
  const name = (e as { name?: string })?.name ?? '';
  if (name === 'QuotaExceededError' || /quota/i.test(String((e as Error)?.message))) return 'Your device is out of storage space for KnightScope. Export a backup and remove old games, or free up space.';
  if (name === 'InvalidStateError' || name === 'MissingAPIError') return 'Local storage is unavailable (private browsing mode can block it). KnightScope needs IndexedDB to save games.';
  if (name === 'VersionError') return 'The saved data was created by a newer version of KnightScope. Update the app to open it.';
  return `Local storage error: ${(e as Error)?.message ?? String(e)}`;
}
