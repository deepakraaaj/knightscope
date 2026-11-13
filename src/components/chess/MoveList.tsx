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
  // Scroll only this list (never the page) so the selected move stays visible.
  useEffect(() => {
    const box = ref.current;
    const el = box?.querySelector<HTMLElement>('[data-current="true"]');
    if (!box || !el) return;
    const top = el.offsetTop - box.offsetTop;
    if (top < box.scrollTop) box.scrollTop = top - 8;
    else if (top + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top + el.offsetHeight - box.clientHeight + 8;
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
    <div ref={ref} className="relative max-h-[420px] overflow-y-auto pr-1" role="list" aria-label="Moves">
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

/** Phone-friendly horizontal move strip. Scrolls itself sideways to keep the current move centred. */
export function MoveStrip({ moves, current, onSelect }: { moves: MoveRow[]; current: number; onSelect: (pliesPlayed: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = ref.current;
    const el = box?.querySelector<HTMLElement>('[data-current="true"]');
    if (!box) return;
    if (!el) {
      box.scrollTo({ left: 0, behavior: 'smooth' });
      return;
    }
    box.scrollTo({ left: el.offsetLeft - box.clientWidth / 2 + el.offsetWidth / 2, behavior: 'smooth' });
  }, [current]);
  return (
    <div ref={ref} className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-surface p-1 [scrollbar-width:none]" role="list" aria-label="Moves">
      {moves.map((m) => {
        const c = m.analysis?.classification;
        const meta = c ? CLASSIFICATION_META[c] : null;
        const notable = !!c && ['brilliant', 'great', 'inaccuracy', 'mistake', 'blunder'].includes(c);
        const active = current === m.ply + 1;
        return (
          <button
            key={m.ply}
            role="listitem"
            data-current={active}
            onClick={() => onSelect(m.ply + 1)}
            className={cx('flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-sm tabular', active ? 'bg-primary text-on-primary' : notable ? 'bg-elevated' : 'text-muted')}
            style={!active && notable && meta ? { color: tone(meta.color) } : undefined}
            aria-label={`Move ${m.moveNo}${m.color === 'b' ? ' black' : ' white'} ${m.san}${meta ? `, ${meta.label}` : ''}`}
          >
            {(m.color === 'w' || m.ply === moves[0].ply) && <span className={cx('text-xs', active ? 'opacity-80' : 'text-muted/70')}>{m.moveNo}{m.color === 'w' ? '.' : '…'}</span>}
            <span className="font-medium">{m.san}</span>
            {notable && meta && <span className="text-[11px] font-bold">{meta.symbol}</span>}
          </button>
        );
      })}
    </div>
  );
}
