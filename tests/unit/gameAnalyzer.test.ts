import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzeGame, type StoredRaw } from '@/engine/scheduler/gameAnalyzer';
import { parseSingleGame, toGame } from '@/chess/pgn/parsePgn';
import { UciEngine } from '@/engine/stockfish/engine';
import type { AnalysisSettings } from '@/types';
import { createNodeTransport } from '../nodeEngine';
import { LEGAL_MATE, OPERA_GAME, SCHOLARS_MATE } from '../fixtures/games';

const settings: AnalysisSettings = { preset: 'fast', screeningDepth: 10, screeningMoveTimeMs: 0, deepDepth: 14, deepMoveTimeMs: 0, multiPv: 2 };

describe('Full game analysis with real Stockfish', () => {
  let engine: UciEngine;
  beforeAll(async () => {
    engine = new UciEngine(createNodeTransport, { hashMb: 32 });
    await engine.init();
  });
  afterAll(() => engine.terminate());
  const analyze = (r: { fen: string; depth: number; multiPv: number; moveTimeMs: number; signal?: AbortSignal }) =>
    engine.analyze({ fen: r.fen, depth: r.depth, multiPv: r.multiPv, moveTimeMs: r.moveTimeMs || undefined, signal: r.signal });

  it("detects Black's blunder in the Scholar's mate and categorizes it as allowing mate", async () => {
    const game = toGame(parseSingleGame(SCHOLARS_MATE), { usernames: ['bob'] });
    const out = await analyzeGame({ game, settings, analyze });
    expect(out.positions).toHaveLength(7);
    const nf6 = out.positions[5];
    expect(nf6.actualSan).toBe('Nf6');
    expect(nf6.classification).toBe('blunder');
    expect(nf6.evaluationAfter).toEqual({ kind: 'mate', value: 1 });
    expect(nf6.stage).toBe('deep');
    const m = out.mistakes.find((x) => x.ply === 5)!;
    expect(m.category).toBe('king-safety');
    expect(m.isUserMove).toBe(true);
    expect(out.positions[6].classification).toBe('best'); // Qxf7#
    expect(out.positions[0].classification).toBe('book');
  });

  it('finds the decisive blunder in Legal\'s mate', async () => {
    const game = toGame(parseSingleGame(LEGAL_MATE));
    const out = await analyzeGame({ game, settings, analyze });
    const bxd1 = out.positions.find((p) => p.actualSan === 'Bxd1')!;
    expect(['mistake', 'blunder']).toContain(bxd1.classification);
    expect(out.mistakes.some((m) => m.ply === bxd1.ply && m.category === 'king-safety')).toBe(true);
  });

  it('reviews the Opera Game with consistent evaluations and accuracy', async () => {
    const game = toGame(parseSingleGame(OPERA_GAME));
    const progress: string[] = [];
    const persisted: StoredRaw[] = [];
    const out = await analyzeGame({ game, settings, analyze, persistRaw: async (r) => void persisted.push(r), onProgress: (p) => progress.push(p.stage) });
    expect(out.positions).toHaveLength(33);
    expect(progress).toContain('screening');
    expect(progress).toContain('deep');
    expect(progress[progress.length - 1]).toBe('review');
    expect(out.whiteAccuracy).not.toBeNull();
    expect(out.whiteAccuracy!).toBeGreaterThan(out.blackAccuracy!);
    // Final move is checkmate.
    expect(out.positions[32].evaluationAfter).toEqual({ kind: 'mate', value: 0, matedSide: 'b' });
    expect(persisted.length).toBeGreaterThanOrEqual(34);
    for (const p of out.positions) {
      expect(p.confidence).not.toBeNull();
      expect(p.bestMove === null || /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(p.bestMove)).toBe(true);
    }

    // Resume: re-running with persisted raw results performs no new engine work.
    let calls = 0;
    const out2 = await analyzeGame({ game, settings, analyze: async (r) => { calls++; return analyze(r); }, existing: persisted });
    expect(calls).toBe(0);
    expect(out2.positions.map((p) => p.classification)).toEqual(out.positions.map((p) => p.classification));
  });

  it('can be cancelled', async () => {
    const game = toGame(parseSingleGame(OPERA_GAME));
    const ctrl = new AbortController();
    const p = analyzeGame({ game, settings: { ...settings, screeningDepth: 30 }, analyze, signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 200);
    await expect(p).rejects.toThrow();
    // Engine still usable afterwards.
    const r = await engine.analyze({ fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', depth: 6 });
    expect(r.bestMove).toBe('a1a8');
  });
});
