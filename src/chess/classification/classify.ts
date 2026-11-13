import { Chess } from 'chess.js';
import type { Classification, ClassificationThresholds, Color, ConfidenceInfo, Evaluation } from '@/types';
import { PIECE_VALUE, applyUci, materialBalance, opposite, uciToMove } from '@/chess/positions/board';
import { mateFor, winPercentFor } from '@/chess/positions/evaluation';

/**
 * KnightScope move classification (independently designed; NOT a reproduction of any proprietary
 * algorithm). All quantities are from the mover's perspective. See docs/CLASSIFICATION.md.
 *
 *  - book:       the resulting position appears in the Lichess opening dataset and all earlier moves were book
 *  - forced:     the only legal move
 *  - brilliant:  conservative sacrifice detector (see isBrilliantCandidate)
 *  - great:      the engine's best move, and the second-best option is at least `greatGap` win% worse
 *  - best:       the engine's top move
 *  - excellent / good / inaccuracy / mistake / blunder: by win-percentage loss thresholds
 */
export const DEFAULT_THRESHOLDS: ClassificationThresholds = {
  excellent: 2,
  good: 5,
  inaccuracy: 10,
  mistake: 20,
  greatGap: 20,
  brilliantMinSacrifice: 2,
};

export interface ClassifyInput {
  fenBefore: string;
  mover: Color;
  actualMove: string;
  bestMove: string | null;
  evalBefore: Evaluation;
  evalAfter: Evaluation;
  secondBestEval: Evaluation | null;
  /** Engine line from the position after the actual move (opponent's reply first). */
  replyLine: string[];
  isBook: boolean;
  legalMoveCount: number;
  confidence: ConfidenceInfo | null;
  thresholds?: ClassificationThresholds;
}

export interface ClassifyOutput {
  classification: Classification;
  winPercentLoss: number;
  brilliantCandidate: boolean;
  brilliantRejectedReason: string | null;
}

export function winPercentLoss(evalBefore: Evaluation, evalAfter: Evaluation, mover: Color): number {
  return Math.max(0, winPercentFor(evalBefore, mover) - winPercentFor(evalAfter, mover));
}

/**
 * Sacrifice check: after the move, the mover is materially worse by at least `minSac` pawns at some
 * point in the engine's main line (first 6 plies), or the moved piece can be captured for a net gain
 * per a static exchange estimate (covers declined sacrifices). Captures that simply win material do not count.
 */
export function sacrificeAmount(fenBefore: string, actualMove: string, replyLine: string[], mover: Color): number {
  const res = applyUci(fenBefore, actualMove);
  if (!res) return 0;
  const start = materialBalance(fenBefore, mover);
  // The investment must be attributable to THIS move: measured right after the opponent's reply,
  // and still present after the mover's immediate follow-up (so plain trades and recaptures do not
  // count, and later sacrifices further down the line are not credited to this move).
  let worst = 0;
  const c = new Chess(res.chess.fen());
  const deltas: number[] = [];
  for (let i = 0; i < replyLine.length && i < 2; i++) {
    try {
      c.move(uciToMove(replyLine[i]));
    } catch {
      break;
    }
    deltas.push(materialBalance(c.fen(), mover) - start);
  }
  if (deltas.length > 0) worst = Math.min(0, Math.max(...deltas));
  // Static en-prise check for the moved piece (offered but possibly declined).
  const after = res.chess;
  const to = res.move.to;
  const moved = after.get(to);
  if (moved && moved.type !== 'k') {
    const attackers = after.attackers(to, opposite(mover));
    const defenders = after.attackers(to, mover);
    if (attackers.length > 0) {
      const cheapestAttacker = Math.min(...attackers.map((s) => PIECE_VALUE[after.get(s)!.type] || 100));
      const value = PIECE_VALUE[moved.type];
      const gain = defenders.length === 0 ? value : value - cheapestAttacker;
      const captured = res.move.captured ? PIECE_VALUE[res.move.captured] : 0;
      worst = Math.min(worst, captured - gain);
    }
  }
  return Math.max(0, -worst);
}

