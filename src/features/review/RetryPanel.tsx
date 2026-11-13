import { useState } from 'react';
import { Eye, RotateCcw, X } from 'lucide-react';
import type { Game, PositionAnalysis, TrainingExercise } from '@/types';
import { Board } from '@/components/chess/Board';
import { Button, Notice, Spinner } from '@/components/ui';
import { useInteractiveEngine } from '@/hooks/useEngine';
import { useSettings } from '@/hooks/data';
import { validateStep, type StepVerdict } from '@/features/training/logic';
import { applyUci, colorName } from '@/chess/positions/board';
import { mateFor } from '@/chess/positions/evaluation';

/** Replay the position before a move and let the user try again; the engine judges the attempt. */
export function RetryPanel({ p, orientation, onClose }: { p: PositionAnalysis; game: Game; orientation: 'white' | 'black'; onClose: () => void }) {
  const settings = useSettings();
  const { analyze, error } = useInteractiveEngine();
  const [fen, setFen] = useState(p.fen);
  const [last, setLast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<StepVerdict | null>(null);
  const [showBest, setShowBest] = useState(false);
  const mate = p.evaluationBefore ? mateFor(p.evaluationBefore, p.mover) : null;
  const pseudo: TrainingExercise = {
    id: 'retry', sourceMistakeId: null, gameId: null, fen: p.fen, sideToMove: p.mover, kind: mate && mate > 0 && mate <= 5 ? 'mate' : 'best-move', goal: '',
    solution: p.principalVariation, solutionEval: p.evaluationBefore ?? { kind: 'cp', value: 0 }, requiredUserMoves: 1, mateIn: mate && mate > 0 && mate <= 5 ? mate : null,
    category: 'other', difficulty: 1, createdAt: 0, nextReviewAt: 0, box: 0, attempts: 0, successes: 0, lastResult: null,
  };
  // For mate positions the retry only checks that the first move keeps the forced mate.
  if (pseudo.kind === 'mate' && pseudo.mateIn) pseudo.requiredUserMoves = pseudo.mateIn;

  const onMove = (uci: string) => {
    if (busy || verdict) return false;
    const res = applyUci(p.fen, uci);
    if (!res) return false;
    setFen(res.chess.fen());
    setLast(uci);
    setBusy(true);
    validateStep(pseudo, p.fen, uci, 0, analyze, { depth: Math.max(12, Math.min(18, p.depth)), acceptanceWinLoss: settings.trainingAcceptanceWinLoss })
      .then((v) => setVerdict(pseudo.kind === 'mate' && v.accepted ? { ...v, complete: true, message: v.complete ? v.message : 'Correct: this move keeps a forced mate.' } : v))
      .catch((e) => setVerdict({ legal: true, accepted: false, complete: false, reply: null, fenAfterReply: null, message: (e as Error).message, userEval: null, bestEval: null, bestMove: null, winLoss: null }))
      .finally(() => setBusy(false));
    return true;
  };

  const reset = () => {
    setFen(p.fen);
    setLast(null);
    setVerdict(null);
    setShowBest(false);
  };

  return (
    <div className="flex flex-col gap-2" data-testid="retry-panel">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium">Retry: {colorName(p.mover)} to move. Find a better move than {p.actualSan}.</span>
        <button onClick={onClose} aria-label="Close retry" className="rounded p-1 text-muted hover:text-text"><X className="size-4" /></button>
      </div>
      <Board id="retry" fen={fen} orientation={orientation} interactive={!busy && !verdict} onMove={onMove} lastMove={last} arrows={showBest && p.bestMove ? [{ from: p.bestMove.slice(0, 2), to: p.bestMove.slice(2, 4), color: 'rgba(74,222,128,0.85)' }] : []} />
      {error && <Notice kind="error">{error}</Notice>}
      {busy && <Spinner label="Checking your move with Stockfish…" />}
      {verdict && <Notice kind={verdict.accepted ? 'success' : 'warn'}><span data-testid="retry-verdict">{verdict.message}</span></Notice>}
      <div className="flex flex-wrap gap-2">
        {verdict && <Button size="sm" icon={<RotateCcw className="size-3.5" />} onClick={reset}>Try again</Button>}
        {verdict && !verdict.accepted && !showBest && <Button size="sm" icon={<Eye className="size-3.5" />} onClick={() => { reset(); setShowBest(true); }}>Show best move</Button>}
        {showBest && <span className="self-center text-sm text-muted">Engine move: {p.bestSan}</span>}
      </div>
    </div>
  );
}
