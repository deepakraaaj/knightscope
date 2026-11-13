import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BrainCircuit, GraduationCap, ShieldCheck } from 'lucide-react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLibrary } from '@/hooks/data';
import { CATEGORY_LABEL, EMPTY_FILTERS, filterGames, gameTime, groupCount, relevantMistakes, weaknessStats, type GameFilters } from '@/features/analytics/aggregate';
import { Badge, Button, Card, EmptyState, PageHeader, Skeleton, cx, toast } from '@/components/ui';
import { Board } from '@/components/chess/Board';
import { ConfidenceBadge } from '@/components/chess/badges';
import { FilterBar } from '@/features/dashboard/FilterBar';
import { exerciseFromMistake } from '@/features/training/logic';
import { saveExercise } from '@/storage/repositories';
import { db } from '@/storage/database/db';
import { formatDate, formatEval } from '@/utils/format';
import { forPlayer } from '@/chess/positions/evaluation';
import type { Mistake, MistakeCategory } from '@/types';

const SEVERITY_COLOR = { blunder: '#F87171', mistake: '#FB923C', inaccuracy: '#FACC15' } as const;

export function MistakeMemoryPage() {
  const lib = useLibrary();
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState<GameFilters>(EMPTY_FILTERS);
  const category = (params.get('category') as MistakeCategory | null) ?? null;

  const view = useMemo(() => {
    if (!lib) return null;
    const games = filterGames(lib.games, filters).filter((g) => lib.analyses.has(g.id));
    const gameById = new Map(games.map((g) => [g.id, g]));
    const mistakes = relevantMistakes(lib.mistakes, games);
    const dates = new Map(games.map((g) => [g.id, gameTime(g)]));
    const stats = weaknessStats(mistakes, dates);
    const byCost = stats.slice().sort((a, b) => b.totalWinLoss - a.totalWinLoss);
    const recent = mistakes.slice().sort((a, b) => (dates.get(b.gameId) ?? 0) - (dates.get(a.gameId) ?? 0) || b.ply - a.ply);
    return {
      games, gameById, mistakes, stats, byCost, recent,
      byOpening: groupCount(mistakes, (m) => m.opening ?? 'Unknown opening').slice(0, 8),
      byPhase: groupCount(mistakes, (m) => m.phase),
      byTime: groupCount(mistakes, (m) => m.timeClass),
      exercised: new Set(lib.exercises.map((e) => e.sourceMistakeId)),
    };
  }, [lib, filters]);

  if (!lib || !view) return <Skeleton className="h-96" />;
  const anyUsername = lib.games.some((g) => g.userColor);

  const selected = category ? view.recent.filter((m) => m.category === category) : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Mistake memory" description="Recurring mistakes from your analyzed games. A category is assigned only when a detection rule confirmed it against the engine line; everything else stays under Other / Unclassified." />
      <FilterBar filters={filters} onChange={setFilters} games={lib.games} />
      {!anyUsername && lib.games.length > 0 && (
        <p className="text-xs text-muted">No username is set, so mistakes from both players are counted. Set your usernames in <Link to="/settings" className="text-primary">Settings</Link> to focus on your own moves.</p>
      )}
      {view.mistakes.length === 0 ? (
        <Card>
          <EmptyState icon={<BrainCircuit className="size-5" />} title="No mistakes recorded yet" body={view.games.length === 0 ? 'Analyze some games first. Mistake memory fills up from real reviewed games only.' : 'No significant mistakes were found in the analyzed games that match these filters.'} action={<Link to="/import" className="text-sm text-primary">Go to imports</Link>} />
        </Card>
      ) : (
        <>
          <section aria-labelledby="weak-heading">
            <h2 id="weak-heading" className="label mb-3">Your recurring weaknesses · {view.games.length} analyzed games</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {view.stats.map((s) => (
                <button key={s.category} onClick={() => setParams(category === s.category ? {} : { category: s.category })} className={cx('card p-4 text-left transition-colors hover:border-[#3a4a63]', category === s.category && 'border-primary bg-primary/5')} aria-pressed={category === s.category}>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold">{CATEGORY_LABEL[s.category]}</h3>
                    {s.category !== 'other' && <ShieldCheck className="size-4 text-good" aria-label="Rule-verified category" />}
                  </div>
                  <div className="mt-2 font-display text-2xl font-semibold tabular">{s.count}</div>
                  <div className="text-xs text-muted">
                    {s.category === 'other' ? 'occurrences without a confirmed pattern' : `verified occurrence${s.count === 1 ? '' : 's'}`} · {s.games} game{s.games === 1 ? '' : 's'} · avg cost {s.avgWinLoss.toFixed(0)}%
                  </div>
                </button>
              ))}
            </div>
          </section>

          {category && (
            <Card title={`${CATEGORY_LABEL[category]} · ${selected.length} positions`} action={<Button size="sm" variant="ghost" onClick={() => setParams({})}>Close</Button>}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="mistake-positions">
                {selected.slice(0, 30).map((m) => <MistakeCard key={m.id} m={m} hasExercise={view.exercised.has(m.id)} game={view.gameById.get(m.gameId)} />)}
              </div>
              {selected.length > 30 && <p className="mt-3 text-sm text-muted">Showing the 30 most recent of {selected.length}.</p>}
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Most costly mistake types">
              <ul className="space-y-2 text-sm">
                {view.byCost.slice(0, 6).map((s) => (
                  <li key={s.category} className="flex justify-between gap-2">
                    <span>{CATEGORY_LABEL[s.category]}</span>
                    <span className="text-muted tabular">{s.totalWinLoss.toFixed(0)}% total winning chances lost</span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="By game phase and time control">
              <div className="grid grid-cols-2 gap-4 text-sm">
                {[view.byPhase, view.byTime].map((g, i) => (
                  <ul key={i} className="space-y-1.5">
                    {g.map((x) => <li key={x.key} className="flex justify-between capitalize"><span>{x.key}</span><span className="text-muted tabular">{x.count}</span></li>)}
                  </ul>
                ))}
              </div>
            </Card>
            <Card title="Mistakes by opening">
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={view.byOpening} layout="vertical" margin={{ left: 0, right: 12 }}>
                    <XAxis type="number" allowDecimals={false} stroke="#94A3B8" fontSize={11} />
                    <YAxis type="category" dataKey="key" width={150} stroke="#94A3B8" fontSize={11} tickFormatter={(v: string) => (v.length > 24 ? v.slice(0, 23) + '…' : v)} />
                    <Tooltip contentStyle={{ background: '#1A2538', border: '1px solid #29364A', borderRadius: 8, fontSize: 12 }} cursor={{ fill: '#1A2538' }} />
                    <Bar dataKey="count" fill="#7C9CFF" radius={[0, 4, 4, 0]} name="Mistakes" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card title="Recent mistakes">
              <ul className="divide-y divide-border">
                {view.recent.slice(0, 8).map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <Link to={`/review/${encodeURIComponent(m.gameId)}?ply=${m.ply + 1}`} className="min-w-0 truncate hover:text-primary">
                      {m.moveNumber}{m.playerColor === 'w' ? '.' : '…'} {m.actualSan} <span className="text-muted">· {CATEGORY_LABEL[m.category]}</span>
                    </Link>
                    <Badge color={SEVERITY_COLOR[m.severity]}>{m.severity}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function MistakeCard({ m, hasExercise, game }: { m: Mistake; hasExercise: boolean; game?: { white: string; black: string; date: string | null } }) {
  const [saved, setSaved] = useState(hasExercise);
  const add = async () => {
    const pos = await db.positions.get(m.positionId);
    const ex = exerciseFromMistake(m, pos);
    if (!ex) return toast.error('This position cannot be turned into an exercise.');
    const r = await saveExercise(ex);
    setSaved(true);
    toast[r.created ? 'success' : 'info'](r.created ? 'Added to the Training Lab.' : 'Already in the Training Lab.');
  };
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-bg p-3">
      <Board id={`m-${m.id}`} fen={m.fen} orientation={m.playerColor === 'w' ? 'white' : 'black'} arrows={[{ from: m.actualMove.slice(0, 2), to: m.actualMove.slice(2, 4), color: 'rgba(248,113,113,0.85)' }]} />
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="font-medium">{m.moveNumber}{m.playerColor === 'w' ? '.' : '…'} {m.actualSan}</span>
        <Badge color={SEVERITY_COLOR[m.severity]}>{m.severity}</Badge>
        <ConfidenceBadge label={m.confidence} />
      </div>
      <p className="text-xs text-muted">
        {game ? `${game.white} vs ${game.black} · ${formatDate(game.date)}` : ''} · eval {formatEval(forPlayer(m.evaluationBefore, m.playerColor))} → {formatEval(forPlayer(m.evaluationAfter, m.playerColor))}
      </p>
      <div className="mt-auto flex gap-2">
        <Link to={`/review/${encodeURIComponent(m.gameId)}?ply=${m.ply + 1}`} className="inline-flex h-8 items-center rounded-lg bg-elevated px-3 text-xs hover:bg-[#202d44]">Open in review</Link>
        <Button size="sm" variant="ghost" icon={<GraduationCap className="size-3.5" />} onClick={add} disabled={saved}>{saved ? 'In training' : 'Train this'}</Button>
      </div>
    </div>
  );
}
