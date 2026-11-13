import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectFork, detectLineTactic, isBackRankMate, detectTactics, categorize, materialSwing } from '@/chess/tactics/detect';
import { applyUci } from '@/chess/positions/board';
import { UciEngine } from '@/engine/stockfish/engine';
import { createNodeTransport } from '../nodeEngine';

describe('Tactical geometry', () => {
  it('detects a knight fork of king and rook', () => {
    const after = applyUci('r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1', 'd5c7')!.chess.fen();
    const f = detectFork(after, 'c7', 'w');
    expect(f?.targets.map((t) => t.type).sort()).toEqual(['k', 'r']);
  });
  it('does not call a single attack a fork', () => {
    const after = applyUci('4k3/8/8/3N4/8/8/8/4K3 w - - 0 1', 'd5c7')!.chess.fen();
    expect(detectFork(after, 'c7', 'w')).toBeNull();
  });
  it('detects an absolute pin', () => {
    const r = detectLineTactic('4k3/8/2n5/1B6/8/8/8/4K3 b - - 0 1', 'b5', 'w');
    expect(r).toMatchObject({ kind: 'pin', front: 'c6', back: 'e8' });
  });
  it('detects a skewer through the king', () => {
    const r = detectLineTactic('3q4/8/8/3k4/8/8/8/3RK3 b - - 0 1', 'd1', 'w');
    expect(r).toMatchObject({ kind: 'skewer', front: 'd5', back: 'd8' });
  });
  it('verifies a back-rank mate geometrically', () => {
    expect(isBackRankMate('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', ['a1a8'], 'b')).not.toBeNull();
    // With an escape square (h7 empty) the same rook check is not mate.
    expect(isBackRankMate('6k1/5pp1/8/8/8/8/8/R5K1 w - - 0 1', ['a1a8'], 'b')).toBeNull();
  });
  it('measures material swing along a line', () => {
    expect(materialSwing('r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1', ['d5c7', 'e8d7', 'c7a8'], 'w').swing).toBe(5);
  });
});

describe('Tactic detection on engine lines (real Stockfish)', () => {
  let engine: UciEngine;
  beforeAll(async () => {
    engine = new UciEngine(createNodeTransport);
    await engine.init();
  });
  afterAll(() => engine.terminate());

  async function context(fenBefore: string, actual: string, mover: 'w' | 'b') {
    const before = await engine.analyze({ fen: fenBefore, depth: 14 });
    const fenAfter = applyUci(fenBefore, actual)!.chess.fen();
    const after = await engine.analyze({ fen: fenAfter, depth: 14 });
    return {
      fenBefore, mover, actualMove: actual, bestMove: before.bestMove, bestLine: before.lines[0].moves, replyLine: after.lines[0].moves,
      evalBefore: before.lines[0].eval, evalAfter: after.lines[0].eval, phase: 'middlegame' as const, ply: 20,
    };
  }

  it('flags a hanging queen as a hanging piece', async () => {
    // After 1.e4 e5 2.Nf3, Black plays 2...Qg5?? and the knight captures the queen.
    const ctx = await context('rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2', 'd8g5', 'b');
    const findings = detectTactics(ctx);
    expect(findings.some((f) => f.motif === 'hanging-piece' && f.side === 'allowed' && f.squares.includes('g5'))).toBe(true);
    expect(categorize(findings, ctx).category).toBe('hanging-piece');
  });

  it('flags a missed knight fork', async () => {
    const ctx = await context('r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1', 'e1e2', 'w');
    const findings = detectTactics(ctx);
    expect(ctx.bestMove).toBe('d5c7');
    expect(findings.some((f) => f.motif === 'fork' && f.side === 'missed')).toBe(true);
    expect(categorize(findings, ctx).category).toBe('missed-fork');
  });

  it('flags a missed mate in one', async () => {
    const ctx = await context('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', 'g1f1', 'w');
    const findings = detectTactics(ctx);
    expect(findings.find((f) => f.motif === 'mate' && f.side === 'missed')?.mateIn).toBe(1);
    expect(categorize(findings, ctx).category).toBe('missed-checkmate');
  });

  it('flags an allowed back-rank mate', async () => {
    // Black's rook leaves the back rank; White mates with Re8#.
    const ctx = await context('3r2k1/5ppp/8/8/8/8/5PPP/4R1K1 b - - 0 1', 'd8d2', 'b');
    const findings = detectTactics(ctx);
    expect(findings.some((f) => f.motif === 'back-rank-mate' && f.side === 'allowed')).toBe(true);
    expect(categorize(findings, ctx).category).toBe('back-rank-weakness');
  });

  it('returns no category when nothing is verified', () => {
    expect(categorize([], { phase: 'middlegame', mover: 'w', evalBefore: { kind: 'cp', value: 30 }, evalAfter: { kind: 'cp', value: -60 } }))
      .toEqual({ category: 'other', verified: false, detectionMethod: 'none' });
  });
});
