import { Chess } from 'chess.js';
import type {
  AnalysisSettings,
  ClassificationThresholds,
  Color,
  EngineResult,
  Evaluation,
  Game,
  Mistake,
  PositionAnalysis,
} from '@/types';
import type { GameMove } from '@/chess/pgn/parsePgn';
import { parseSingleGame } from '@/chess/pgn/parsePgn';
import { isBookPosition } from '@/chess/openings/openings';
import { classifyMove, DEFAULT_THRESHOLDS, sacrificeAmount, winPercentLoss } from '@/chess/classification/classify';
import { computeConfidence } from '@/chess/classification/confidence';
import { moveAccuracy, gameAccuracy } from '@/chess/accuracy/accuracy';
import { evalToCp, forPlayer, sideToMoveFromFen, winPercentFor } from '@/chess/positions/evaluation';
import { gamePhase, legalMoveCount, uciToSan } from '@/chess/positions/board';
import { categorize, detectTactics } from '@/chess/tactics/detect';
import { uid } from '@/utils/hash';

export type StageName = 'screening' | 'deep' | 'review';

export interface AnalyzeFn {
  (req: { fen: string; depth: number; multiPv: number; moveTimeMs: number; signal?: AbortSignal; stage: 'screening' | 'deep' }): Promise<EngineResult>;
}

export interface GameAnalyzerProgress {
  stage: StageName;
  positionsDone: number;
  positionsTotal: number;
  deepDone: number;
  deepTotal: number;
  currentDepth: number;
}

export interface StoredRaw {
  /** Position index (0..moves.length). */
  index: number;
  stage: 'screening' | 'deep';
  result: EngineResult;
}

export interface GameAnalyzerOptions {
  game: Game;
  settings: AnalysisSettings;
  thresholds?: ClassificationThresholds;
  analyze: AnalyzeFn;
  signal?: AbortSignal;
  /** Previously persisted raw results (for resume after reload). */
  existing?: StoredRaw[];
  /** Persist raw results as they arrive, so analysis can resume after reload. */
  persistRaw?: (raw: StoredRaw) => Promise<void>;
  onProgress?: (p: GameAnalyzerProgress) => void;
  /** Which sides receive selective deep analysis. Defaults to both. */
  deepSides?: Color[];
}

export interface GameAnalyzerOutput {
  analysisId: string;
  positions: PositionAnalysis[];
  mistakes: Mistake[];
  whiteAccuracy: number | null;
  blackAccuracy: number | null;
  engineVersion: string;
}

function terminalResult(fen: string): EngineResult | null {
  const c = new Chess(fen);
  if (!c.isGameOver()) return null;
  const stm = c.turn();
  const ev: Evaluation = c.isCheckmate() ? { kind: 'mate', value: 0, matedSide: stm } : { kind: 'cp', value: 0 };
  return { fen, depth: 0, lines: [{ multipv: 1, eval: ev, moves: [], depth: 0 }], bestMove: null, bestMoveByDepth: {}, evalByDepth: { 0: ev }, interrupted: false, engineId: 'rules', source: 'terminal' };
}

function mainEval(r: EngineResult): Evaluation | null {
  return r.lines[0]?.eval ?? null;
}

/** Decide whether move i (from position i to i+1) needs Stage B deep analysis, and why. */
export function needsDeep(
  move: GameMove,
  before: EngineResult,
  after: EngineResult,
  thresholds: ClassificationThresholds,
): string | null {
  const eb = mainEval(before);
  const ea = mainEval(after);
  if (!eb || !ea) return null;
  if (after.source === 'terminal' && before.source === 'terminal') return null;
  const loss = before.bestMove === move.uci ? 0 : winPercentLoss(eb, ea, move.color);
  if (loss >= thresholds.good) return 'evaluation-drop';
  if (eb.kind === 'mate' || ea.kind === 'mate') return 'mate-score';
  const depths = Object.keys(before.bestMoveByDepth).map(Number).sort((a, b) => a - b).slice(-3);
  const moves = depths.map((d) => before.bestMoveByDepth[d]);
  if (moves.length >= 2 && new Set(moves).size > 1) return 'best-move-changed';
  if (before.bestMove === move.uci) {
    if (sacrificeAmount(before.fen, move.uci, after.lines[0]?.moves ?? [], move.color) >= thresholds.brilliantMinSacrifice) return 'brilliant-suspected';
    const second = before.lines[1]?.eval;
    if (second && winPercentFor(eb, move.color) - winPercentFor(second, move.color) >= thresholds.greatGap) return 'only-move-suspected';
  } else if (before.lines[1] && before.lines[1].moves[0] === move.uci) {
    // The actual move was the engine's second choice with a similar evaluation: confirm deeper.
    return 'similar-candidates';
  }
  return null;
}

