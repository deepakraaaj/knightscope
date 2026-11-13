import { Chess, type Square, type PieceSymbol } from 'chess.js';
import type { Color, Evaluation, GamePhase, MistakeCategory, TacticalFinding } from '@/types';
import { PIECE_VALUE, applyUci, materialBalance, opposite, uciToMove } from '@/chess/positions/board';
import { mateFor, winPercentFor } from '@/chess/positions/evaluation';

// Rule-based tactical detection. Every finding is backed by (1) a geometric pattern on a concrete
// board and (2) a material or mate outcome along an engine line. If either part is missing, no
// finding is produced. This is deliberately conservative: it misses some tactics rather than invent them.

export interface TacticContext {
  fenBefore: string;
  mover: Color;
  actualMove: string;
  bestMove: string | null;
  /** Engine PV from fenBefore (starts with bestMove). */
  bestLine: string[];
  /** Engine PV from the position after the actual move (opponent moves first). */
  replyLine: string[];
  evalBefore: Evaluation;
  evalAfter: Evaluation;
  phase: GamePhase;
  ply: number;
}

const MAX_LINE_PLIES = 8;

/** Material change for `player` along a line, measured after captures settle (max 8 plies). */
export function materialSwing(fen: string, line: string[], player: Color, maxPlies = MAX_LINE_PLIES): { swing: number; plies: number } {
  const start = materialBalance(fen, player);
  const c = new Chess(fen);
  let last = start;
  let plies = 0;
  for (let i = 0; i < line.length && i < maxPlies; i++) {
    let m;
    try {
      m = c.move(uciToMove(line[i]));
    } catch {
      break;
    }
    plies = i + 1;
    last = materialBalance(c.fen(), player);
    // Stop once we are past the minimum horizon and the last move was quiet (exchanges settled).
    if (i >= 3 && !m.captured && !m.promotion) break;
  }
  return { swing: last - start, plies };
}

function attackedOpponentPieces(c: Chess, from: Square, attacker: Color): { square: Square; type: PieceSymbol }[] {
  const out: { square: Square; type: PieceSymbol }[] = [];
  for (const row of c.board()) {
    for (const p of row) {
      if (!p || p.color === attacker) continue;
      if (c.attackers(p.square, attacker).includes(from)) out.push({ square: p.square, type: p.type });
    }
  }
  return out;
}

function isDefended(c: Chess, sq: Square, owner: Color): boolean {
  // chess.js attackers() reports pieces of `owner` that attack `sq` (i.e. defend it).
  return c.attackers(sq, owner).length > 0;
}

/** Fork: the moved piece attacks two or more valuable or undefended targets (king counts). */
export function detectFork(fenAfter: string, to: Square, attacker: Color): { targets: { square: Square; type: PieceSymbol }[] } | null {
  const c = new Chess(fenAfter);
  const piece = c.get(to);
  if (!piece || piece.color !== attacker) return null;
  const myValue = PIECE_VALUE[piece.type] || 100;
  const victim = opposite(attacker);
  const targets = attackedOpponentPieces(c, to, attacker).filter(
    (t) => t.type === 'k' || (t.type !== 'p' && (PIECE_VALUE[t.type] > myValue || !isDefended(c, t.square, victim))),
  );
  return targets.length >= 2 ? { targets } : null;
}

const DIRS: Record<'r' | 'b', [number, number][]> = {
  r: [[1, 0], [-1, 0], [0, 1], [0, -1]],
  b: [[1, 1], [1, -1], [-1, 1], [-1, -1]],
};

function sq(f: number, r: number): Square | null {
  if (f < 0 || f > 7 || r < 0 || r > 7) return null;
  return (String.fromCharCode(97 + f) + (r + 1)) as Square;
}

/** Pin / skewer created by a sliding piece on `from`. Returns the line pieces when found. */
export function detectLineTactic(fenAfter: string, from: Square, attacker: Color): { kind: 'pin' | 'skewer'; front: Square; back: Square; frontType: PieceSymbol; backType: PieceSymbol } | null {
  const c = new Chess(fenAfter);
  const piece = c.get(from);
  if (!piece || piece.color !== attacker || !['r', 'b', 'q'].includes(piece.type)) return null;
  const dirs = piece.type === 'q' ? [...DIRS.r, ...DIRS.b] : DIRS[piece.type as 'r' | 'b'];
  const f0 = from.charCodeAt(0) - 97;
  const r0 = Number(from[1]) - 1;
  const victim = opposite(attacker);
  for (const [df, dr] of dirs) {
    let f = f0 + df;
    let r = r0 + dr;
    let front: { square: Square; type: PieceSymbol } | null = null;
    while (true) {
      const s = sq(f, r);
      if (!s) break;
      const p = c.get(s);
      if (p) {
        if (p.color !== victim) break;
        if (!front) front = { square: s, type: p.type };
        else {
          const fv = front.type === 'k' ? 100 : PIECE_VALUE[front.type];
          const bv = p.type === 'k' ? 100 : PIECE_VALUE[p.type];
          if (front.type !== 'k' && bv > fv && front.type !== 'p') return { kind: 'pin', front: front.square, back: s, frontType: front.type, backType: p.type };
          if (fv > bv && bv >= 3) return { kind: 'skewer', front: front.square, back: s, frontType: front.type, backType: p.type };
          break;
        }
      }
      f += df;
      r += dr;
    }
  }
  return null;
}

