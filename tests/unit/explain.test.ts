import { describe, expect, it } from 'vitest';
import { explainPosition, UNIDENTIFIED_REASON } from '@/chess/explanations/explain';
import type { PositionAnalysis } from '@/types';

const base: PositionAnalysis = {
  id: 'a:5', analysisId: 'a', gameId: 'g', ply: 5, fen: 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3', fenAfter: '', mover: 'b',
  actualMove: 'g8f6', actualSan: 'Nf6', bestMove: 'g7g6', bestSan: 'g6', evaluationBefore: { kind: 'cp', value: 30 }, evaluationAfter: { kind: 'mate', value: 1 },
  principalVariation: ['g7g6'], replyVariation: ['h5f7'], secondBestEval: null, depth: 14, stage: 'deep', classification: 'blunder', winPercentLoss: 47, centipawnLoss: null,
  accuracy: 0, confidence: null, isBook: false, legalMoveCount: 30, motifs: [],
};

describe('Explanations', () => {
  it('falls back to the unidentified message when nothing was verified', () => {
    const e = explainPosition(base, 'beginner');
    expect(e.verified).toBe(false);
    expect(e.betterMove).toEqual([UNIDENTIFIED_REASON]);
  });
  it('explains an allowed mate from the verified finding, worded per level', () => {
    const p = { ...base, motifs: [{ motif: 'mate' as const, side: 'allowed' as const, squares: [], pieces: [], materialSwing: 0, mateIn: 1, line: ['h5f7'], lineStartFen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4' }] };
    const beginner = explainPosition(p, 'beginner');
    const advanced = explainPosition(p, 'advanced');
    expect(beginner.yourMove[0]).toBe('After this move White can force checkmate in 1: Qxf7#.');
    expect(advanced.yourMove[0]).toBe('This allows a forced mate in 1: Qxf7#.');
    expect(beginner.betterMove[0]).toMatch(/^g6 avoids the line/);
    expect(beginner.betterMove[0]).not.toBe(UNIDENTIFIED_REASON);
  });
});
