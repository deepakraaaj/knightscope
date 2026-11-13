import { useRunner } from './runnerStore';
import { db, describeStorageError } from '@/storage/database/db';
import { getSettings, saveCompletedAnalysis } from '@/storage/repositories';
import { analyzeGame, type GameAnalyzerProgress, type StoredRaw } from './gameAnalyzer';
import { settingsFor } from './presets';
import { cachedAnalyze, enginePool } from '@/engine/stockfish/enginePool';
import { AbortedError } from '@/engine/stockfish/engine';
import { backgroundAnalysis } from '@/engine/native/background';
import type { Analysis, QueueJob } from '@/types';

export { useRunner, type LiveJob } from './runnerStore';

type StopReason = 'pause' | 'cancel';
const controllers = new Map<string, { ctrl: AbortController; reason: StopReason | null }>();
let loopsActive = 0;
let wakeLock: { release: () => Promise<void> } | null = null;

async function acquireWakeLock() {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    if (nav.wakeLock && !wakeLock) wakeLock = await nav.wakeLock.request('screen');
  } catch {
    /* not supported or denied; analysis still works */
  }
}

function releaseWakeLock() {
  wakeLock?.release().catch(() => undefined);
  wakeLock = null;
}

async function claimNextJob(): Promise<QueueJob | null> {
  return db.transaction('rw', db.queue, async () => {
    const next = (await db.queue.where('status').equals('queued').sortBy('createdAt'))[0];
    if (!next) return null;
    await db.queue.update(next.id, { status: 'running', updatedAt: Date.now(), error: null });
    return { ...next, status: 'running' };
  });
}

function settingsKeyFor(engineName: string, s: ReturnType<typeof settingsFor>): string {
  return `${engineName}|${s.screeningDepth}/${s.screeningMoveTimeMs}|${s.deepDepth}/${s.deepMoveTimeMs}|pv${s.multiPv}`;
}

async function runJob(job: QueueJob, slot: number): Promise<void> {
  const appSettings = await getSettings();
  const settings = settingsFor(job.preset, appSettings.customDepth);
  const game = await db.games.get(job.gameId);
  if (!game) {
    await db.queue.update(job.id, { status: 'error', error: 'Game no longer exists.', updatedAt: Date.now() });
    return;
  }
  const engine = await enginePool.get(slot);
  useRunner.getState().set({ engineName: engine.name });
  const settingsKey = settingsKeyFor(engine.name, settings);
  const existingRows = await db.rawResults.where('gameId').equals(game.id).toArray();
  const existing: StoredRaw[] = existingRows.filter((r) => r.settingsKey === settingsKey).map((r) => ({ index: r.index, stage: r.stage, result: r.result }));
  const entry = { ctrl: new AbortController(), reason: null as StopReason | null };
  controllers.set(job.id, entry);
  const startedAt = Date.now();
  let lastWrite = 0;

  const onProgress = (p: GameAnalyzerProgress) => {
    const live = { ...useRunner.getState().live, [job.id]: { ...p, jobId: job.id, gameId: game.id, engine: engine.name } };
    useRunner.getState().set({ live });
    if (Date.now() - lastWrite > 1000 || p.stage === 'review') {
      lastWrite = Date.now();
      db.queue
        .update(job.id, { stage: p.stage, positionsDone: p.positionsDone, positionsTotal: p.positionsTotal, deepDone: p.deepDone, deepTotal: p.deepTotal, currentDepth: p.currentDepth, updatedAt: Date.now() })
        .catch(() => undefined);
    }
  };

  try {
    await engine.newGame();
    const deepSides = game.userColor ? [game.userColor] : undefined;
    const out = await analyzeGame({
      game,
      settings,
      thresholds: appSettings.thresholds,
      signal: entry.ctrl.signal,
      existing,
      deepSides,
      onProgress,
      analyze: (r) =>
        cachedAnalyze(engine, { fen: r.fen, depth: r.depth, multiPv: r.multiPv, moveTimeMs: r.moveTimeMs || undefined, signal: r.signal }, { cloud: appSettings.cloudEval && r.stage === 'deep' }),
      persistRaw: async (raw) => {
        await db.rawResults.put({ key: `${game.id}|${settingsKey}|${raw.index}|${raw.stage}`, gameId: game.id, settingsKey, index: raw.index, stage: raw.stage, result: raw.result });
      },
    });
    const analysis: Analysis = {
      id: out.analysisId,
      gameId: game.id,
      engineVersion: out.engineVersion,
      analysisSettings: settings,
      status: 'complete',
      startedAt,
      completedAt: Date.now(),
      whiteAccuracy: out.whiteAccuracy,
      blackAccuracy: out.blackAccuracy,
      error: null,
    };
    await saveCompletedAnalysis(analysis, out.positions, out.mistakes);
    await db.rawResults.where('gameId').equals(game.id).delete();
    await db.queue.update(job.id, { status: 'done', stage: 'review', analysisId: analysis.id, updatedAt: Date.now() });
  } catch (e) {
    const reason = entry.reason;
    if (reason === 'pause') {
      await db.queue.update(job.id, { status: 'paused', updatedAt: Date.now() });
    } else if (reason === 'cancel' || e instanceof AbortedError) {
      await db.rawResults.where('gameId').equals(game.id).delete();
      await db.queue.update(job.id, { status: 'cancelled', updatedAt: Date.now() });
    } else {
      const msg = (e as { name?: string })?.name?.includes('Error') && /Quota|Dexie|IndexedDB/i.test(String((e as Error).message)) ? describeStorageError(e) : (e as Error)?.message ?? String(e);
      await db.queue.update(job.id, { status: 'error', error: msg, updatedAt: Date.now() }).catch(() => undefined);
      useRunner.getState().set({ lastError: msg });
      // Restart the engine after unexpected failures so later jobs start clean.
      enginePool.terminateAll();
    }
  } finally {
    controllers.delete(job.id);
    const live = { ...useRunner.getState().live };
    delete live[job.id];
    useRunner.getState().set({ live });
  }
}