/** Discovered attack: moving a piece opens a line for another slider onto a king/queen/rook/undefended piece. */
export function detectDiscovered(fenBefore: string, uci: string, attacker: Color): { slider: Square; target: Square; targetType: PieceSymbol } | null {
  const before = new Chess(fenBefore);
  const res = applyUci(fenBefore, uci);
  if (!res) return null;
  const after = res.chess;
  const movedTo = res.move.to;
  const victim = opposite(attacker);
  for (const row of after.board()) {
    for (const p of row) {
      if (!p || p.color !== victim) continue;
      const valuable = p.type === 'k' || p.type === 'q' || p.type === 'r' || (p.type !== 'p' && !isDefended(after, p.square, victim));
      if (!valuable) continue;
      const nowAttackers = after.attackers(p.square, attacker).filter((s) => s !== movedTo);
      const prevAttackers = new Set(before.attackers(p.square, attacker));
      for (const s of nowAttackers) {
        const sp = after.get(s);
        if (sp && ['r', 'b', 'q'].includes(sp.type) && !prevAttackers.has(s)) return { slider: s, target: p.square, targetType: p.type };
      }
    }
  }
  return null;
}

/** True when the final position of the line is checkmate delivered on the mated king's back rank. */
export function isBackRankMate(fen: string, line: string[], matedSide: Color): { line: string[] } | null {
  const c = new Chess(fen);
  const played: string[] = [];
  for (const u of line) {
    try {
      c.move(uciToMove(u));
      played.push(u);
    } catch {
      return null;
    }
    if (c.isCheckmate()) break;
  }
  if (!c.isCheckmate() || c.turn() !== matedSide) return null;
  const king = c.findPiece({ type: 'k', color: matedSide })[0];
  const backRank = matedSide === 'w' ? '1' : '8';
  if (!king || king[1] !== backRank) return null;
  const checkers = c.attackers(king, opposite(matedSide));
  const onRank = checkers.some((s) => {
    const p = c.get(s);
    return p && (p.type === 'r' || p.type === 'q') && s[1] === backRank;
  });
  if (!onRank) return null;
  // The king's escape squares on the next rank must be blocked by its own pieces.
  const forward = matedSide === 'w' ? 1 : -1;
  const kf = king.charCodeAt(0) - 97;
  const kr = Number(king[1]) - 1 + forward;
  let ownBlockers = 0;
  for (const df of [-1, 0, 1]) {
    const s = sq(kf + df, kr);
    if (!s) continue;
    const p = c.get(s);
    if (p && p.color === matedSide) ownBlockers++;
  }
  return ownBlockers >= 2 ? { line: played } : null;
}

function isDevelopingMove(fen: string, uci: string): boolean {
  const res = applyUci(fen, uci);
  if (!res) return false;
  const m = res.move;
  if (m.isKingsideCastle() || m.isQueensideCastle()) return true;
  const backRank = m.color === 'w' ? '1' : '8';
  return (m.piece === 'n' || m.piece === 'b') && m.from[1] === backRank && m.to[1] !== backRank;
}