export function isBrilliantCandidate(input: ClassifyInput, loss: number, t: ClassificationThresholds): { ok: boolean; reason: string | null } {
  const { mover, actualMove, bestMove, evalBefore, evalAfter, confidence } = input;
  if (input.legalMoveCount <= 1) return { ok: false, reason: 'forced move' };
  if (bestMove !== actualMove && loss > 1) return { ok: false, reason: 'not the engine best move' };
  const afterWin = winPercentFor(evalAfter, mover);
  const beforeWin = winPercentFor(evalBefore, mover);
  if (afterWin < 50) return { ok: false, reason: 'position is not good for the mover after the move' };
  if (beforeWin >= 97 && mateFor(evalBefore, mover) === null) return { ok: false, reason: 'position was already completely winning' };
  const sac = sacrificeAmount(input.fenBefore, actualMove, input.replyLine, mover);
  if (sac < t.brilliantMinSacrifice) return { ok: false, reason: 'no meaningful material investment' };
  if (!confidence || confidence.label !== 'stable') return { ok: false, reason: 'evaluation not stable at tested depths' };
  return { ok: true, reason: null };
}

export function classifyMove(input: ClassifyInput): ClassifyOutput {
  const t = input.thresholds ?? DEFAULT_THRESHOLDS;
  const { mover, evalBefore, evalAfter } = input;
  let loss = winPercentLoss(evalBefore, evalAfter, mover);
  // Playing the engine's top move cannot lose value; residual differences are search noise.
  if (input.bestMove && input.actualMove === input.bestMove) loss = 0;

  const base = (): Classification => {
    if (loss <= t.excellent) return 'excellent';
    if (loss <= t.good) return 'good';
    if (loss <= t.inaccuracy) return 'inaccuracy';
    if (loss <= t.mistake) return 'mistake';
    return 'blunder';
  };

  if (input.isBook) return { classification: 'book', winPercentLoss: loss, brilliantCandidate: false, brilliantRejectedReason: null };
  if (input.legalMoveCount === 1) return { classification: 'forced', winPercentLoss: loss, brilliantCandidate: false, brilliantRejectedReason: null };

  // Missing a forced mate while keeping a forced (slower) mate is not penalised.
  const mateB = mateFor(evalBefore, mover);
  const mateA = mateFor(evalAfter, mover);
  if (mateB !== null && mateB > 0 && mateA !== null && mateA > 0) loss = Math.min(loss, t.excellent);
  // Losing a forced mate but staying overwhelmingly winning is at most an inaccuracy.
  if (mateB !== null && mateB > 0 && (mateA === null || mateA <= 0) && winPercentFor(evalAfter, mover) >= 90) loss = Math.min(loss, t.inaccuracy);

  const brill = isBrilliantCandidate(input, loss, t);
  if (brill.ok) return { classification: 'brilliant', winPercentLoss: loss, brilliantCandidate: true, brilliantRejectedReason: null };

  const isBest = input.bestMove !== null && input.actualMove === input.bestMove;
  if (isBest) {
    if (input.secondBestEval) {
      const gap = winPercentFor(evalAfter, mover) - winPercentFor(input.secondBestEval, mover);
      const beforeWin = winPercentFor(evalBefore, mover);
      if (gap >= t.greatGap && beforeWin < 95) return { classification: 'great', winPercentLoss: 0, brilliantCandidate: false, brilliantRejectedReason: brill.reason };
    }
    return { classification: 'best', winPercentLoss: 0, brilliantCandidate: false, brilliantRejectedReason: brill.reason };
  }
  return { classification: base(), winPercentLoss: loss, brilliantCandidate: false, brilliantRejectedReason: brill.reason };
}

export const CLASSIFICATION_META: Record<Classification, { label: string; color: string; symbol: string; order: number }> = {
  brilliant: { label: 'Brilliant', color: '#2DD4BF', symbol: '!!', order: 0 },
  great: { label: 'Great', color: '#60A5FA', symbol: '!', order: 1 },
  best: { label: 'Best', color: '#4ADE80', symbol: '★', order: 2 },
  excellent: { label: 'Excellent', color: '#86EFAC', symbol: '✓', order: 3 },
  good: { label: 'Good', color: '#A3B8A0', symbol: '○', order: 4 },
  book: { label: 'Book', color: '#C4A484', symbol: '◆', order: 5 },
  forced: { label: 'Forced', color: '#94A3B8', symbol: '□', order: 6 },
  inaccuracy: { label: 'Inaccuracy', color: '#FACC15', symbol: '?!', order: 7 },
  mistake: { label: 'Mistake', color: '#FB923C', symbol: '?', order: 8 },
  blunder: { label: 'Blunder', color: '#F87171', symbol: '??', order: 9 },
};
