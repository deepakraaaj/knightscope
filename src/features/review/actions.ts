import { db } from '@/storage/database/db';
import { saveExercise } from '@/storage/repositories';
import { exerciseFromMistake } from '@/features/training/logic';
import { gamePhase } from '@/chess/positions/board';
import type { Game, Mistake, PositionAnalysis } from '@/types';

/** The stored mistake for a position, or an equivalent record built from the review (category "other"). */
export async function mistakeForPosition(game: Game, p: PositionAnalysis): Promise<Mistake | null> {
  const stored = await db.mistakes.get(`${game.id}:${p.ply}`);
  if (stored) return stored;
  if (!p.bestMove || !p.evaluationBefore || !p.evaluationAfter || p.bestMove === p.actualMove) return null;
  return {
    id: `${game.id}:${p.ply}`,
    gameId: game.id,
    analysisId: p.analysisId,
    positionId: p.id,
    ply: p.ply,
    moveNumber: Math.floor(p.ply / 2) + 1,
    fen: p.fen,
    playerColor: p.mover,
    actualMove: p.actualMove,
    actualSan: p.actualSan,
    bestMove: p.bestMove,
    bestSan: p.bestSan ?? p.bestMove,
    evaluationBefore: p.evaluationBefore,
    evaluationAfter: p.evaluationAfter,
    winPercentLoss: p.winPercentLoss ?? 0,
    severity: p.classification === 'blunder' ? 'blunder' : p.classification === 'mistake' ? 'mistake' : 'inaccuracy',
    category: 'other',
    motifs: p.motifs,
    verified: false,
    detectionMethod: 'manual-from-review',
    phase: gamePhase(p.fen, p.ply),
    opening: game.opening,
    timeClass: game.timeClass,
    confidence: p.confidence?.label ?? 'preliminary',
    gameDate: game.date,
    createdAt: Date.now(),
    isUserMove: game.userColor === p.mover,
  };
}

export async function addPositionToTraining(game: Game, p: PositionAnalysis): Promise<'created' | 'exists' | 'unavailable'> {
  const m = await mistakeForPosition(game, p);
  if (!m) return 'unavailable';
  const ex = exerciseFromMistake(m, p);
  if (!ex) return 'unavailable';
  const r = await saveExercise(ex);
  return r.created ? 'created' : 'exists';
}
