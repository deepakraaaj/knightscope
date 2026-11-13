import type { Color, Evaluation } from '@/types';

/**
 * Convert a raw UCI score (side-to-move perspective) into a White-perspective evaluation.
 * UCI "score mate 0" (side to move is mated) becomes { mate 0, matedSide }.
 */
export function normalizeScore(raw: { kind: 'cp' | 'mate'; value: number }, sideToMove: Color): Evaluation {
  const sign = sideToMove === 'w' ? 1 : -1;
  if (raw.kind === 'cp') return { kind: 'cp', value: raw.value * sign };
  if (raw.value === 0) return { kind: 'mate', value: 0, matedSide: sideToMove };
  return { kind: 'mate', value: raw.value * sign };
}

/** Flip a White-perspective evaluation to the given player's perspective (+ = good for that player). */
export function forPlayer(e: Evaluation, player: Color): Evaluation {
  if (player === 'w') return e;
  if (e.kind === 'cp') return { kind: 'cp', value: -e.value };
  return { kind: 'mate', value: -e.value, matedSide: e.matedSide };
}

const MATE_CP = 10000;

/** Centipawn-equivalent number for comparisons and charts (mate mapped to large values). */
export function evalToCp(e: Evaluation): number {
  if (e.kind === 'cp') return e.value;
  if (e.value === 0) return e.matedSide === 'w' ? -MATE_CP : MATE_CP;
  return e.value > 0 ? MATE_CP - e.value : -MATE_CP - e.value;
}

/**
 * White's winning chance in percent (0-100) using the logistic model published by Lichess
 * (https://lichess.org/page/accuracy). It is an estimate, not a calibrated probability for this app.
 */
export function winPercentWhite(e: Evaluation): number {
  if (e.kind === 'mate') {
    if (e.value === 0) return e.matedSide === 'w' ? 0 : 100;
    return e.value > 0 ? 100 : 0;
  }
  const cp = Math.max(-1000, Math.min(1000, e.value));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

export function winPercentFor(e: Evaluation, player: Color): number {
  const w = winPercentWhite(e);
  return player === 'w' ? w : 100 - w;
}

/** Mate distance for `player` (positive = player mates in N), or null if not a mate score for that player. */
export function mateFor(e: Evaluation, player: Color): number | null {
  if (e.kind !== 'mate') return null;
  const p = forPlayer(e, player);
  if (p.kind !== 'mate') return null;
  if (p.value === 0) return p.matedSide === player ? -0.5 : 0;
  return p.value;
}

export function sideToMoveFromFen(fen: string): Color {
  return fen.split(' ')[1] === 'b' ? 'b' : 'w';
}

export function epdOf(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}
