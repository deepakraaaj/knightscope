import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { classifyMove, sacrificeAmount } from '@/chess/classification/classify';
import { computeConfidence } from '@/chess/classification/confidence';
import type { ConfidenceInfo, EngineResult } from '@/types';
import { OPERA_GAME } from '../fixtures/games';

const stable: ConfidenceInfo = { label: 'stable', depth: 18, bestMoveStable: true, evalStable: true, mateConsistent: true, interrupted: false, reasons: [] };
const base = {
  fenBefore: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
  mover: 'w' as const,
  actualMove: 'f1b5',
  bestMove: 'f1b5',
  evalBefore: { kind: 'cp' as const, value: 30 },
  evalAfter: { kind: 'cp' as const, value: 30 },
  secondBestEval: { kind: 'cp' as const, value: 25 },
  replyLine: [],
  isBook: false,
  legalMoveCount: 30,
  confidence: stable,
};

describe('Move classification', () => {
  it('labels the engine move as best', () => {
    expect(classifyMove(base).classification).toBe('best');
  });
  it('labels an only-move as great', () => {
    expect(classifyMove({ ...base, evalBefore: { kind: 'cp', value: 0 }, evalAfter: { kind: 'cp', value: 0 }, secondBestEval: { kind: 'cp', value: -400 } }).classification).toBe('great');
  });
  it('uses win-percentage thresholds', () => {
    const mk = (after: number) => classifyMove({ ...base, actualMove: 'b1c3', evalAfter: { kind: 'cp', value: after } });
    expect(mk(25).classification).toBe('excellent');
    expect(mk(-20).classification).toBe('good'); // ~4.6 win% loss
    expect(mk(-70).classification).toBe('inaccuracy'); // ~9 win% loss
    expect(mk(-150).classification).toBe('mistake'); // ~16 win% loss
    expect(mk(-600).classification).toBe('blunder');
  });
  it('labels book and forced moves', () => {
    expect(classifyMove({ ...base, isBook: true }).classification).toBe('book');
    expect(classifyMove({ ...base, legalMoveCount: 1, actualMove: 'b1c3' }).classification).toBe('forced');
  });
  it('treats mover perspective correctly for Black', () => {
    const r = classifyMove({ ...base, fenBefore: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 2 3', mover: 'b', actualMove: 'a7a6', bestMove: 'g8f6', evalBefore: { kind: 'cp', value: 30 }, evalAfter: { kind: 'cp', value: 600 } });
    expect(r.classification).toBe('blunder');
  });
  it('does not punish choosing a slower forced mate', () => {
    const r = classifyMove({ ...base, actualMove: 'b1c3', evalBefore: { kind: 'mate', value: 2 }, evalAfter: { kind: 'mate', value: 4 } });
    expect(r.classification).toBe('excellent');
  });
  it('treats losing a forced mate as a blunder when the advantage disappears', () => {
    expect(classifyMove({ ...base, actualMove: 'b1c3', evalBefore: { kind: 'mate', value: 2 }, evalAfter: { kind: 'cp', value: 0 } }).classification).toBe('blunder');
  });

  // Opera Game, 16.Qb8+!! — a real queen sacrifice that forces mate.
  const opera = new Chess();
  opera.loadPgn(OPERA_GAME);
  const fenBeforeQb8 = opera.history({ verbose: true })[30].before;
  const brilliantInput = { ...base, fenBefore: fenBeforeQb8, actualMove: 'b3b8', bestMove: 'b3b8', evalBefore: { kind: 'mate' as const, value: 2 }, evalAfter: { kind: 'mate' as const, value: 1 }, secondBestEval: { kind: 'cp' as const, value: 900 }, replyLine: ['d7b8', 'd1d8'] };

  it('measures the queen sacrifice', () => {
    expect(sacrificeAmount(fenBeforeQb8, 'b3b8', ['d7b8', 'd1d8'], 'w')).toBeGreaterThanOrEqual(9);
  });
  it('awards brilliant only with a stable evaluation', () => {
    expect(classifyMove(brilliantInput).classification).toBe('brilliant');
    const unstable = { ...stable, label: 'needs-deeper' as const };
    expect(classifyMove({ ...brilliantInput, confidence: unstable }).classification).not.toBe('brilliant');
    expect(classifyMove({ ...brilliantInput, confidence: { ...stable, label: 'preliminary' } }).classification).not.toBe('brilliant');
  });
  it('does not call a plain winning capture brilliant', () => {
    // Capturing a free queen is not a sacrifice.
    const r = classifyMove({ ...base, fenBefore: 'rnb1kbnr/pppp1ppp/8/4p1q1/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3', actualMove: 'f3g5', bestMove: 'f3g5', evalBefore: { kind: 'cp', value: 900 }, evalAfter: { kind: 'cp', value: 900 } });
    expect(r.classification).not.toBe('brilliant');
  });
});

describe('Analysis confidence', () => {
  const mk = (byDepth: Record<number, [string, number]>, interrupted = false): EngineResult => ({
    fen: 'x', depth: Math.max(...Object.keys(byDepth).map(Number)), lines: [], bestMove: null, interrupted, engineId: 'sf', source: 'engine',
    bestMoveByDepth: Object.fromEntries(Object.entries(byDepth).map(([d, [m]]) => [d, m])),
    evalByDepth: Object.fromEntries(Object.entries(byDepth).map(([d, [, v]]) => [d, { kind: 'cp', value: v }])),
  });
  it('is preliminary after screening only', () => {
    expect(computeConfidence([mk({ 8: ['e2e4', 20], 9: ['e2e4', 22], 10: ['e2e4', 25] })], { requestedDepth: 10, stage: 'screening' }).label).toBe('preliminary');
  });
  it('is stable when best move and eval agree at deep depths', () => {
    expect(computeConfidence([mk({ 16: ['e2e4', 20], 17: ['e2e4', 22], 18: ['e2e4', 25] })], { requestedDepth: 18, stage: 'deep' }).label).toBe('stable');
  });
  it('needs deeper analysis when the best move flips', () => {
    const c = computeConfidence([mk({ 16: ['e2e4', 20], 17: ['d2d4', 22], 18: ['e2e4', 25] })], { requestedDepth: 18, stage: 'deep' });
    expect(c.label).toBe('needs-deeper');
    expect(c.bestMoveStable).toBe(false);
  });
  it('is incomplete when interrupted', () => {
    expect(computeConfidence([mk({ 5: ['e2e4', 20] }, true)], { requestedDepth: 18, stage: 'deep' }).label).toBe('incomplete');
  });
});
