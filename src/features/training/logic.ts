import { Chess } from 'chess.js';
import type { Color, EngineResult, Evaluation, Mistake, PositionAnalysis, TrainingExercise } from '@/types';
import { applyUci, colorName, materialBalance, opposite, uciToMove } from '@/chess/positions/board';
import { mateFor, sideToMoveFromFen, winPercentFor } from '@/chess/positions/evaluation';
import { materialSwing } from '@/chess/tactics/detect';

export type AnalyzeForTraining = (req: { fen: string; depth: number; multiPv?: number }) => Promise<EngineResult>;

const MAX_USER_MOVES = 3;

/** Build a training exercise from a stored mistake. Returns null if the position cannot be trained. */
export function exerciseFromMistake(m: Mistake, pos: PositionAnalysis | undefined, now = Date.now()): TrainingExercise | null {
  const line = pos?.principalVariation?.length ? pos.principalVariation : [m.bestMove];
  if (!line.length || line[0] !== m.bestMove) return null;
  if (!applyUci(m.fen, m.bestMove)) return null;
  const mover = m.playerColor;
  const mate = mateFor(m.evaluationBefore, mover);
  let kind: TrainingExercise['kind'] = 'best-move';
  let requiredUserMoves = 1;
  let goal = `${colorName(mover)} to move. Find the strongest continuation. (In the game, ${m.actualSan} was played.)`;
  let mateIn: number | null = null;
  if (mate !== null && mate > 0 && mate <= 5) {
    kind = 'mate';
    mateIn = mate;
    requiredUserMoves = mate;
    goal = `${colorName(mover)} to move. Find checkmate in ${mate}.`;
  } else {
    // Tactic: the engine line wins material. Count user moves until the gain is realised.
    const gain = materialSwing(m.fen, line, mover).swing;
    if (gain >= 2) {
      kind = 'tactic';
      requiredUserMoves = Math.min(MAX_USER_MOVES, userMovesUntilGain(m.fen, line, mover, gain));
      goal = `${colorName(mover)} to move. Win material.`;
    }
  }
  const difficulty: 1 | 2 | 3 = requiredUserMoves >= 3 ? 3 : requiredUserMoves === 2 ? 2 : 1;
  return {
    id: `ex_${m.id}`,
    sourceMistakeId: m.id,
    gameId: m.gameId,
    fen: m.fen,
    sideToMove: mover,
    kind,
    goal,
    solution: line.slice(0, requiredUserMoves * 2 - 1),
    solutionEval: m.evaluationBefore,
    requiredUserMoves,
    mateIn,
    category: m.category,
    difficulty,
    createdAt: now,
    nextReviewAt: now,
    box: 0,
    attempts: 0,
    successes: 0,
    lastResult: null,
  };
}

function userMovesUntilGain(fen: string, line: string[], mover: Color, gain: number): number {
  const start = materialBalance(fen, mover);
  const c = new Chess(fen);
  for (let i = 0; i < line.length && i < MAX_USER_MOVES * 2; i++) {
    try {
      c.move(uciToMove(line[i]));
    } catch {
      break;
    }
    // After the mover's move AND the opponent's reply the gain must hold.
    if (i % 2 === 1 || i === line.length - 1) {
      if (materialBalance(c.fen(), mover) - start >= Math.min(gain, 2)) return Math.floor(i / 2) + 1;
    }
  }
  return 1;
}

export interface StepVerdict {
  legal: boolean;
  accepted: boolean;
  /** True when the whole exercise is solved after this move. */
  complete: boolean;
  /** Opponent reply (UCI) to play when the exercise continues. */
  reply: string | null;
  fenAfterReply: string | null;
  message: string;
  userEval: Evaluation | null;
  bestEval: Evaluation | null;
  bestMove: string | null;
  winLoss: number | null;
}

export interface ValidationOptions {
  depth: number;
  acceptanceWinLoss: number;
}

/**
 * Validate one user move inside an exercise.
 * - mate: the move must keep a forced mate within the remaining move budget (or deliver mate).
 * - tactic / best-move: the move must be within `acceptanceWinLoss` win% of the engine's best move
 *   in this position, so equivalent alternatives are accepted.
 */
