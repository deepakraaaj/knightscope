import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Play, Search, Trash2 } from 'lucide-react';
import { db } from '@/storage/database/db';
import { completedAnalysisByGame, deleteGame, enqueueGames } from '@/storage/repositories';
import { startQueue } from '@/engine/scheduler/queueRunner';
import { Badge, Button, EmptyState, Modal, Segmented, Select, cx, toast } from '@/components/ui';
import { formatDate, pct } from '@/utils/format';
import { useSettings } from '@/hooks/data';
import type { Game, PresetName } from '@/types';
import { BookOpenCheck } from 'lucide-react';

const SOURCE_LABEL = { chesscom: 'Chess.com', lichess: 'Lichess', pgn: 'PGN' } as const;

export function GameTable({ initialFilter = 'all' }: { initialFilter?: 'all' | 'reviewed' | 'unreviewed' }) {
  const settings = useSettings();
  const games = useLiveQuery(() => db.games.toArray(), []);
  const analyses = useLiveQuery(() => completedAnalysisByGame(), []);
  const activeJobs = useLiveQuery(async () => new Set((await db.queue.where('status').anyOf('queued', 'running', 'paused').toArray()).map((j) => j.gameId)), []);
  const [filter, setFilter] = useState(initialFilter);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preset, setPreset] = useState<PresetName | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Game | null>(null);
  const [limit, setLimit] = useState(50);

  const rows = useMemo(() => {
    if (!games || !analyses) return [];
    const q = query.trim().toLowerCase();
    return games
      .filter((g) => (filter === 'reviewed' ? analyses.has(g.id) : filter === 'unreviewed' ? !analyses.has(g.id) : true))
      .filter((g) => !q || `${g.white} ${g.black} ${g.opening ?? ''} ${g.date ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.importedAt - a.importedAt);
  }, [games, analyses, filter, query]);

  if (!games || !analyses) return <div className="skeleton h-40" />;
  if (games.length === 0) {
    return <EmptyState icon={<BookOpenCheck className="size-5" />} title="No games yet" body="Import games from Chess.com, Lichess or a PGN file to start reviewing them." />;
  }
  const effectivePreset = preset ?? settings.preset;
  const visible = rows.slice(0, limit);
  const allVisibleSelected = visible.length > 0 && visible.every((g) => selected.has(g.id));

  const queueSelected = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (ids.length > 25 && !window.confirm(`Queue ${ids.length} games for analysis? This can take a long time on this device. You can pause or cancel at any time.`)) return;
    const n = await enqueueGames(ids, effectivePreset);
    setSelected(new Set());
    toast.success(n ? `${n} game${n === 1 ? '' : 's'} queued for analysis.` : 'Those games are already in the queue.');
    await startQueue();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented
          label="Filter games"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `All (${games.length})` },
            { value: 'unreviewed', label: `Unreviewed (${games.filter((g) => !analyses.has(g.id)).length})` },
            { value: 'reviewed', label: `Reviewed (${analyses.size})` },
          ]}
        />
        <label className="relative sm:w-64">
          <span className="sr-only">Search games</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input className="input pl-9" placeholder="Search players, opening, date" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>

      {selected.size > 0 && (
        <div className="sticky top-14 z-10 flex flex-wrap items-end gap-3 rounded-lg border border-primary/40 bg-elevated p-3 lg:top-0">
          <span className="self-center text-sm">{selected.size} selected</span>
          <Select label="Preset" value={effectivePreset} onChange={(v) => setPreset(v)} options={[{ value: 'fast', label: 'Fast' }, { value: 'balanced', label: 'Balanced' }, { value: 'deep', label: 'Deep' }]} />
          <Button variant="primary" icon={<Play className="size-4" />} onClick={queueSelected}>Review selected</Button>
          <Button variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-surface text-left">
            <tr className="text-xs text-muted">
              <th className="w-10 px-3 py-2">
                <input type="checkbox" aria-label="Select all visible games" checked={allVisibleSelected} onChange={(e) => setSelected(e.target.checked ? new Set([...selected, ...visible.map((g) => g.id)]) : new Set([...selected].filter((id) => !visible.some((g) => g.id === id))))} />
              </th>
              <th className="px-3 py-2 font-medium">Players</th>
              <th className="px-3 py-2 font-medium">Result</th>
              <th className="px-3 py-2 font-medium">Opening</th>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Accuracy</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visible.map((g) => {
              const a = analyses.get(g.id);
              const userAcc = a ? (g.userColor === 'b' ? a.blackAccuracy : a.whiteAccuracy) : null;
              return (
                <tr key={g.id} className={cx('transition-colors hover:bg-surface', selected.has(g.id) && 'bg-primary/5')}>
                  <td className="px-3 py-2">
                    <input type="checkbox" aria-label={`Select ${g.white} vs ${g.black}`} checked={selected.has(g.id)} onChange={(e) => {
                      const s = new Set(selected);
                      if (e.target.checked) s.add(g.id);
                      else s.delete(g.id);
                      setSelected(s);
                    }} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className={cx(g.userColor === 'w' && 'font-semibold')}>{g.white}</span>
                      <span className="text-xs text-muted">{g.whiteElo ?? ''}</span>
                      <span className="text-muted">vs</span>
                      <span className={cx(g.userColor === 'b' && 'font-semibold')}>{g.black}</span>
                      <span className="text-xs text-muted">{g.blackElo ?? ''}</span>
                    </div>
                    <div className="mt-0.5 flex gap-1.5 text-xs text-muted">
                      <span>{SOURCE_LABEL[g.source]}</span>·<span className="capitalize">{g.timeClass}</span>·<span>{Math.ceil(g.plyCount / 2)} moves</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 tabular">{g.result}</td>
                  <td className="max-w-[14rem] truncate px-3 py-2 text-muted" title={g.opening ?? ''}>{g.opening ?? '–'}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted">{formatDate(g.date)}</td>
                  <td className="px-3 py-2 tabular">
                    {a ? (
                      <span title="KnightScope estimate (not equivalent to other sites' scores)">{g.userColor ? pct(userAcc) : `${pct(a.whiteAccuracy, 0)} / ${pct(a.blackAccuracy, 0)}`}</span>
                    ) : activeJobs?.has(g.id) ? (
                      <Badge color="#7C9CFF">queued</Badge>
                    ) : (
                      <span className="text-muted">–</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      {a ? (
                        <Link to={`/review/${encodeURIComponent(g.id)}`} className="rounded-lg px-3 py-1.5 text-xs font-medium text-primary hover:bg-elevated">Open review</Link>
                      ) : (
                        <Button size="sm" variant="ghost" disabled={activeJobs?.has(g.id)} onClick={async () => {
                          await enqueueGames([g.id], effectivePreset);
                          await startQueue();
                          toast.info('Game queued for analysis.');
                        }}>Review</Button>
                      )}
                      <button aria-label={`Delete ${g.white} vs ${g.black}`} className="rounded-lg p-1.5 text-muted hover:bg-elevated hover:text-bad" onClick={() => setConfirmDelete(g)}>
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <Button variant="ghost" onClick={() => setLimit((l) => l + 100)}>Show more ({rows.length - limit} remaining)</Button>
      )}
      {rows.length === 0 && <p className="py-6 text-center text-sm text-muted">No games match this filter.</p>}

      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete game?">
        <p className="text-sm text-muted">
          This permanently removes <span className="text-text">{confirmDelete?.white} vs {confirmDelete?.black}</span>, its review and its recorded mistakes from this device. Training exercises created from it are kept.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Keep game</Button>
          <Button variant="danger" onClick={async () => {
            await deleteGame(confirmDelete!.id);
            setConfirmDelete(null);
            toast.info('Game deleted.');
          }}>Delete</Button>
        </div>
      </Modal>
    </div>
  );
}
