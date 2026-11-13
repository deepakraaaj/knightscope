import { db, type KnightScopeDB } from '@/storage/database/db';
import type { Analysis, AppSettings, Game, Mistake, PositionAnalysis, QueueJob, TrainingAttempt, TrainingExercise } from '@/types';
import { DEFAULT_THRESHOLDS } from '@/chess/classification/classify';

// ---------------------------------------------------------------- settings

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'app',
  usernames: { chesscom: '', lichess: '', other: [] },
  preset: 'balanced',
  customDepth: null,
  maxEngines: 1,
  engineFlavor: 'lite',
  explanationLevel: 'intermediate',
  thresholds: DEFAULT_THRESHOLDS,
  trainingAcceptanceWinLoss: 4,
  boardTheme: 'slate',
  showCoordinates: true,
  cloudEval: false,
  benchmark: null,
};

export async function getSettings(d: KnightScopeDB = db): Promise<AppSettings> {
  const s = await d.settings.get('app');
  return { ...DEFAULT_SETTINGS, ...s, thresholds: { ...DEFAULT_THRESHOLDS, ...s?.thresholds }, usernames: { ...DEFAULT_SETTINGS.usernames, ...s?.usernames } };
}

export async function saveSettings(patch: Partial<AppSettings>, d: KnightScopeDB = db): Promise<AppSettings> {
  const next = { ...(await getSettings(d)), ...patch, id: 'app' as const };
  await d.settings.put(next);
  return next;
}

export function allUsernames(s: AppSettings): string[] {
  return [s.usernames.chesscom, s.usernames.lichess, ...s.usernames.other].map((u) => u.trim()).filter(Boolean);
}

// ---------------------------------------------------------------- games

export interface ImportOutcome {
  added: Game[];
  duplicates: number;
}

/** Insert games, skipping ids that already exist (duplicate prevention). Never overwrites saved games. */
export async function addGames(games: Game[], d: KnightScopeDB = db): Promise<ImportOutcome> {
  const unique = new Map<string, Game>();
  for (const g of games) if (!unique.has(g.id)) unique.set(g.id, g);
  const ids = [...unique.keys()];
  const existing = new Set((await d.games.bulkGet(ids)).filter(Boolean).map((g) => g!.id));
  const added = [...unique.values()].filter((g) => !existing.has(g.id));
  if (added.length) await d.games.bulkAdd(added);
  return { added, duplicates: games.length - added.length };
}

/** Re-derive which side the user played after usernames change. */
export async function refreshUserColors(usernames: string[], d: KnightScopeDB = db): Promise<void> {
  const names = usernames.map((u) => u.toLowerCase());
  await d.transaction('rw', d.games, d.mistakes, async () => {
    await d.games.toCollection().modify((g) => {
      g.userColor = names.includes(g.white.toLowerCase()) ? 'w' : names.includes(g.black.toLowerCase()) ? 'b' : null;
    });
    const games = new Map((await d.games.toArray()).map((g) => [g.id, g.userColor]));
    await d.mistakes.toCollection().modify((m) => {
      m.isUserMove = games.get(m.gameId) === m.playerColor;
    });
  });
}

export async function deleteGame(gameId: string, d: KnightScopeDB = db): Promise<void> {
  await d.transaction('rw', [d.games, d.analyses, d.positions, d.mistakes, d.queue, d.rawResults], async () => {
    await d.positions.where('gameId').equals(gameId).delete();
    await d.analyses.where('gameId').equals(gameId).delete();
    await d.mistakes.where('gameId').equals(gameId).delete();
    await d.queue.where('gameId').equals(gameId).delete();
    await d.rawResults.where('gameId').equals(gameId).delete();
    await d.games.delete(gameId);
  });
}

// ---------------------------------------------------------------- analyses

export async function latestCompleteAnalysis(gameId: string, d: KnightScopeDB = db): Promise<Analysis | undefined> {
  const all = await d.analyses.where('gameId').equals(gameId).toArray();
  return all.filter((a) => a.status === 'complete').sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))[0];
}

export async function completedAnalysisByGame(d: KnightScopeDB = db): Promise<Map<string, Analysis>> {
  const all = await d.analyses.where('status').equals('complete').toArray();
  const map = new Map<string, Analysis>();
  for (const a of all) {
    const prev = map.get(a.gameId);
    if (!prev || (a.completedAt ?? 0) > (prev.completedAt ?? 0)) map.set(a.gameId, a);
  }
  return map;
}

/**
 * Store a finished review. The previous review of the same game is replaced (positions and mistakes
 * are regenerated from the new analysis). Mistake ids are stable (`gameId:ply`), so training
 * exercises created from an earlier review stay linked. Exercises and attempts are never deleted here.
 */