export async function analyzeGame(opts: GameAnalyzerOptions): Promise<GameAnalyzerOutput> {
  const { game, settings, analyze, signal } = opts;
  const thresholds = opts.thresholds ?? DEFAULT_THRESHOLDS;
  const parsed = parseSingleGame(game.pgn);
  const moves = parsed.moves;
  const fens = [parsed.startFen, ...moves.map((m) => m.fenAfter)];
  const total = fens.length;
  const screening: (EngineResult | null)[] = new Array(total).fill(null);
  const deep: (EngineResult | null)[] = new Array(total).fill(null);
  for (const raw of opts.existing ?? []) {
    if (raw.index < 0 || raw.index >= total || raw.result.fen !== fens[raw.index]) continue;
    (raw.stage === 'deep' ? deep : screening)[raw.index] = raw.result;
  }
  const progress: GameAnalyzerProgress = { stage: 'screening', positionsDone: 0, positionsTotal: total, deepDone: 0, deepTotal: 0, currentDepth: 0 };
  const emit = () => opts.onProgress?.({ ...progress });

  // Book plies: leading moves whose resulting positions are all in the opening dataset.
  const isBook: boolean[] = [];
  let stillBook = parsed.startFen === new Chess().fen();
  for (const m of moves) {
    stillBook = stillBook && isBookPosition(m.fenAfter);
    isBook.push(stillBook);
  }

  // ---------- Stage A: screening every position ----------
  for (let i = 0; i < total; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (!screening[i]) {
      const term = terminalResult(fens[i]);
      const r = term ?? (await analyze({ fen: fens[i], depth: settings.screeningDepth, multiPv: settings.multiPv, moveTimeMs: settings.screeningMoveTimeMs, signal, stage: 'screening' }));
      screening[i] = r;
      progress.currentDepth = r.depth;
      await opts.persistRaw?.({ index: i, stage: 'screening', result: r });
    }
    progress.positionsDone = i + 1;
    emit();
  }

  // ---------- Stage B: selective deep analysis ----------
  progress.stage = 'deep';
  const deepSides = opts.deepSides ?? ['w', 'b'];
  const deepSet = new Set<number>();
  moves.forEach((m, i) => {
    if (isBook[i]) return;
    const reason = needsDeep(m, screening[i]!, screening[i + 1]!, thresholds);
    if (!reason) return;
    // Opponent moves only get deep analysis when they look like real mistakes.
    if (!deepSides.includes(m.color) && reason !== 'evaluation-drop') return;
    deepSet.add(i);
    deepSet.add(i + 1);
  });
  const deepList = [...deepSet].filter((i) => screening[i]?.source !== 'terminal').sort((a, b) => a - b);
  progress.deepTotal = deepList.length;
  progress.deepDone = deepList.filter((i) => deep[i]).length;
  emit();
  for (const i of deepList) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (deep[i]) continue;
    const r = await analyze({ fen: fens[i], depth: settings.deepDepth, multiPv: settings.multiPv, moveTimeMs: settings.deepMoveTimeMs, signal, stage: 'deep' });
    deep[i] = r;
    progress.deepDone++;
    progress.currentDepth = r.depth;
    await opts.persistRaw?.({ index: i, stage: 'deep', result: r });
    emit();
  }

  // ---------- Stage C: review generation ----------
  progress.stage = 'review';
  emit();
  const analysisId = uid('an_');
  const positions: PositionAnalysis[] = [];
  const mistakes: Mistake[] = [];
  const accuracies: Record<Color, number[]> = { w: [], b: [] };
  let engineVersion = 'Stockfish';
  for (const r of [...screening, ...deep]) if (r && r.source === 'engine') engineVersion = r.engineId;

  moves.forEach((m, i) => {
    const before = deep[i] ?? screening[i]!;
    const after = deep[i + 1] ?? screening[i + 1]!;
    const stage: 'screening' | 'deep' = deep[i] ? 'deep' : 'screening';
    const evalBefore = mainEval(before);
    const evalAfter = mainEval(after);
    const confidence = computeConfidence([screening[i], deep[i]], { requestedDepth: stage === 'deep' ? settings.deepDepth : settings.screeningDepth, stage });
    const legal = legalMoveCount(fens[i]);
    const bestMove = before.bestMove ?? before.lines[0]?.moves[0] ?? null;
    const replyLine = after.lines[0]?.moves ?? [];
    const secondBest = before.lines[1]?.eval ?? null;
    let classification = null;
    let loss: number | null = null;
    let accuracy: number | null = null;
    let cpl: number | null = null;
    if (evalBefore && evalAfter) {
      const out = classifyMove({ fenBefore: fens[i], mover: m.color, actualMove: m.uci, bestMove, evalBefore, evalAfter, secondBestEval: secondBest, replyLine, isBook: isBook[i], legalMoveCount: legal, confidence, thresholds });
      classification = out.classification;
      loss = out.winPercentLoss;
      accuracy = moveAccuracy(loss);
      if (!isBook[i]) accuracies[m.color].push(accuracy);
      if (evalBefore.kind === 'cp' && evalAfter.kind === 'cp') {
        const b = forPlayer(evalBefore, m.color);
        const a = forPlayer(evalAfter, m.color);
        cpl = bestMove === m.uci ? 0 : Math.max(0, Math.min(1000, evalToCp(b) - evalToCp(a)));
      }
    }
    const phase = gamePhase(fens[i], i);
    const isError = classification === 'inaccuracy' || classification === 'mistake' || classification === 'blunder';
    const motifs = isError && evalBefore && evalAfter
      ? detectTactics({ fenBefore: fens[i], mover: m.color, actualMove: m.uci, bestMove, bestLine: before.lines[0]?.moves ?? [], replyLine, evalBefore, evalAfter, phase, ply: i })
      : [];
    const pos: PositionAnalysis = {
      id: `${analysisId}:${i}`,
      analysisId,
      gameId: game.id,
      ply: i,
      fen: fens[i],
      fenAfter: fens[i + 1],
      mover: m.color,
      actualMove: m.uci,
      actualSan: m.san,
      bestMove,
      bestSan: bestMove ? uciToSan(fens[i], bestMove) : null,
      evaluationBefore: evalBefore,
      evaluationAfter: evalAfter,
      principalVariation: before.lines[0]?.moves ?? [],
      replyVariation: replyLine,
      secondBestEval: secondBest,
      depth: before.depth,
      stage,
      classification,
      winPercentLoss: loss,
      centipawnLoss: cpl,
      accuracy,
      confidence,
      isBook: isBook[i],
      legalMoveCount: legal,
      motifs,
    };
    positions.push(pos);

    if (isError && evalBefore && evalAfter && bestMove && bestMove !== m.uci) {
      const decision = categorize(motifs, { phase, mover: m.color, evalBefore, evalAfter });
      const significant = classification === 'mistake' || classification === 'blunder' || decision.verified;
      if (significant) {
        mistakes.push({
          id: `${game.id}:${i}`,
          gameId: game.id,
          analysisId,
          positionId: pos.id,
          ply: i,
          moveNumber: Math.floor(i / 2) + 1,
          fen: fens[i],
          playerColor: m.color,
          actualMove: m.uci,
          actualSan: m.san,
          bestMove,
          bestSan: pos.bestSan ?? bestMove,
          evaluationBefore: evalBefore,
          evaluationAfter: evalAfter,
          winPercentLoss: loss ?? 0,
          severity: classification as 'inaccuracy' | 'mistake' | 'blunder',
          category: decision.category,
          motifs,
          verified: decision.verified,
          detectionMethod: decision.detectionMethod,
          phase,
          opening: game.opening,
          timeClass: game.timeClass,
          confidence: confidence.label,
          gameDate: game.date,
          createdAt: Date.now(),
          isUserMove: game.userColor === m.color,
        });
      }
    }
  });

  // Sanity: the side to move at each position must match the mover.
  for (const p of positions) if (sideToMoveFromFen(p.fen) !== p.mover) throw new Error(`Internal error: side-to-move mismatch at ply ${p.ply}`);

  return {
    analysisId,
    positions,
    mistakes,
    whiteAccuracy: gameAccuracy(accuracies.w),
    blackAccuracy: gameAccuracy(accuracies.b),
    engineVersion,
  };
}
