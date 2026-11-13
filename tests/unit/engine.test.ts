import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UciEngine, AbortedError } from '@/engine/stockfish/engine';
import { createNodeTransport } from '../nodeEngine';

// These tests run the REAL Stockfish 19 lite WASM engine (no mocked output).
describe('UciEngine with real Stockfish', () => {
  let engine: UciEngine;
  beforeAll(async () => {
    engine = new UciEngine(createNodeTransport, { hashMb: 16 });
    await engine.init();
  });
  afterAll(() => engine.terminate());

  it('initializes and reports engine identity', () => {
    expect(engine.name).toMatch(/Stockfish/i);
  });

  it('finds mate in 1 with a White-positive mate score', async () => {
    // White: Kg1, Ra1; Black: Kg8 behind pawns f7 g7 h7. Ra8# is mate in 1.
    const r = await engine.analyze({ fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', depth: 8 });
    expect(r.bestMove).toBe('a1a8');
    expect(r.lines[0].eval).toEqual({ kind: 'mate', value: 1 });
  });

  it('normalizes mate scores to White perspective when Black mates', async () => {
    const r = await engine.analyze({ fen: 'r5k1/8/8/8/8/8/5PPP/6K1 b - - 0 1', depth: 8 });
    expect(r.bestMove).toBe('a8a1');
    expect(r.lines[0].eval).toEqual({ kind: 'mate', value: -1 });
  });

  it('returns MultiPV lines ordered by rank', async () => {
    const r = await engine.analyze({ fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', depth: 8, multiPv: 3 });
    expect(r.lines.map((l) => l.multipv)).toEqual([1, 2, 3]);
    expect(r.depth).toBeGreaterThanOrEqual(8);
    expect(Object.keys(r.bestMoveByDepth).length).toBeGreaterThan(3);
  });

  it('reports a checkmated position without a best move', async () => {
    // Fool's mate final position, White to move and checkmated.
    const r = await engine.analyze({ fen: 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3', depth: 5 });
    expect(r.bestMove).toBeNull();
    expect(r.lines[0]?.eval).toEqual({ kind: 'mate', value: 0, matedSide: 'w' });
  });

  it('cancels a long search and keeps later results attributed to the right position', async () => {
    const ctrl = new AbortController();
    const long = engine.analyze({ fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3', depth: 40, signal: ctrl.signal });
    const next = engine.analyze({ fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', depth: 6 });
    setTimeout(() => ctrl.abort(), 300);
    await expect(long).rejects.toBeInstanceOf(AbortedError);
    const r = await next;
    expect(r.fen).toBe('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
    expect(r.bestMove).toBe('a1a8');
  });

  it('respects a movetime cap', async () => {
    const t0 = Date.now();
    const r = await engine.analyze({ fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3', depth: 60, moveTimeMs: 400 });
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(r.bestMove).toMatch(/^[a-h][1-8][a-h][1-8]/);
  });

  it('restarts cleanly', async () => {
    await engine.restart();
    const r = await engine.analyze({ fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', depth: 6 });
    expect(r.bestMove).toBe('a1a8');
  });
});
