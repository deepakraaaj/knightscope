import { Chess, type Square, type PieceSymbol } from 'chess.js';
import type { Color, GamePhase } from '@/types';

export const PIECE_VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export const PIECE_NAME: Record<PieceSymbol, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

export function opposite(c: Color): Color {
  return c === 'w' ? 'b' : 'w';
}

export function colorName(c: Color): string {
  return c === 'w' ? 'White' : 'Black';
}

/** Material balance in pawn units from `player`'s perspective. */
export function materialBalance(fen: string, player: Color): number {
  const board = fen.split(' ')[0];
  let total = 0;
  for (const ch of board) {
    const lower = ch.toLowerCase() as PieceSymbol;
    if (!(lower in PIECE_VALUE)) continue;
    const isWhite = ch !== lower;
    const v = PIECE_VALUE[lower];
    total += (isWhite ? 1 : -1) * v;
  }
  return player === 'w' ? total : -total;
}

/** Non-pawn, non-king material of both sides combined. */
export function nonPawnMaterial(fen: string): number {
  let total = 0;
  for (const ch of fen.split(' ')[0]) {
    const l = ch.toLowerCase();
    if (l === 'n' || l === 'b') total += 3;
    else if (l === 'r') total += 5;
    else if (l === 'q') total += 9;
  }
  return total;
}

/**
 * Game phase from the position (deterministic, documented):
 * - opening: first 20 plies while at least 3 minor/major pieces per side remain undeveloped-or-present
 * - endgame: combined non-pawn material <= 26 (e.g. R+B+N vs R+B+N) or both queens off with <= 30
 * - middlegame otherwise.
 */
export function gamePhase(fen: string, ply: number): GamePhase {
  const npm = nonPawnMaterial(fen);
  const board = fen.split(' ')[0];
  const queens = (board.match(/q/gi) ?? []).length;
  if (npm <= 26 || (queens === 0 && npm <= 30)) return 'endgame';
  if (ply < 20) return 'opening';
  return 'middlegame';
}

export function uciToMove(uci: string): { from: Square; to: Square; promotion?: PieceSymbol } {
  return { from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square, promotion: (uci[4] as PieceSymbol) || undefined };
}

/** Apply a UCI move; returns the new Chess instance and the verbose move, or null when illegal. */
export function applyUci(fen: string, uci: string) {
  const c = new Chess(fen);
  try {
    const m = c.move(uciToMove(uci));
    return { chess: c, move: m };
  } catch {
    return null;
  }
}

export function uciToSan(fen: string, uci: string): string | null {
  return applyUci(fen, uci)?.move.san ?? null;
}

/** Convert a UCI line into SAN, stopping at the first illegal move. */
export function lineToSan(fen: string, line: string[]): string[] {
  const c = new Chess(fen);
  const out: string[] = [];
  for (const u of line) {
    try {
      out.push(c.move(uciToMove(u)).san);
    } catch {
      break;
    }
  }
  return out;
}

/** FENs after each move of a UCI line (stops at first illegal move). */
export function lineFens(fen: string, line: string[]): string[] {
  const c = new Chess(fen);
  const out: string[] = [];
  for (const u of line) {
    try {
      c.move(uciToMove(u));
      out.push(c.fen());
    } catch {
      break;
    }
  }
  return out;
}

export function legalMoveCount(fen: string): number {
  return new Chess(fen).moves().length;
}

export function isTerminal(fen: string): { over: boolean; checkmate: boolean } {
  const c = new Chess(fen);
  return { over: c.isGameOver(), checkmate: c.isCheckmate() };
}
