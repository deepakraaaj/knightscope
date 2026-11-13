import { useMemo } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import type { Game } from '@/types';
import { EMPTY_FILTERS, type GameFilters } from '@/features/analytics/aggregate';
import { Select } from '@/components/ui';

export function FilterBar({ filters, onChange, games }: { filters: GameFilters; onChange: (f: GameFilters) => void; games: Game[] }) {
  const openings = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of games) counts.set(g.opening ?? 'Unknown', (counts.get(g.opening ?? 'Unknown') ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k]) => k);
  }, [games]);
  const active = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);
  const set = <K extends keyof GameFilters>(k: K, v: GameFilters[K]) => onChange({ ...filters, [k]: v });
  return (
    <details className="card group" open={active}>
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm">
        <span className="flex items-center gap-2"><SlidersHorizontal className="size-4 text-muted" />Filters{active && <span className="rounded bg-primary/20 px-1.5 text-xs text-primary">active</span>}</span>
        {active && (
          <button type="button" onClick={(e) => { e.preventDefault(); onChange(EMPTY_FILTERS); }} className="flex items-center gap-1 text-xs text-muted hover:text-text">
            <X className="size-3.5" />Reset
          </button>
        )}
      </summary>
      <div className="grid grid-cols-2 gap-3 border-t border-border p-4 sm:grid-cols-3 lg:grid-cols-7">
        <label className="flex flex-col gap-1">
          <span className="label">From</span>
          <input type="date" className="input h-9 py-0" value={filters.from ?? ''} onChange={(e) => set('from', e.target.value || null)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">To</span>
          <input type="date" className="input h-9 py-0" value={filters.to ?? ''} onChange={(e) => set('to', e.target.value || null)} />
        </label>
        <Select label="Source" value={filters.source} onChange={(v) => set('source', v)} options={[{ value: 'all', label: 'All' }, { value: 'chesscom', label: 'Chess.com' }, { value: 'lichess', label: 'Lichess' }, { value: 'pgn', label: 'PGN' }]} />
        <Select label="Time control" value={filters.timeClass} onChange={(v) => set('timeClass', v)} options={[{ value: 'all', label: 'All' }, ...['bullet', 'blitz', 'rapid', 'classical', 'correspondence', 'unknown'].map((t) => ({ value: t as GameFilters['timeClass'], label: t[0].toUpperCase() + t.slice(1) }))]} />
        <Select label="My color" value={filters.color} onChange={(v) => set('color', v)} options={[{ value: 'all', label: 'Both' }, { value: 'w', label: 'White' }, { value: 'b', label: 'Black' }]} />
        <Select label="Result" value={filters.result} onChange={(v) => set('result', v)} options={[{ value: 'all', label: 'All' }, { value: 'win', label: 'Wins' }, { value: 'loss', label: 'Losses' }, { value: 'draw', label: 'Draws' }]} />
        <Select label="Opening" value={filters.opening} onChange={(v) => set('opening', v)} options={[{ value: 'all', label: 'All openings' }, ...openings.map((o) => ({ value: o, label: o.length > 40 ? o.slice(0, 39) + '…' : o }))]} />
      </div>
    </details>
  );
}
