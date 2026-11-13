import { describe, expect, it } from 'vitest';
import { normalizeScore, winPercentWhite, winPercentFor, forPlayer, mateFor, evalToCp } from '@/chess/positions/evaluation';
import { parseInfoLine, parseBestMove } from '@/engine/uci/parse';
import { moveAccuracy, gameAccuracy } from '@/chess/accuracy/accuracy';
import { formatEval } from '@/utils/format';

describe('UCI parsing', () => {
  it('parses a full info line', () => {
    const i = parseInfoLine('info depth 18 seldepth 25 multipv 2 score cp -34 nodes 123456 nps 800000 hashfull 12 time 154 pv e7e5 g1f3 b8c6');
    expect(i).toMatchObject({ depth: 18, seldepth: 25, multipv: 2, score: { kind: 'cp', value: -34 }, bound: null, pv: ['e7e5', 'g1f3', 'b8c6'], nodes: 123456 });
  });
  it('parses mate scores and bounds', () => {
    expect(parseInfoLine('info depth 5 score mate -3 lowerbound pv a1a8')).toMatchObject({ score: { kind: 'mate', value: -3 }, bound: 'lower' });
    expect(parseInfoLine('info depth 0 score mate 0')).toMatchObject({ depth: 0, score: { kind: 'mate', value: 0 } });
  });
  it('ignores info strings and malformed lines', () => {
    expect(parseInfoLine('info string NNUE evaluation using nn-xyz.nnue')).toBeNull();
    expect(parseInfoLine('info depth x')).toBeNull();
    expect(parseInfoLine('readyok')).toBeNull();
  });
  it('parses bestmove', () => {
    expect(parseBestMove('bestmove e2e4 ponder e7e5')).toEqual({ bestMove: 'e2e4', ponder: 'e7e5' });
    expect(parseBestMove('bestmove (none)')).toEqual({ bestMove: null, ponder: null });
    expect(parseBestMove('bestmove e7e8q')?.bestMove).toBe('e7e8q');
  });
});

describe('Evaluation perspective normalization', () => {
  it('flips centipawns for Black to move', () => {
    expect(normalizeScore({ kind: 'cp', value: 50 }, 'w')).toEqual({ kind: 'cp', value: 50 });
    expect(normalizeScore({ kind: 'cp', value: 50 }, 'b')).toEqual({ kind: 'cp', value: -50 });
  });
  it('handles mate sign and distance', () => {
    expect(normalizeScore({ kind: 'mate', value: 3 }, 'b')).toEqual({ kind: 'mate', value: -3 });
    expect(normalizeScore({ kind: 'mate', value: -2 }, 'b')).toEqual({ kind: 'mate', value: 2 });
    expect(normalizeScore({ kind: 'mate', value: 0 }, 'b')).toEqual({ kind: 'mate', value: 0, matedSide: 'b' });
  });
  it('maps evaluations to win percentages', () => {
    expect(winPercentWhite({ kind: 'cp', value: 0 })).toBeCloseTo(50);
    expect(winPercentWhite({ kind: 'cp', value: 300 })).toBeGreaterThan(75);
    expect(winPercentWhite({ kind: 'mate', value: 4 })).toBe(100);
    expect(winPercentWhite({ kind: 'mate', value: 0, matedSide: 'w' })).toBe(0);
    expect(winPercentFor({ kind: 'mate', value: -2 }, 'b')).toBe(100);
  });
  it('orders mate scores correctly', () => {
    expect(evalToCp({ kind: 'mate', value: 1 })).toBeGreaterThan(evalToCp({ kind: 'mate', value: 5 }));
    expect(evalToCp({ kind: 'mate', value: -1 })).toBeLessThan(evalToCp({ kind: 'mate', value: -5 }));
    expect(evalToCp({ kind: 'mate', value: 5 })).toBeGreaterThan(evalToCp({ kind: 'cp', value: 900 }));
  });
  it('reports mate distance per player', () => {
    expect(mateFor({ kind: 'mate', value: -3 }, 'b')).toBe(3);
    expect(mateFor({ kind: 'mate', value: -3 }, 'w')).toBe(-3);
    expect(mateFor({ kind: 'cp', value: 10 }, 'w')).toBeNull();
    expect(forPlayer({ kind: 'cp', value: 120 }, 'b')).toEqual({ kind: 'cp', value: -120 });
  });
  it('formats evaluations', () => {
    expect(formatEval({ kind: 'cp', value: 134 })).toBe('+1.34');
    expect(formatEval({ kind: 'mate', value: -2 })).toBe('-M2');
    expect(formatEval({ kind: 'mate', value: 0, matedSide: 'b' })).toBe('1-0');
  });
});

describe('Accuracy', () => {
  it('is 100 for zero loss and decreases with loss', () => {
    expect(moveAccuracy(0)).toBeCloseTo(100, 0);
    expect(moveAccuracy(10)).toBeLessThan(moveAccuracy(5));
    expect(moveAccuracy(100)).toBe(0);
  });
  it('aggregates with mean/harmonic blend', () => {
    expect(gameAccuracy([])).toBeNull();
    expect(gameAccuracy([100, 100])).toBeCloseTo(100, 0);
    expect(gameAccuracy([100, 10])!).toBeLessThan(55);
  });
});