export async function validateStep(
  ex: TrainingExercise,
  fen: string,
  userMove: string,
  step: number,
  analyze: AnalyzeForTraining,
  opts: ValidationOptions,
): Promise<StepVerdict> {
  const user = ex.sideToMove;
  const base: StepVerdict = { legal: false, accepted: false, complete: false, reply: null, fenAfterReply: null, message: '', userEval: null, bestEval: null, bestMove: null, winLoss: null };
  if (sideToMoveFromFen(fen) !== user) return { ...base, message: 'It is not your turn in this position.' };
  const applied = applyUci(fen, userMove);
  if (!applied) return { ...base, message: 'That move is not legal here.' };
  const after = applied.chess;
  const fenAfter = after.fen();
  const isLastStep = step + 1 >= ex.requiredUserMoves;

  if (after.isCheckmate()) {
    return { ...base, legal: true, accepted: true, complete: true, message: 'Checkmate. Exercise solved.', userEval: { kind: 'mate', value: 0, matedSide: opposite(user) } };
  }
  const drawn = after.isGameOver(); // stalemate, insufficient material, etc.

  if (ex.kind === 'mate' && ex.mateIn !== null) {
    if (drawn) return { ...base, legal: true, accepted: false, userEval: { kind: 'cp', value: 0 }, message: 'That move ends the game in a draw instead of forcing mate.' };
    const remaining = ex.mateIn - step; // moves left including this one
    const r = await analyze({ fen: fenAfter, depth: Math.max(opts.depth, remaining * 2 + 8) });
    const ev = r.lines[0]?.eval ?? null;
    const m = ev ? mateFor(ev, user) : null;
    const ok = m !== null && m > 0 && m <= remaining - 1;
    if (!ok) {
      return { ...base, legal: true, accepted: false, userEval: ev, message: `That move does not force mate within ${remaining} move${remaining === 1 ? '' : 's'}.` };
    }
    const reply = r.bestMove;
    const replied = reply ? applyUci(fenAfter, reply) : null;
    return { ...base, legal: true, accepted: true, complete: false, reply, fenAfterReply: replied?.chess.fen() ?? null, userEval: ev, message: `Correct. Mate in ${m} remains. Continue.` };
  }

  const ref = await analyze({ fen, depth: opts.depth, multiPv: 1 });
  const bestEval = ref.lines[0]?.eval ?? null;
  // A drawn final position is scored by the rules (0.00), not by search.
  const res: EngineResult | null = drawn ? null : await analyze({ fen: fenAfter, depth: Math.max(1, opts.depth - 1) });
  const userEval: Evaluation | null = drawn ? { kind: 'cp', value: 0 } : (res!.lines[0]?.eval ?? null);
  if (!bestEval || !userEval) return { ...base, legal: true, message: 'The engine could not evaluate this position. Try again.' };
  const loss = userMove === ref.bestMove ? 0 : Math.max(0, winPercentFor(bestEval, user) - winPercentFor(userEval, user));
  const accepted = loss <= opts.acceptanceWinLoss;
  if (!accepted) {
    return { ...base, legal: true, accepted: false, userEval, bestEval, bestMove: ref.bestMove, winLoss: loss, message: `Not quite. This move gives up about ${loss.toFixed(0)}% winning chances compared with the best option.` };
  }
  if (isLastStep || drawn || !res) {
    return { ...base, legal: true, accepted: true, complete: true, userEval, bestEval, bestMove: ref.bestMove, winLoss: loss, message: loss < 0.5 ? 'Correct. Exercise solved.' : 'Accepted: your move is close in value to the engine’s choice. Exercise solved.' };
  }
  const reply = res.bestMove;
  const replied = reply ? applyUci(fenAfter, reply) : null;
  return { ...base, legal: true, accepted: true, complete: !replied, reply, fenAfterReply: replied?.chess.fen() ?? null, userEval, bestEval, bestMove: ref.bestMove, winLoss: loss, message: 'Good move. Continue the sequence.' };
}

// ------------------------------------------------------------------ spaced repetition

/** Simple Leitner schedule (in days). A heuristic schedule, not a validated learning model. */
export const BOX_INTERVAL_DAYS = [0, 1, 3, 7, 14, 30];
const DAY = 86_400_000;
const RETRY_DELAY = 10 * 60_000;

export function schedule(ex: Pick<TrainingExercise, 'box'>, success: boolean, now = Date.now()): { box: number; nextReviewAt: number } {
  if (!success) return { box: 0, nextReviewAt: now + RETRY_DELAY };
  const box = Math.min(BOX_INTERVAL_DAYS.length - 1, ex.box + 1);
  return { box, nextReviewAt: now + BOX_INTERVAL_DAYS[box] * DAY };
}

export function isDue(ex: TrainingExercise, now = Date.now()): boolean {
  return ex.nextReviewAt <= now;
}
