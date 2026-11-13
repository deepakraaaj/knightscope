import data from './openings.json';
import { cyrb53 } from '@/utils/hash';
import { epdOf } from '@/chess/positions/evaluation';

// Opening names and book positions come from the Lichess chess-openings dataset (CC0-1.0).
const typed = data as unknown as { named: Record<string, [string, string]>; book: string[] };
const named = typed.named;
const book = new Set(typed.book);

/** True when the position (after a move) occurs inside a named opening line. */
export function isBookPosition(fen: string): boolean {
  return book.has(cyrb53(epdOf(fen)));
}

/** Deepest named opening reached by a sequence of positions. */
export function lookupOpening(fensAfterMoves: string[]): { eco: string; name: string; ply: number } | null {
  let found: { eco: string; name: string; ply: number } | null = null;
  for (let i = 0; i < fensAfterMoves.length && i < 40; i++) {
    const hit = named[epdOf(fensAfterMoves[i])];
    if (hit) found = { eco: hit[0], name: hit[1], ply: i };
  }
  return found;
}

/** Number of leading plies whose resulting positions are all book positions. */
export function bookPlyCount(fensAfterMoves: string[]): number {
  let n = 0;
  for (const fen of fensAfterMoves) {
    if (!isBookPosition(fen)) break;
    n++;
  }
  return n;
}
