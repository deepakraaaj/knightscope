import { useEffect, useRef } from 'react';
import type { PositionAnalysis } from '@/types';
import { CLASSIFICATION_META } from '@/chess/classification/classify';
import { cx } from '@/components/ui';
import { tone } from '@/app/providers/theme';

export interface MoveRow {
  ply: number;
  san: string;
  color: 'w' | 'b';
  moveNo: number;
  analysis?: PositionAnalysis;
}

/** `current` is the number of plies played (0 = start position). Clicking a move shows the position after it. */
export function MoveList({ moves, current, onSelect }: { moves: MoveRow[]; current: number; onSelect: (pliesPlayed: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('[data-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [current]);
  // Games set up from a FEN may start with Black to move: leave White's first cell empty.
  const padded: (MoveRow | undefined)[] = moves[0]?.color === 'b' ? [undefined, ...moves] : moves;
  const rows: [MoveRow | undefined, MoveRow | undefined][] = [];
  for (let i = 0; i < padded.length; i += 2) rows.push([padded[i], padded[i + 1]]);
  const firstMoveNo = (m: MoveRow | undefined, b: MoveRow | undefined, i: number) => (m ?? b)?.moveNo ?? i + 1;
  const cell = (m: MoveRow | undefined) => {
    if (!m) return <span />;
    const c = m.analysis?.classification;
    const meta = c ? CLASSIFICATION_META[c] : null;
    const active = current === m.ply + 1;
    return (
      <button
        data-current={active}
        onClick={() => onSelect(m.ply + 1)}
        className={cx('flex items-center justify-between gap-1 rounded px-2 py-1 text-left text-sm tabular transition-colors', active ? 'bg-primary/20 text-text' : 'hover:bg-elevated')}
        aria-label={`Move ${m.moveNo}${m.color === 'b' ? ' black' : ' white'} ${m.san}${meta ? `, ${meta.label}` : ''}`}
      >
        <span className="font-medium">{m.san}</span>
        {meta && ['brilliant', 'great', 'inaccuracy', 'mistake', 'blunder', 'book'].includes(c!) && (
          <span className="text-[11px] font-bold" style={{ color: tone(meta.color) }} aria-hidden>
            {meta.symbol}
          </span>
        )}
      </button>
    );
  };
  return (
    <div ref={ref} className="max-h-full overflow-y-auto pr-1" role="list" aria-label="Moves">
      {rows.map(([w, b], i) => (
        <div key={i} role="listitem" className="grid grid-cols-[2.25rem_1fr_1fr] items-center gap-1">
          <span className="text-xs text-muted tabular">{firstMoveNo(w, b, i)}.</span>
          {cell(w)}
          {cell(b)}
        </div>
      ))}
    </div>
  );
}
