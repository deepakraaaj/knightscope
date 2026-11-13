import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exerciseFromMistake, schedule, validateStep } from '@/features/training/logic';
import { UciEngine } from '@/engine/stockfish/engine';
import type { Mistake, TrainingExercise } from '@/types';
import { createNodeTransport } from '../nodeEngine';

const mk = (over: Partial<Mistake>): Mistake => ({
  id: 'g:1', gameId: 'g', analysisId: 'a', positionId: 'p', ply: 1, moveNumber: 1, fen: '', playerColor: 'w', actualMove: '', actualSan: '', bestMove: '', bestSan: '',
  evaluationBefore: { kind: 'cp', value: 0 }, evaluationAfter: { kind: 'cp', value: 0 }, winPercentLoss: 30, severity: 'blunder', category: 'other', motifs: [], verified: false,
  detectionMethod: 'none', phase: 'middlegame', opening: null, timeClass: 'blitz', confidence: 'stable', gameDate: null, createdAt: 0, isUserMove: true, ...over,
});

describe('Training exercise creation', () => {
  it('creates a mate exercise from a missed mate', () => {
    const ex = exerciseFromMistake(mk({ fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', bestMove: 'a1a8', bestSan: 'Ra8#', actualSan: 'Kf1', evaluationBefore: { kind: 'mate', value: 1 } }), undefined)!;
    expect(ex.kind).toBe('mate');
    expect(ex.mateIn).toBe(1);
    expect(ex.goal).toBe('White to move. Find checkmate in 1.');
    expect(ex.goal).not.toContain('Ra8');
  });
  it('creates a tactic exercise when the line wins material', () => {
    const ex = exerciseFromMistake(mk({ fen: 'r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1', bestMove: 'd5c7', bestSan: 'Nc7+', actualSan: 'Ke2', evaluationBefore: { kind: 'cp', value: 500 } }), { principalVariation: ['d5c7', 'e8d7', 'c7a8'] } as never)!;
    expect(ex.kind).toBe('tactic');
    expect(ex.requiredUserMoves).toBe(2);
    expect(ex.solution).toEqual(['d5c7', 'e8d7', 'c7a8']);
  });
  it('rejects mistakes whose best move is illegal in the position', () => {
    expect(exerciseFromMistake(mk({ fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', bestMove: 'a1h8' }), undefined)).toBeNull();
  });
});

describe('Spaced repetition', () => {
  it('advances on success and resets on failure', () => {
    expect(schedule({ box: 0 }, true, 0)).toEqual({ box: 1, nextReviewAt: 86_400_000 });
    expect(schedule({ box: 5 }, true, 0).box).toBe(5);
    expect(schedule({ box: 3 }, false, 0)).toEqual({ box: 0, nextReviewAt: 600_000 });
  });
});

describe('Training move validation (real Stockfish)', () => {
  let engine: UciEngine;
  beforeAll(async () => {
    engine = new UciEngine(createNodeTransport);
    await engine.init();
  });
  afterAll(() => engine.terminate());
  const analyze = (r: { fen: string; depth: number; multiPv?: number }) => engine.analyze(r);
  const opts = { depth: 12, acceptanceWinLoss: 4 };

  const mateEx = exerciseFromMistake(mk({ fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', bestMove: 'a1a8', evaluationBefore: { kind: 'mate', value: 1 } }), undefined)!;

  it('accepts the mating move', async () => {
    const v = await validateStep(mateEx, mateEx.fen, 'a1a8', 0, analyze, opts);
    expect(v).toMatchObject({ legal: true, accepted: true, complete: true });
  });
  it('rejects a non-mating move in a mate exercise', async () => {
    const v = await validateStep(mateEx, mateEx.fen, 'a1a7', 0, analyze, opts);
    expect(v.accepted).toBe(false);
  });
  it('rejects illegal moves', async () => {
    const v = await validateStep(mateEx, mateEx.fen, 'a1h8', 0, analyze, opts);
    expect(v).toMatchObject({ legal: false, accepted: false });
  });

  it('accepts an equivalent alternative to the engine move', async () => {
    // Start position: 1.e4 and 1.d4 are both within a few win% of each other.
    const ex: TrainingExercise = { ...mateEx, kind: 'best-move', mateIn: null, requiredUserMoves: 1, fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', sideToMove: 'w' };
    const a = await validateStep(ex, ex.fen, 'e2e4', 0, analyze, opts);
    const b = await validateStep(ex, ex.fen, 'd2d4', 0, analyze, opts);
    expect(a.accepted && b.accepted).toBe(true);
    const bad = await validateStep(ex, ex.fen, 'g2g4', 0, analyze, { ...opts, acceptanceWinLoss: 3 });
    expect(bad.accepted).toBe(false);
  });

  it('plays the opponent reply and continues a multi-move tactic', async () => {
    const ex = exerciseFromMistake(mk({ fen: 'r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1', bestMove: 'd5c7', evaluationBefore: { kind: 'cp', value: 500 } }), { principalVariation: ['d5c7', 'e8d7', 'c7a8'] } as never)!;
    const s1 = await validateStep(ex, ex.fen, 'd5c7', 0, analyze, opts);
    expect(s1.accepted).toBe(true);
    expect(s1.complete).toBe(false);
    expect(s1.fenAfterReply).not.toBeNull();
    const s2 = await validateStep(ex, s1.fenAfterReply!, 'c7a8', 1, analyze, opts);
    expect(s2).toMatchObject({ accepted: true, complete: true });
  });
});

describe('Training validation draw handling (real Stockfish)', () => {
  let engine: UciEngine;
  beforeAll(async () => {
    engine = new UciEngine(createNodeTransport);
    await engine.init();
  });
  afterAll(() => engine.terminate());
  it('rejects a stalemating move in a mate exercise', async () => {
    // White Qb6 stalemates the black king on a8 (Kb... K on c7 covers b7/b8).
    const ex: TrainingExercise = exerciseFromMistake(mk({ fen: 'k7/8/2K5/8/8/8/8/1Q6 w - - 0 1', bestMove: 'b1b7', evaluationBefore: { kind: 'mate', value: 1 } }), undefined)!;
    const v = await validateStep(ex, ex.fen, 'b1b6', 0, (r) => engine.analyze(r), { depth: 10, acceptanceWinLoss: 4 });
    expect(v.accepted).toBe(false);
    expect(v.message).toMatch(/draw/);
  });
});
