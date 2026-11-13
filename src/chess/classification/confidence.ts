import type { ConfidenceInfo, EngineResult, Evaluation } from '@/types';
import { winPercentWhite } from '@/chess/positions/evaluation';

// Analysis confidence is an engineering heuristic, not a probability. It answers:
// "Did the engine's answer stay the same as it searched deeper?"

const EVAL_STABLE_WIN_DELTA = 6; // win% points between the last tested depths

function mateSign(e: Evaluation): number {
  if (e.kind !== 'mate') return 0;
  if (e.value === 0) return e.matedSide === 'w' ? -1 : 1;
  return Math.sign(e.value);
}

export function computeConfidence(results: (EngineResult | null | undefined)[], opts: { requestedDepth: number; stage: 'screening' | 'deep' }): ConfidenceInfo {
  const rs = results.filter((r): r is EngineResult => !!r);
  const reasons: string[] = [];
  if (rs.length === 0) return { label: 'incomplete', depth: 0, bestMoveStable: false, evalStable: false, mateConsistent: true, interrupted: true, reasons: ['No engine result available.'] };
  const final = rs[rs.length - 1];
  if (final.source === 'terminal') return { label: 'stable', depth: 0, bestMoveStable: true, evalStable: true, mateConsistent: true, interrupted: false, reasons: ['Game-ending position (rules, not search).'] };
  const interrupted = rs.some((r) => r.interrupted);

  // Merge per-depth data across all searches of this position (screening + deep).
  const bestByDepth: Record<number, string> = {};
  const evalByDepth: Record<number, Evaluation> = {};
  for (const r of rs) {
    Object.assign(bestByDepth, r.bestMoveByDepth);
    Object.assign(evalByDepth, r.evalByDepth);
  }
  const depths = Object.keys(evalByDepth).map(Number).filter((d) => d > 0).sort((a, b) => a - b);
  const top = depths.slice(-3);
  const moves = top.map((d) => bestByDepth[d]).filter(Boolean);
  const bestMoveStable = moves.length >= 2 && moves.every((m) => m === moves[moves.length - 1]);
  const wins = top.map((d) => winPercentWhite(evalByDepth[d]));
  const evalStable = wins.length >= 2 && Math.max(...wins) - Math.min(...wins) <= EVAL_STABLE_WIN_DELTA;
  const signs = top.map((d) => mateSign(evalByDepth[d])).filter((s) => s !== 0);
  const mateConsistent = signs.every((s) => s === signs[0]);
  const depth = final.depth;

  if (!bestMoveStable) reasons.push('Best move changed between the last tested depths.');
  if (!evalStable) reasons.push('Evaluation moved noticeably between the last tested depths.');
  if (!mateConsistent) reasons.push('Mate score was not consistent across depths.');
  if (interrupted) reasons.push('Search was interrupted.');
  if (depth < Math.min(opts.requestedDepth, 8) && final.source === 'engine') reasons.push(`Search reached depth ${depth} only (time cap).`);

  let label: ConfidenceInfo['label'];
  if (interrupted || depth === 0) label = 'incomplete';
  else if (opts.stage === 'screening') label = 'preliminary';
  else if (bestMoveStable && evalStable && mateConsistent) label = 'stable';
  else label = 'needs-deeper';
  return { label, depth, bestMoveStable, evalStable, mateConsistent, interrupted, reasons };
}

export const CONFIDENCE_META: Record<ConfidenceInfo['label'], { label: string; description: string }> = {
  preliminary: { label: 'Preliminary', description: 'Shallow screening only. Treat as a first impression.' },
  stable: { label: 'Stable at tested depths', description: 'Best move and evaluation agreed across the deepest tested depths. Not a guarantee.' },
  'needs-deeper': { label: 'Needs deeper analysis', description: 'The engine changed its mind between depths. A deeper search may give a different verdict.' },
  incomplete: { label: 'Incomplete', description: 'The search was interrupted or failed.' },
};