/** Run all detectors for one move. Returns verified findings (possibly empty). */
export function detectTactics(ctx: TacticContext): TacticalFinding[] {
  const findings: TacticalFinding[] = [];
  const { fenBefore, mover, actualMove, bestMove, bestLine, replyLine } = ctx;
  const opp = opposite(mover);
  const actual = applyUci(fenBefore, actualMove);
  if (!actual) return findings;
  const fenAfter = actual.chess.fen();
  const actualSwing = materialSwing(fenAfter, replyLine, mover);
  // Count the material of the actual move itself (e.g. a capture) in the comparison.
  const actualTotal = materialBalance(fenAfter, mover) - materialBalance(fenBefore, mover) + actualSwing.swing;
  const bestTotal = bestMove && bestLine[0] === bestMove ? materialSwing(fenBefore, bestLine, mover).swing : null;

  // --- Missed checkmate (verified by the engine mate score)
  const bestMate = mateFor(ctx.evalBefore, mover);
  const afterMate = mateFor(ctx.evalAfter, mover);
  if (bestMate !== null && bestMate > 0 && (afterMate === null || afterMate <= 0) && bestMove && bestMove !== actualMove) {
    findings.push({ motif: 'mate', side: 'missed', squares: [bestMove.slice(2, 4)], pieces: [], materialSwing: 0, mateIn: bestMate, line: bestLine.slice(0, bestMate * 2 - 1), lineStartFen: fenBefore });
  }

  // --- Allowed checkmate (opponent has a forced mate after the actual move, which did not exist before)
  const oppMateAfter = mateFor(ctx.evalAfter, opp);
  const oppMateBefore = mateFor(ctx.evalBefore, opp);
  if (oppMateAfter !== null && oppMateAfter > 0 && (oppMateBefore === null || oppMateBefore <= 0)) {
    const br = isBackRankMate(fenAfter, replyLine.slice(0, oppMateAfter * 2 - 1), mover);
    findings.push({
      motif: br ? 'back-rank-mate' : 'mate',
      side: 'allowed',
      squares: [],
      pieces: [],
      materialSwing: 0,
      mateIn: oppMateAfter,
      line: br ? br.line : replyLine.slice(0, oppMateAfter * 2 - 1),
      lineStartFen: fenAfter,
    });
  }

  const avoidableLoss = bestTotal !== null ? bestTotal - actualTotal : -actualTotal;

  // --- Allowed tactics: the opponent's best reply is a concrete tactic that wins material.
  if (replyLine.length > 0 && actualSwing.swing <= -2 && avoidableLoss >= 2) {
    const reply = applyUci(fenAfter, replyLine[0]);
    if (reply) {
      const rm = reply.move;
      const afterReply = reply.chess.fen();
      if (rm.captured && rm.captured !== 'p') {
        const c = new Chess(fenAfter);
        const undefended = !isDefended(c, rm.to, mover);
        const cheaperAttacker = PIECE_VALUE[rm.piece] < PIECE_VALUE[rm.captured];
        if (undefended || cheaperAttacker) {
          findings.push({ motif: 'hanging-piece', side: 'allowed', squares: [rm.to], pieces: [rm.captured], materialSwing: actualSwing.swing, mateIn: null, line: replyLine.slice(0, actualSwing.plies), lineStartFen: fenAfter });
        }
      }
      const fork = detectFork(afterReply, rm.to, opp);
      if (fork) findings.push({ motif: 'fork', side: 'allowed', squares: [rm.to, ...fork.targets.map((t) => t.square)], pieces: [rm.piece, ...fork.targets.map((t) => t.type)], materialSwing: actualSwing.swing, mateIn: null, line: replyLine.slice(0, actualSwing.plies), lineStartFen: fenAfter });
      const lt = detectLineTactic(afterReply, rm.to, opp);
      if (lt) findings.push({ motif: lt.kind, side: 'allowed', squares: [rm.to, lt.front, lt.back], pieces: [rm.piece, lt.frontType, lt.backType], materialSwing: actualSwing.swing, mateIn: null, line: replyLine.slice(0, actualSwing.plies), lineStartFen: fenAfter });
      const disc = detectDiscovered(fenAfter, replyLine[0], opp);
      if (disc) findings.push({ motif: 'discovered-attack', side: 'allowed', squares: [disc.slider, disc.target], pieces: [disc.targetType], materialSwing: actualSwing.swing, mateIn: null, line: replyLine.slice(0, actualSwing.plies), lineStartFen: fenAfter });
      // Queen exposure: the actual move moved the queen, and the line wins material from it.
      if (actual.move.piece === 'q') {
        const c = new Chess(afterReply);
        const qSq = c.findPiece({ type: 'q', color: mover })[0];
        const queenAttackedByLesser = qSq ? c.attackers(qSq, opp).some((s) => (PIECE_VALUE[c.get(s)?.type ?? 'q'] ?? 9) < 9) : false;
        const queenLost = materialSwing(fenAfter, replyLine, mover).swing <= -5;
        if (queenAttackedByLesser || queenLost) {
          findings.push({ motif: 'queen-exposure', side: 'allowed', squares: qSq ? [qSq] : [], pieces: ['q'], materialSwing: actualSwing.swing, mateIn: null, line: replyLine.slice(0, actualSwing.plies), lineStartFen: fenAfter });
        }
      }
      if (!findings.some((f) => f.side === 'allowed')) {
        findings.push({ motif: 'material-loss', side: 'allowed', squares: [], pieces: [], materialSwing: actualSwing.swing, mateIn: null, line: replyLine.slice(0, actualSwing.plies), lineStartFen: fenAfter });
      }
    }
  }

  // --- Missed tactics: the best move itself is a fork / pin / skewer / discovered attack that wins material.
  if (bestMove && bestMove !== actualMove && bestTotal !== null && bestTotal >= 2 && bestTotal - actualTotal >= 2) {
    const best = applyUci(fenBefore, bestMove);
    if (best) {
      const bm = best.move;
      const bestFenAfter = best.chess.fen();
      const line = bestLine.slice(0, MAX_LINE_PLIES);
      const fork = detectFork(bestFenAfter, bm.to, mover);
      if (fork) findings.push({ motif: 'fork', side: 'missed', squares: [bm.to, ...fork.targets.map((t) => t.square)], pieces: [bm.piece, ...fork.targets.map((t) => t.type)], materialSwing: bestTotal, mateIn: null, line, lineStartFen: fenBefore });
      const lt = detectLineTactic(bestFenAfter, bm.to, mover);
      if (lt) findings.push({ motif: lt.kind, side: 'missed', squares: [bm.to, lt.front, lt.back], pieces: [bm.piece, lt.frontType, lt.backType], materialSwing: bestTotal, mateIn: null, line, lineStartFen: fenBefore });
      const disc = detectDiscovered(fenBefore, bestMove, mover);
      if (disc) findings.push({ motif: 'discovered-attack', side: 'missed', squares: [disc.slider, disc.target], pieces: [disc.targetType], materialSwing: bestTotal, mateIn: null, line, lineStartFen: fenBefore });
      if (!fork && !lt && !disc) findings.push({ motif: 'material-gain', side: 'missed', squares: [bm.to], pieces: [], materialSwing: bestTotal, mateIn: null, line, lineStartFen: fenBefore });
    }
  }

  // --- Opening development (only as a factual statement about the engine preference)
  if (ctx.phase === 'opening' && bestMove && bestMove !== actualMove && !actual.move.captured && isDevelopingMove(fenBefore, bestMove) && !isDevelopingMove(fenBefore, actualMove)) {
    findings.push({ motif: 'development', side: 'missed', squares: [bestMove.slice(2, 4)], pieces: [], materialSwing: 0, mateIn: null, line: bestLine.slice(0, 4), lineStartFen: fenBefore });
  }
  return findings;
}

