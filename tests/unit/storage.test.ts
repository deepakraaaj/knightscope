import { afterEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { KnightScopeDB } from '@/storage/database/db';
import { addGames, enqueueGames, recoverInterruptedJobs, saveCompletedAnalysis, saveExercise, exportAll, importAll, getSettings, saveSettings, refreshUserColors } from '@/storage/repositories';
import { parseSingleGame, toGame } from '@/chess/pgn/parsePgn';
import { OPERA_GAME, SCHOLARS_MATE } from '../fixtures/games';
import type { Analysis, Mistake } from '@/types';

let n = 0;
const fresh = () => new KnightScopeDB(`test-${Date.now()}-${n++}`);
const dbs: KnightScopeDB[] = [];
afterEach(async () => {
  for (const d of dbs.splice(0)) await d.delete();
});
function mk() {
  const d = fresh();
  dbs.push(d);
  return d;
}

const mistake = (gameId: string, ply: number): Mistake => ({
  id: `${gameId}:${ply}`, gameId, analysisId: 'an1', positionId: `an1:${ply}`, ply, moveNumber: 3, fen: 'x', playerColor: 'b', actualMove: 'g8f6', actualSan: 'Nf6',
  bestMove: 'g7g6', bestSan: 'g6', evaluationBefore: { kind: 'cp', value: 0 }, evaluationAfter: { kind: 'mate', value: 1 }, winPercentLoss: 50, severity: 'blunder',
  category: 'king-safety', motifs: [], verified: true, detectionMethod: 'x', phase: 'opening', opening: null, timeClass: 'rapid', confidence: 'stable', gameDate: null, createdAt: 1, isUserMove: false,
});

describe('Repositories', () => {
  it('prevents duplicate game imports', async () => {
    const d = mk();
    const g = toGame(parseSingleGame(OPERA_GAME));
    const first = await addGames([g, g], d);
    expect(first.added).toHaveLength(1);
    expect(first.duplicates).toBe(1);
    const second = await addGames([toGame(parseSingleGame(OPERA_GAME)), toGame(parseSingleGame(SCHOLARS_MATE))], d);
    expect(second.added).toHaveLength(1);
    expect(await d.games.count()).toBe(2);
  });

  it('persists mistakes with a review and replaces them on re-analysis without deleting exercises', async () => {
    const d = mk();
    const g = toGame(parseSingleGame(SCHOLARS_MATE));
    await addGames([g], d);
    const an = (id: string): Analysis => ({ id, gameId: g.id, engineVersion: 'Stockfish 19', analysisSettings: { preset: 'fast', screeningDepth: 10, deepDepth: 14, screeningMoveTimeMs: 0, deepMoveTimeMs: 0, multiPv: 2 }, status: 'complete', startedAt: 1, completedAt: 2, whiteAccuracy: 90, blackAccuracy: 40, error: null });
    await saveCompletedAnalysis(an('an1'), [], [mistake(g.id, 5)], d);
    expect(await d.mistakes.where('gameId').equals(g.id).count()).toBe(1);
    await saveExercise({ id: 'ex1', sourceMistakeId: `${g.id}:5`, gameId: g.id, fen: 'x', sideToMove: 'b', kind: 'best-move', goal: '', solution: [], solutionEval: { kind: 'cp', value: 0 }, requiredUserMoves: 1, mateIn: null, category: 'king-safety', difficulty: 1, createdAt: 0, nextReviewAt: 0, box: 0, attempts: 0, successes: 0, lastResult: null }, d);
    const dup = await saveExercise({ ...(await d.exercises.get('ex1'))!, id: 'ex2' }, d);
    expect(dup.created).toBe(false);
    await saveCompletedAnalysis({ ...an('an2'), completedAt: 3 }, [], [mistake(g.id, 5)], d);
    expect(await d.analyses.count()).toBe(1);
    expect(await d.exercises.count()).toBe(1);
    expect((await d.mistakes.toArray())[0].id).toBe(`${g.id}:5`);
  });

  it('recovers jobs left running by an interrupted session', async () => {
    const d = mk();
    expect(await enqueueGames(['a', 'b'], 'fast', d)).toBe(2);
    expect(await enqueueGames(['a'], 'fast', d)).toBe(0); // already queued
    const [j] = await d.queue.toArray();
    await d.queue.update(j.id, { status: 'running' });
    expect(await recoverInterruptedJobs(d)).toBe(1);
    expect((await d.queue.get(j.id))!.status).toBe('paused');
  });

  it('exports and re-imports data without overwriting existing records', async () => {
    const a = mk();
    await addGames([toGame(parseSingleGame(OPERA_GAME))], a);
    await saveSettings({ explanationLevel: 'beginner' }, a);
    const json = await exportAll(a);
    const b = mk();
    const counts = await importAll(json, b);
    expect(counts.games).toBe(1);
    expect((await getSettings(b)).explanationLevel).toBe('beginner');
    expect((await importAll(json, b)).games).toBe(0);
    await expect(importAll('{"format":"other"}', b)).rejects.toThrow(/not a KnightScope backup/);
  });

  it('re-derives user color when usernames change', async () => {
    const d = mk();
    await addGames([toGame(parseSingleGame(SCHOLARS_MATE))], d);
    await d.mistakes.put(mistake((await d.games.toArray())[0].id, 5));
    await refreshUserColors(['bob'], d);
    expect((await d.games.toArray())[0].userColor).toBe('b');
    expect((await d.mistakes.toArray())[0].isUserMove).toBe(true);
  });
});

describe('IndexedDB migrations', () => {
  it('upgrades a v1 database to the current schema and backfills fields', async () => {
    const name = `migrate-${Date.now()}`;
    const v1 = new Dexie(name);
    v1.version(1).stores({
      games: 'id, source, date, importedAt, timeClass', analyses: 'id, gameId, status, completedAt', positions: 'id, analysisId, gameId',
      mistakes: 'id, gameId, analysisId, category, createdAt', exercises: 'id, sourceMistakeId, nextReviewAt, category', attempts: 'id, exerciseId, attemptedAt',
      settings: 'id', queue: 'id, gameId, status, createdAt',
    });
    const legacy = toGame(parseSingleGame(OPERA_GAME)) as Partial<ReturnType<typeof toGame>>;
    delete legacy.userColor;
    await v1.table('games').add(legacy);
    await v1.table('mistakes').add({ ...mistake('g', 1), isUserMove: undefined });
    v1.close();

    const current = new KnightScopeDB(name);
    dbs.push(current);
    await current.open();
    expect(current.verno).toBe(2);
    const g = (await current.games.toArray())[0];
    expect(g.userColor).toBeNull();
    expect(await current.games.where('userColor').equals('w').count()).toBe(0);
    expect((await current.mistakes.toArray())[0].isUserMove).toBe(false);
    await current.engineCache.put({ key: 'k', depth: 10, result: {} as never, updatedAt: 1 });
    expect(await current.engineCache.count()).toBe(1);
  });
});