async function loop(slot: number) {
  loopsActive++;
  try {
    while (true) {
      const job = await claimNextJob();
      if (!job) break;
      await runJob(job, slot);
    }
  } finally {
    loopsActive--;
    if (loopsActive === 0) {
      useRunner.getState().set({ running: false });
      releaseWakeLock();
      backgroundAnalysis.stop();
    }
  }
}

/** Start processing queued jobs (explicit user action). Safe to call repeatedly. */
export async function startQueue(): Promise<void> {
  if (loopsActive > 0) return;
  const s = await getSettings();
  await enginePool.configure(s.engineFlavor, s.maxEngines);
  useRunner.getState().set({ running: true, lastError: null });
  acquireWakeLock();
  backgroundAnalysis.start();
  const n = enginePool.size;
  for (let i = 0; i < n; i++) void loop(i);
}

export async function pauseAll(): Promise<void> {
  for (const [, c] of controllers) {
    c.reason = 'pause';
    c.ctrl.abort();
  }
  await db.queue.where('status').equals('queued').modify({ status: 'paused', updatedAt: Date.now() });
}

export async function resumeAll(): Promise<void> {
  await db.queue.where('status').equals('paused').modify({ status: 'queued', updatedAt: Date.now() });
  await startQueue();
}

export async function cancelJob(jobId: string): Promise<void> {
  const c = controllers.get(jobId);
  if (c) {
    c.reason = 'cancel';
    c.ctrl.abort();
    return;
  }
  const job = await db.queue.get(jobId);
  if (job && job.status !== 'done') {
    await db.rawResults.where('gameId').equals(job.gameId).delete();
    await db.queue.update(jobId, { status: 'cancelled', updatedAt: Date.now() });
  }
}

export async function cancelAll(): Promise<void> {
  for (const [, c] of controllers) {
    c.reason = 'cancel';
    c.ctrl.abort();
  }
  const pending = await db.queue.where('status').anyOf('queued', 'paused').toArray();
  for (const j of pending) await cancelJob(j.id);
}

export async function retryJob(jobId: string): Promise<void> {
  await db.queue.update(jobId, { status: 'queued', error: null, updatedAt: Date.now() });
}
