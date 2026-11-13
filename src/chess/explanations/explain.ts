import type { ExplanationLevel, PositionAnalysis, TacticalFinding } from '@/types';
import { PIECE_NAME, colorName, lineToSan, opposite } from '@/chess/positions/board';
import type { PieceSymbol } from 'chess.js';
import { formatEval } from '@/utils/format';
import { forPlayer, winPercentFor } from '@/chess/positions/evaluation';

// Deterministic, template-based explanations. Each sentence is generated from a verified finding
// (geometry + engine line). The explanation level changes wording only, never the evaluation.

export const UNIDENTIFIED_REASON = 'The engine prefers this continuation, but the tactical or positional reason has not been confidently identified.';

export interface Explanation {
  yourMove: string[];
  betterMove: string[];
  verified: boolean;
}

const pn = (p: string | undefined) => PIECE_NAME[(p ?? 'p') as PieceSymbol] ?? 'piece';
const pawns = (n: number) => `${Math.abs(n)} pawn${Math.abs(n) === 1 ? '' : 's'} of material`;

function sanLine(f: TacticalFinding, max = 6): string {
  const sans = lineToSan(f.lineStartFen, f.line.slice(0, max));
  return sans.join(' ');
}

function describe(f: TacticalFinding, level: ExplanationLevel, mover: string, opponent: string): string | null {
  const line = sanLine(f);
  const sq = f.squares;
  switch (f.motif) {
    case 'hanging-piece':
      if (level === 'beginner') return `${mover}'s ${pn(f.pieces[0])} on ${sq[0]} could be taken. ${opponent} wins it with ${line.split(' ')[0]}.`;
      if (level === 'intermediate') return `This leaves the ${pn(f.pieces[0])} on ${sq[0]} insufficiently protected; ${opponent} captures it (${line}) and wins ${pawns(f.materialSwing)}.`;
      return `The ${pn(f.pieces[0])} on ${sq[0]} drops to ${line}, a net loss of ${pawns(f.materialSwing)}.`;
    case 'fork': {
      const targets = sq.slice(1).map((s, i) => `${pn(f.pieces[i + 1])} on ${s}`).join(' and ');
      const who = f.side === 'missed' ? mover : opponent;
      if (level === 'beginner') return `${who}'s ${pn(f.pieces[0])} on ${sq[0]} attacks two pieces at once: the ${targets}. Only one can be saved.`;
      if (level === 'intermediate') return `${f.side === 'missed' ? 'There was' : 'This allows'} a fork: the ${pn(f.pieces[0])} lands on ${sq[0]} and hits the ${targets}. Line: ${line}.`;
      return `Fork on ${sq[0]} (${targets}); ${line} nets ${pawns(f.materialSwing)}.`;
    }
    case 'pin':
      if (level === 'beginner') return `The ${pn(f.pieces[1])} on ${sq[1]} cannot move safely because the ${pn(f.pieces[2])} on ${sq[2]} is behind it.`;
      if (level === 'intermediate') return `${f.side === 'missed' ? `${mover} could pin` : 'This allows a pin of'} the ${pn(f.pieces[1])} on ${sq[1]} against the ${pn(f.pieces[2])} on ${sq[2]}. Line: ${line}.`;
      return `Pin along ${sq[0]}–${sq[2]} (${pn(f.pieces[1])} shielding ${pn(f.pieces[2])}); ${line} nets ${pawns(f.materialSwing)}.`;
    case 'skewer':
      if (level === 'beginner') return `The ${pn(f.pieces[1])} on ${sq[1]} is attacked and must move, and then the ${pn(f.pieces[2])} behind it on ${sq[2]} can be taken.`;
      if (level === 'intermediate') return `${f.side === 'missed' ? 'There was' : 'This allows'} a skewer: the ${pn(f.pieces[1])} on ${sq[1]} must step aside, exposing the ${pn(f.pieces[2])} on ${sq[2]}. Line: ${line}.`;
      return `Skewer through ${sq[1]} onto ${sq[2]}; ${line} nets ${pawns(f.materialSwing)}.`;
    case 'discovered-attack':
      if (level === 'beginner') return `Moving one piece opens a line so the piece on ${sq[0]} suddenly attacks the ${pn(f.pieces[0])} on ${sq[1]}.`;
      if (level === 'intermediate') return `${f.side === 'missed' ? 'A discovered attack was available' : 'This allows a discovered attack'}: the piece on ${sq[0]} attacks the ${pn(f.pieces[0])} on ${sq[1]} once the line opens. Line: ${line}.`;
      return `Discovered attack from ${sq[0]} on ${sq[1]}; ${line} nets ${pawns(f.materialSwing)}.`;
    case 'mate':
      if (f.side === 'missed') {
        if (level === 'beginner') return `There was a checkmate in ${f.mateIn}: ${line}.`;
        return `Forced mate in ${f.mateIn} was available: ${line}.`;
      }
      if (level === 'beginner') return `After this move ${opponent} can force checkmate in ${f.mateIn}: ${line}.`;
      return `This allows a forced mate in ${f.mateIn}: ${line}.`;
    case 'back-rank-mate':
      if (level === 'beginner') return `${mover}'s king is stuck behind its own pieces on the back rank. ${opponent} checkmates with ${line}.`;
      if (level === 'intermediate') return `Back-rank weakness: with no escape square for the king, ${opponent} mates in ${f.mateIn} (${line}).`;
      return `Back-rank mate in ${f.mateIn}: ${line}; the king has no luft.`;
    case 'queen-exposure':
      if (level === 'beginner') return `${mover}'s queen came forward where ${opponent}'s pieces can attack it, and the attack wins material.`;
      return `The queen move exposes the queen${sq[0] ? ` on ${sq[0]}` : ''} to attack; ${line} costs ${pawns(f.materialSwing)}.`;
    case 'material-loss':
      if (level === 'beginner') return `After this move, ${opponent} wins material with ${line}.`;
      return `${opponent}'s best reply ${line} wins ${pawns(f.materialSwing)}.`;
    case 'material-gain':
      if (level === 'beginner') return `${line.split(' ')[0]} wins material for ${mover}: ${line}.`;
      return `The engine line ${line} wins ${pawns(f.materialSwing)}.`;
    case 'development':
      if (level === 'beginner') return `The engine prefers bringing a new piece into the game (or castling) with ${line.split(' ')[0]}.`;
      return `In the opening phase, the engine prefers the developing move ${line.split(' ')[0]}.`;
    default:
      return null;
  }
}