export async function saveCompletedAnalysis(
  analysis: Analysis,
  positions: PositionAnalysis[],
  mistakes: Mistake[],
  d: KnightScopeDB = db,
): Promise<void> {
  await d.transaction('rw', [d.analyses, d.positions, d.mistakes], async () => {
    const old = await d.analyses.where('gameId').equals(analysis.gameId).toArray();
    for (const a of old) {
      if (a.id === analysis.id) continue;
      await d.positions.where('analysisId').equals(a.id).delete();
      await d.analyses.delete(a.id);
    }
    await d.mistakes.where('gameId').equals(analysis.gameId).delete();
    await d.analyses.put(analysis);
    await d.positions.bulkPut(positions);
    await d.mistakes.bulkPut(mistakes);
  });
}

export async function positionsFor(analysisId: string, d: KnightScopeDB = db): Promise<PositionAnalysis[]> {
  const ps = await d.positions.where('analysisId').equals(analysisId).toArray();
  return ps.sort((a, b) => a.ply - b.ply);
}

// ---------------------------------------------------------------- queue

export async function enqueueGames(gameIds: string[], preset: QueueJob['preset'], d: KnightScopeDB = db): Promise<number> {
  const active = await d.queue.where('status').anyOf('queued', 'running', 'paused').toArray();
  const activeIds = new Set(active.map((j) => j.gameId));
  const now = Date.now();
  const jobs: QueueJob[] = gameIds
    .filter((id) => !activeIds.has(id))
    .map((gameId, i) => ({
      id: `job_${now.toString(36)}_${i}_${gameId}`,
      gameId,
      status: 'queued',
      stage: null,
      positionsDone: 0,
      positionsTotal: 0,
      deepDone: 0,
      deepTotal: 0,
      currentDepth: 0,
      preset,
      createdAt: now + i,
      updatedAt: now,
      error: null,
      analysisId: null,
    }));
  if (jobs.length) await d.queue.bulkAdd(jobs);
  return jobs.length;
}

/**
 * On app start, any job left "running" belongs to a session that ended (reload / crash / closed tab).
 * Mark it paused so the user explicitly resumes it; persisted raw results let it continue where it stopped.
 */
export async function recoverInterruptedJobs(d: KnightScopeDB = db): Promise<number> {
  return d.queue.where('status').equals('running').modify({ status: 'paused', updatedAt: Date.now() });
}

export async function clearFinishedJobs(d: KnightScopeDB = db): Promise<void> {
  await d.queue.where('status').anyOf('done', 'cancelled', 'error').delete();
}

// ---------------------------------------------------------------- training

export async function saveExercise(ex: TrainingExercise, d: KnightScopeDB = db): Promise<{ created: boolean }> {
  if (ex.sourceMistakeId) {
    const existing = await d.exercises.where('sourceMistakeId').equals(ex.sourceMistakeId).first();
    if (existing) return { created: false };
  }
  await d.exercises.put(ex);
  return { created: true };
}

export async function recordAttempt(attempt: TrainingAttempt, exercise: TrainingExercise, next: Pick<TrainingExercise, 'box' | 'nextReviewAt'>, d: KnightScopeDB = db): Promise<void> {
  await d.transaction('rw', d.attempts, d.exercises, async () => {
    await d.attempts.add(attempt);
    await d.exercises.update(exercise.id, {
      box: next.box,
      nextReviewAt: next.nextReviewAt,
      attempts: exercise.attempts + 1,
      successes: exercise.successes + (attempt.correct ? 1 : 0),
      lastResult: attempt.correct ? 'success' : 'failure',
    });
  });
}

// ---------------------------------------------------------------- backup

export const EXPORT_FORMAT = 'knightscope-backup';
export const EXPORT_VERSION = 1;
const EXPORT_TABLES = ['games', 'analyses', 'positions', 'mistakes', 'exercises', 'attempts', 'settings'] as const;

export async function exportAll(d: KnightScopeDB = db): Promise<string> {
  const data: Record<string, unknown[]> = {};
  for (const t of EXPORT_TABLES) data[t] = await d.table(t).toArray();
  return JSON.stringify({ format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: new Date().toISOString(), data });
}

/** Merge a backup into the database. Existing records with the same id are kept (no silent overwrite). */
export async function importAll(json: string, d: KnightScopeDB = db): Promise<Record<string, number>> {
  let parsed: { format?: string; version?: number; data?: Record<string, unknown[]> };
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (parsed.format !== EXPORT_FORMAT || typeof parsed.version !== 'number' || !parsed.data) throw new Error('This file is not a KnightScope backup.');
  if (parsed.version > EXPORT_VERSION) throw new Error('This backup was created by a newer KnightScope version.');
  const counts: Record<string, number> = {};
  await d.transaction('rw', EXPORT_TABLES.map((t) => d.table(t)), async () => {
    for (const t of EXPORT_TABLES) {
      const rows = Array.isArray(parsed.data![t]) ? (parsed.data![t] as { id?: string }[]) : [];
      const valid = rows.filter((r) => r && typeof r === 'object' && typeof r.id === 'string');
      const table = d.table(t);
      const existing = new Set((await table.bulkGet(valid.map((r) => r.id!))).filter(Boolean).map((r) => (r as { id: string }).id));
      const fresh = valid.filter((r) => !existing.has(r.id!));
      if (fresh.length) await table.bulkAdd(fresh);
      counts[t] = fresh.length;
    }
  });
  return counts;
}
