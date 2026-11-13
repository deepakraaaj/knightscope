import { useEffect, useRef, useState } from 'react';
import { Check, Eye, Lightbulb, RotateCcw, SkipForward, Undo2 } from 'lucide-react';
import type { TrainingAttempt, TrainingExercise } from '@/types';
import { Board } from '@/components/chess/Board';
import { LineStepper } from '@/components/chess/LineStepper';
import { Badge, Button, Notice, Spinner } from '@/components/ui';
import { CATEGORY_LABEL } from '@/features/analytics/aggregate';
import { applyUci, colorName, lineToSan } from '@/chess/positions/board';
import { useInteractiveEngine } from '@/hooks/useEngine';
import { useSettings } from '@/hooks/data';
import { schedule, validateStep, type StepVerdict } from './logic';
import { recordAttempt } from '@/storage/repositories';
import { uid } from '@/utils/hash';

type Phase = 'solving' | 'checking' | 'solved' | 'failed' | 'revealed';

export function ExercisePlayer({ exercise, onNext, hasNext }: { exercise: TrainingExercise; onNext: () => void; hasNext: boolean }) {
  const settings = useSettings();
  const { analyze, error: engineError, name: engineName } = useInteractiveEngine();
  const [fen, setFen] = useState(exercise.fen);
  const [pending, setPending] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [played, setPlayed] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>('solving');
  const [verdict, setVerdict] = useState<StepVerdict | null>(null);
  const [hint, setHint] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const started = useRef(Date.now());
  const depth = 14;

  useEffect(() => {
    setFen(exercise.fen);
    setPending(null);
    setStep(0);
    setPlayed([]);
    setPhase('solving');
    setVerdict(null);
    setHint(false);
    setRecorded(false);
    started.current = Date.now();
  }, [exercise.id]);

  const record = async (correct: boolean, revealed: boolean, moves: string[]) => {
    if (recorded) return;
    setRecorded(true);
    const attempt: TrainingAttempt = {
      id: uid('at_'),
      exerciseId: exercise.id,
      fen: exercise.fen,
      attemptedMoves: moves,
      correct,
      usedHint: hint,
      revealedSolution: revealed,
      timeSpentMs: Date.now() - started.current,
      attemptedAt: Date.now(),
      category: exercise.category,
      engineSettings: { depth, engineId: engineName ?? 'Stockfish', acceptanceWinLoss: settings.trainingAcceptanceWinLoss },
    };
    await recordAttempt(attempt, exercise, schedule(exercise, correct));
  };

  const submit = async () => {
    if (!pending) return;
    setPhase('checking');
    const moves = [...played, pending];
    try {
      const v = await validateStep(exercise, fen, pending, step, analyze, { depth, acceptanceWinLoss: settings.trainingAcceptanceWinLoss });
      setVerdict(v);
      if (!v.legal) {
        setPhase('solving');
        setPending(null);
        return;
      }
      if (!v.accepted) {
        setFen(applyUci(fen, pending)?.chess.fen() ?? fen);
        setPhase('failed');
        await record(false, false, moves);
        return;
      }
      if (v.complete) {
        setFen(applyUci(fen, pending)?.chess.fen() ?? fen);
        setPhase('solved');
        await record(true, false, moves);
        return;
      }
      // Continue: show opponent reply.
      setPlayed([...moves, v.reply!]);
      setFen(v.fenAfterReply!);
      setPending(null);
      setStep(step + 1);
      setPhase('solving');
    } catch (e) {
      setVerdict({ legal: true, accepted: false, complete: false, reply: null, fenAfterReply: null, message: (e as Error).message, userEval: null, bestEval: null, bestMove: null, winLoss: null });
      setPhase('solving');
      setPending(null);
    }
  };

  const retry = () => {
    setFen(exercise.fen);
    setPending(null);
    setStep(0);
    setPlayed([]);
    setPhase('solving');
    setVerdict(null);
    started.current = Date.now();
    setRecorded(false);
  };

  const reveal = async () => {
    await record(false, true, played);
    setPhase('revealed');
  };

  const displayFen = pending ? applyUci(fen, pending)?.chess.fen() ?? fen : fen;
  const orientation = exercise.sideToMove === 'w' ? 'white' : 'black';
  const hintSquare = exercise.solution[step * 2]?.slice(0, 2);
  const lastMove = pending ?? played[played.length - 1] ?? null;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]" data-testid="exercise-player">
      <div className="mx-auto w-full max-w-[600px]">
        {phase === 'revealed' ? (
          <LineStepper id="solution" startFen={exercise.fen} line={exercise.solution} orientation={orientation} accent="#4ADE80" />
        ) : (
          <Board
            id="training"
            fen={displayFen}
            orientation={orientation}
            interactive={phase === 'solving' && !pending}
            onMove={(uci) => {
              setPending(uci);
              setVerdict(null);
              return true;
            }}
            lastMove={lastMove}
            highlight={hint && hintSquare && phase === 'solving' ? { [hintSquare]: 'rgba(250,204,21,0.55)' } : undefined}
          />
        )}
      </div>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge color="#7C9CFF">{CATEGORY_LABEL[exercise.category]}</Badge>
          <Badge color="#94A3B8">{exercise.kind === 'mate' ? `Mate in ${exercise.mateIn}` : exercise.kind === 'tactic' ? 'Tactic' : 'Best move'}</Badge>
          {exercise.requiredUserMoves > 1 && <Badge color="#94A3B8">Move {Math.min(step + 1, exercise.requiredUserMoves)} of {exercise.requiredUserMoves}</Badge>}
        </div>
        <h2 className="text-lg font-semibold" data-testid="exercise-goal">{exercise.goal}</h2>
        <p className="flex items-center gap-2 text-sm text-muted">
          <span className={`size-3 rounded-sm border border-border ${exercise.sideToMove === 'w' ? 'bg-[#e8ecf4]' : 'bg-[#0b1020]'}`} aria-hidden />
          {colorName(exercise.sideToMove)} to move
        </p>
        {played.length > 0 && <p className="text-sm text-muted">So far: {lineToSan(exercise.fen, played).join(' ')}</p>}
        {engineError && <Notice kind="error">{engineError}</Notice>}
        {phase === 'checking' && <Spinner label="Stockfish is checking your move…" />}
        {verdict && phase !== 'checking' && (
          <Notice kind={verdict.accepted ? 'success' : verdict.legal ? 'warn' : 'error'}>
            <span data-testid="exercise-verdict">{verdict.message}</span>
          </Notice>
        )}
        {phase === 'revealed' && (
          <Notice kind="info">Solution: {lineToSan(exercise.fen, exercise.solution).join(' ')}. Step through it on the board.</Notice>
        )}

        <div className="flex flex-wrap gap-2">
          {phase === 'solving' && pending && (
            <>
              <Button variant="primary" icon={<Check className="size-4" />} onClick={submit}>Submit move</Button>
              <Button variant="ghost" icon={<Undo2 className="size-4" />} onClick={() => setPending(null)}>Undo</Button>
            </>
          )}
          {phase === 'solving' && !pending && !hint && step === 0 && (
            <Button variant="ghost" icon={<Lightbulb className="size-4" />} onClick={() => setHint(true)}>Hint</Button>
          )}
          {(phase === 'failed' || phase === 'solved' || phase === 'revealed') && <Button icon={<RotateCcw className="size-4" />} onClick={retry}>Retry</Button>}
          {phase === 'failed' && <Button variant="ghost" icon={<Eye className="size-4" />} onClick={reveal}>Show solution</Button>}
          {phase !== 'checking' && hasNext && <Button variant={phase === 'solved' ? 'primary' : 'ghost'} icon={<SkipForward className="size-4" />} onClick={onNext}>Next exercise</Button>}
        </div>
        {hint && phase === 'solving' && <p className="text-xs text-muted">Hint: the highlighted piece makes the key move. Using a hint is recorded with the attempt.</p>}
        <p className="mt-2 text-xs text-muted">
          Moves are checked with Stockfish (depth {depth}). A move within {settings.trainingAcceptanceWinLoss}% winning chances of the engine’s choice counts as correct{exercise.kind === 'mate' ? '; mate exercises require keeping a forced mate' : ''}.
        </p>
      </div>
    </div>
  );
}