/** Build both sides of the "Why Not My Move?" comparison from stored, verified data. */
export function explainPosition(p: PositionAnalysis, level: ExplanationLevel): Explanation {
  const mover = colorName(p.mover);
  const opponent = colorName(opposite(p.mover));
  const yourMove: string[] = [];
  const betterMove: string[] = [];
  for (const f of p.motifs) {
    const text = describe(f, level, mover, opponent);
    if (!text) continue;
    (f.side === 'allowed' ? yourMove : betterMove).push(text);
  }
  const verified = yourMove.length + betterMove.length > 0;
  if (p.evaluationBefore && p.evaluationAfter && p.winPercentLoss !== null && p.winPercentLoss > 0.5) {
    const before = winPercentFor(p.evaluationBefore, p.mover);
    const after = winPercentFor(p.evaluationAfter, p.mover);
    const evText = `Evaluation from ${mover}'s side: ${formatEval(forPlayer(p.evaluationBefore, p.mover))} → ${formatEval(forPlayer(p.evaluationAfter, p.mover))} (estimated winning chances ${before.toFixed(0)}% → ${after.toFixed(0)}%).`;
    yourMove.push(evText);
  }
  if (!verified) betterMove.push(UNIDENTIFIED_REASON);
  else if (betterMove.length === 0 && p.bestSan && p.evaluationBefore) {
    // Only the problem with the played move was verified: state what the engine line shows, nothing more.
    betterMove.push(`${p.bestSan} avoids the line shown on the left. The engine evaluates the position after it at ${formatEval(forPlayer(p.evaluationBefore, p.mover))} from ${mover}'s side; its main line is shown above.`);
  }
  return { yourMove, betterMove, verified };
}