export interface CategoryDecision {
  category: MistakeCategory;
  verified: boolean;
  detectionMethod: string;
}

/** Map verified findings to one primary mistake category, in a fixed, documented priority order. */
export function categorize(findings: TacticalFinding[], ctx: Pick<TacticContext, 'phase' | 'mover' | 'evalBefore' | 'evalAfter'>): CategoryDecision {
  const has = (motif: TacticalFinding['motif'], side: TacticalFinding['side']) => findings.some((f) => f.motif === motif && f.side === side);
  if (has('mate', 'missed')) return { category: 'missed-checkmate', verified: true, detectionMethod: 'engine-mate-score' };
  if (has('back-rank-mate', 'allowed')) return { category: 'back-rank-weakness', verified: true, detectionMethod: 'engine-mate-line+back-rank-geometry' };
  if (has('mate', 'allowed')) return { category: 'king-safety', verified: true, detectionMethod: 'engine-mate-score-allowed' };
  if (has('hanging-piece', 'allowed')) return { category: 'hanging-piece', verified: true, detectionMethod: 'undefended-capture+material-line' };
  if (has('fork', 'missed')) return { category: 'missed-fork', verified: true, detectionMethod: 'fork-geometry+material-line' };
  if (has('pin', 'missed')) return { category: 'missed-pin', verified: true, detectionMethod: 'pin-geometry+material-line' };
  if (has('skewer', 'missed')) return { category: 'missed-skewer', verified: true, detectionMethod: 'skewer-geometry+material-line' };
  if (['fork', 'pin', 'skewer', 'discovered-attack'].some((m) => has(m as TacticalFinding['motif'], 'allowed')))
    return { category: 'missed-tactical-defense', verified: true, detectionMethod: 'opponent-tactic-geometry+material-line' };
  if (has('queen-exposure', 'allowed')) return { category: 'queen-exposure', verified: true, detectionMethod: 'queen-move+attack-on-queen+material-line' };
  const moverBefore = winPercentFor(ctx.evalBefore, ctx.mover);
  const moverAfter = winPercentFor(ctx.evalAfter, ctx.mover);
  if (ctx.phase === 'endgame' && moverBefore >= 75 && moverAfter < 60) return { category: 'endgame-conversion', verified: true, detectionMethod: 'endgame-phase+winning-eval-lost' };
  if (has('material-loss', 'allowed')) return { category: 'material-loss', verified: true, detectionMethod: 'material-line' };
  if (has('development', 'missed')) return { category: 'opening-development', verified: true, detectionMethod: 'opening-phase+engine-prefers-development' };
  return { category: 'other', verified: false, detectionMethod: 'none' };
}
