import { describe, expect, it } from 'vitest';
import { improvementComparison, learningPriorities, trainingTransfer, weaknessStats, filterGames, EMPTY_FILTERS, buildDailySession, relevantMistakes } from '@/features/analytics/aggregate';
import type { Analysis, Game, Mistake, MistakeCategory, TrainingAttempt, TrainingExercise } from '@/types';

const game = (i: number, over: Partial<Game> = {}): Game => ({
  id: `g${i}`, source: 'lichess', sourceGameId: `${i}`, pgn: '', white: 'me', black: `opp${i}`, whiteElo: 1500, blackElo: 1400 + i, result: i % 2 ? '1-0' : '0-1',
  date: `2024-01-${String(i + 1).padStart(2, '0')}`, timeControl: '300+0', timeClass: 'blitz', opening: 'Italian Game', eco: 'C50', plyCount: 60, importedAt: i, userColor: 'w', url: null, ...over,
});
const analysis = (gameId: string): Analysis => ({ id: `a-${gameId}`, gameId, engineVersion: 'sf', analysisSettings: { preset: 'balanced', screeningDepth: 12, deepDepth: 18, screeningMoveTimeMs: 0, deepMoveTimeMs: 0, multiPv: 2 }, status: 'complete', startedAt: 0, completedAt: 1, whiteAccuracy: 80, blackAccuracy: 70, error: null });
const mistake = (gameId: string, category: MistakeCategory, ply = 10, color: 'w' | 'b' = 'w'): Mistake => ({
  id: `${gameId}:${ply}`, gameId, analysisId: 'a', positionId: 'p', ply, moveNumber: 6, fen: 'x', playerColor: color, actualMove: 'a', actualSan: 'a', bestMove: 'b', bestSan: 'b',
  evaluationBefore: { kind: 'cp', value: 0 }, evaluationAfter: { kind: 'cp', value: -300 }, winPercentLoss: 25, severity: 'blunder', category, motifs: [], verified: true, detectionMethod: 'x',
  phase: 'middlegame', opening: null, timeClass: 'blitz', confidence: 'stable', gameDate: null, createdAt: 0, isUserMove: color === 'w',
});

describe('Analytics aggregation', () => {
  const games = Array.from({ length: 20 }, (_, i) => game(i));
  const analyses = new Map(games.map((g) => [g.id, analysis(g.id)]));
  // 6 hanging-piece mistakes in the first 10 games, 1 in the last 10.
  const mistakes = [...[0, 1, 2, 3, 4, 5].map((i) => mistake(`g${i}`, 'hanging-piece')), mistake('g15', 'hanging-piece'), mistake('g16', 'missed-fork'), mistake('g16', 'missed-fork', 12)];

  it('counts weaknesses from real records only', () => {
    expect(weaknessStats([], new Map())).toEqual([]);
    const s = weaknessStats(mistakes, new Map());
    expect(s[0]).toMatchObject({ category: 'hanging-piece', count: 7, games: 7, verifiedCount: 7 });
    expect(s[1]).toMatchObject({ category: 'missed-fork', count: 2, games: 1 });
  });

  it('keeps only the user side when a username is configured', () => {
    const ms = [mistake('g1', 'hanging-piece', 10, 'w'), mistake('g1', 'missed-fork', 11, 'b')];
    expect(relevantMistakes(ms, [game(1)]).map((m) => m.category)).toEqual(['hanging-piece']);
    expect(relevantMistakes(ms, [game(1, { userColor: null })])).toHaveLength(2);
  });

  it('compares previous and recent windows with context', () => {
    const rows = improvementComparison(games, mistakes, analyses, 10);
    const hp = rows.find((r) => r.category === 'hanging-piece')!;
    expect(hp.previous.occurrences).toBe(6);
    expect(hp.recent.occurrences).toBe(1);
    expect(hp.verdict).toBe('fewer');
    expect(hp.message).toMatch(/^Fewer hanging pieces mistakes were detected/);
    expect(hp.recent.games).toBe(10);
    expect(hp.recent.opponentRating).toEqual({ min: 1410, max: 1419 });
    expect(hp.recent.presets).toEqual(['balanced']);
  });

  it('refuses to compare with too few games', () => {
    const rows = improvementComparison(games.slice(0, 6), mistakes, analyses, 20);
    expect(rows.every((r) => r.verdict === 'insufficient')).toBe(true);
  });

  it('measures training performance and in-game recurrence separately', () => {
    const ex: TrainingExercise = { id: 'e', sourceMistakeId: null, gameId: null, fen: 'x', sideToMove: 'w', kind: 'tactic', goal: '', solution: [], solutionEval: { kind: 'cp', value: 0 }, requiredUserMoves: 1, mateIn: null, category: 'hanging-piece', difficulty: 1, createdAt: 0, nextReviewAt: 0, box: 0, attempts: 0, successes: 0, lastResult: null };
    const trainedAt = Date.parse('2024-01-10T23:00:00Z');
    const attempts: TrainingAttempt[] = [true, true, true, true].map((c, i) => ({ id: `t${i}`, exerciseId: 'e', fen: 'x', attemptedMoves: [], correct: c, usedHint: false, revealedSolution: false, timeSpentMs: 1, attemptedAt: trainedAt + i, category: 'hanging-piece', engineSettings: { depth: 12, engineId: 'sf', acceptanceWinLoss: 4 } }));
    const [t] = trainingTransfer(games, mistakes, analyses, [ex], attempts);
    expect(t.solveRate).toBe(1);
    expect(t.gamesBefore).toBe(10);
    expect(t.gamesAfter).toBe(10);
    expect(t.rateBefore).toBeCloseTo(0.6);
    expect(t.rateAfter).toBeCloseTo(0.1);
  });

  it('ranks learning priorities deterministically with reasons', () => {
    const p = learningPriorities(games, mistakes, analyses, [], []);
    expect(p[0].category).toBe('hanging-piece');
    expect(p[0].reasons.join(' ')).toMatch(/occurrence/);
    expect(learningPriorities(games, [], analyses, [], [])).toEqual([]);
  });

  it('filters games', () => {
    expect(filterGames(games, { ...EMPTY_FILTERS, result: 'win' }).length).toBe(10);
    expect(filterGames(games, { ...EMPTY_FILTERS, from: '2024-01-15' }).length).toBe(6);
    expect(filterGames(games, { ...EMPTY_FILTERS, source: 'chesscom' }).length).toBe(0);
  });

  it('reports when there are not enough exercises for a session', () => {
    expect(buildDailySession(10, [], []).note).toMatch(/no training exercises/);
  });
});
