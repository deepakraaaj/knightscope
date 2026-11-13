import { useEffect, useMemo, useState } from 'react';
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight } from 'lucide-react';
import { Board } from './Board';
import { lineFens, lineToSan } from '@/chess/positions/board';
import { IconButton, cx } from '@/components/ui';

/** Interactive viewer for a UCI line starting from a FEN. Step 0 shows the start position. */
export function LineStepper({ id, startFen, line, orientation, initialStep = 1, accent = '#7C9CFF', maxPlies = 12 }: { id: string; startFen: string; line: string[]; orientation: 'white' | 'black'; initialStep?: number; accent?: string; maxPlies?: number }) {
  const shown = line.slice(0, maxPlies);
  const fens = useMemo(() => [startFen, ...lineFens(startFen, shown)], [startFen, shown.join(' ')]);
  const sans = useMemo(() => lineToSan(startFen, shown), [startFen, shown.join(' ')]);
  const [step, setStep] = useState(Math.min(initialStep, fens.length - 1));
  useEffect(() => setStep(Math.min(initialStep, fens.length - 1)), [startFen, fens.length, initialStep]);
  const startMoveNo = Number(startFen.split(' ')[5] ?? 1);
  const blackFirst = startFen.split(' ')[1] === 'b';
  return (
    <div className="flex flex-col gap-2">
      <Board id={id} fen={fens[step]} orientation={orientation} lastMove={step > 0 ? shown[step - 1] : null} arrows={step < shown.length ? [{ from: shown[step].slice(0, 2), to: shown[step].slice(2, 4), color: `${accent}cc` }] : []} />
      <div className="flex items-center justify-between">
        <div className="flex">
          <IconButton label="First position" onClick={() => setStep(0)} disabled={step === 0}><ChevronFirst className="size-4" /></IconButton>
          <IconButton label="Previous move" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}><ChevronLeft className="size-4" /></IconButton>
          <IconButton label="Next move" onClick={() => setStep((s) => Math.min(fens.length - 1, s + 1))} disabled={step >= fens.length - 1}><ChevronRight className="size-4" /></IconButton>
          <IconButton label="Last position" onClick={() => setStep(fens.length - 1)} disabled={step >= fens.length - 1}><ChevronLast className="size-4" /></IconButton>
        </div>
        <span className="text-xs text-muted tabular">{step}/{fens.length - 1}</span>
      </div>
      <div className="flex flex-wrap gap-1 text-sm">
        {sans.map((s, i) => {
          const plyIndex = i + (blackFirst ? 1 : 0);
          const num = startMoveNo + Math.floor(plyIndex / 2);
          const prefix = plyIndex % 2 === 0 ? `${num}.` : i === 0 ? `${num}…` : '';
          return (
            <button key={i} onClick={() => setStep(i + 1)} className={cx('rounded px-1.5 py-0.5 tabular', step === i + 1 ? 'bg-elevated text-text' : 'text-muted hover:text-text')}>
              {prefix && <span className="mr-0.5 text-muted/70">{prefix}</span>}
              {s}
            </button>
          );
        })}
      </div>
    </div>
  );
}
