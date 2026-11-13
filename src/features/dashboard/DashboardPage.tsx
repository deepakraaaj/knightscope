import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Download, Target } from 'lucide-react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLibrary } from '@/hooks/data';
import { CATEGORY_LABEL, EMPTY_FILTERS, filterGames, gameTime, learningPriorities, relevantMistakes, weaknessStats, type GameFilters } from '@/features/analytics/aggregate';
import { Card, EmptyState, PageHeader, Skeleton, Stat } from '@/components/ui';
import { FilterBar } from './FilterBar';
import { QueuePanel } from '@/features/import/QueuePanel';
import { formatDate, pct } from '@/utils/format';
import { Logo } from '@/components/layout/Logo';

export function DashboardPage() {
  const lib = useLibrary();
  const [filters, setFilters] = useState<GameFilters>(EMPTY_FILTERS);
  const view = useMemo(() => {
    if (!lib) return null;
    const games = filterGames(lib.games, filters);
    const analyzed = games.filter((g) => lib.analyses.has(g.id));
    const mistakes = relevantMistakes(lib.mistakes, analyzed);
    const userAcc = analyzed
      .map((g) => {
        const a = lib.analyses.get(g.id)!;
        return { g, acc: g.userColor === 'w' ? a.whiteAccuracy : g.userColor === 'b' ? a.blackAccuracy : null };
      })
      .filter((x): x is { g: typeof x.g; acc: number } => x.acc !== null);
    const avgAcc = userAcc.length ? userAcc.reduce((s, x) => s + x.acc, 0) / userAcc.length : null;
    const trend = userAcc.sort((a, b) => gameTime(a.g) - gameTime(b.g)).map((x, i) => ({ i: i + 1, acc: Math.round(x.acc * 10) / 10, label: `${x.g.white} vs ${x.g.black}, ${formatDate(x.g.date)}` }));
    const attempts = lib.attempts;
    return {
      games,
      analyzed,
      avgAcc,
      trend,
      weaknesses: weaknessStats(mistakes, new Map()).filter((w) => w.category !== 'other').slice(0, 4),
      priorities: learningPriorities(analyzed, mistakes, lib.analyses, lib.exercises, attempts).slice(0, 3),
      due: lib.exercises.filter((e) => e.nextReviewAt <= Date.now()).length,
      solved: attempts.filter((a) => a.correct).length,
      attempts: attempts.length,
      recent: games.slice().sort((a, b) => gameTime(b) - gameTime(a)).slice(0, 6),
      hasUser: lib.games.some((g) => g.userColor),
    };
  }, [lib, filters]);

  if (!lib || !view) {
    return (
      <div className="grid gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
    );
  }

  if (lib.games.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <div className="card flex flex-col items-start gap-4 p-6 sm:p-10">
          <Logo />
          <h1 className="max-w-xl font-display text-2xl font-semibold sm:text-3xl">Every game teaches you something.</h1>
          <p className="max-w-xl text-muted">KnightScope reviews your finished games with Stockfish on this device, remembers the mistakes you repeat, and turns them into practice positions from your own games.</p>
          <ol className="grid w-full gap-3 text-sm sm:grid-cols-4">
            {['Import games', 'Analyze with Stockfish', 'See recurring mistakes', 'Train your positions'].map((s, i) => (
              <li key={s} className="rounded-lg border border-border bg-bg p-3"><span className="mr-2 text-primary tabular">{i + 1}</span>{s}</li>
            ))}
          </ol>
          <Link to="/import" className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-bg hover:bg-[#93adff]"><Download className="size-4" />Import your first games</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Dashboard" description={view.hasUser ? 'Your games, your mistakes, your training. All numbers come from games analyzed on this device.' : 'Set your Chess.com or Lichess username in Settings so KnightScope can focus on your moves.'} />
      <FilterBar filters={filters} onChange={setFilters} games={lib.games} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Imported games" value={view.games.length} to="/import" />
        <Stat label="Analyzed games" value={view.analyzed.length} hint={view.games.length ? `${Math.round((view.analyzed.length / view.games.length) * 100)}% of imported` : undefined} to="/games" />
        <Stat label="Average accuracy" value={pct(view.avgAcc)} hint={view.avgAcc === null ? (view.hasUser ? 'No analyzed games yet' : 'Needs your username') : 'Your moves, KnightScope estimate'} to="/analytics" />
        <Stat label="Training" value={`${view.solved}/${view.attempts}`} hint={`solved attempts · ${view.due} exercise${view.due === 1 ? '' : 's'} due`} to="/training" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Recurring mistakes" action={<Link to="/mistakes" className="text-xs text-primary">Mistake memory</Link>} className="lg:col-span-1">
          {view.weaknesses.length === 0 ? (
            <p className="text-sm text-muted">{view.analyzed.length ? 'No rule-verified recurring mistakes yet.' : 'Analyze games to discover recurring mistakes.'}</p>
          ) : (
            <ul className="space-y-3">
              {view.weaknesses.map((w) => (
                <li key={w.category}>
                  <Link to={`/mistakes?category=${w.category}`} className="flex items-center justify-between gap-2 rounded-lg p-1 hover:bg-elevated">
                    <span className="text-sm">{CATEGORY_LABEL[w.category]}</span>
                    <span className="text-sm text-muted tabular">{w.count} verified</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Training focus" action={<Link to="/training" className="text-xs text-primary">Training Lab</Link>}>
          {view.priorities.length === 0 ? (
            <p className="text-sm text-muted">Priorities appear once mistakes from your games have been categorized.</p>
          ) : (
            <ol className="space-y-3">
              {view.priorities.map((p, i) => (
                <li key={p.category} className="flex gap-3">
                  <span className="font-display text-lg font-semibold text-primary tabular">{i + 1}</span>
                  <div>
                    <div className="text-sm font-medium">{CATEGORY_LABEL[p.category]}</div>
                    <div className="text-xs text-muted">{p.reasons[0]}</div>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {view.due > 0 && (
            <Link to="/training?mode=daily&minutes=10" className="mt-4 inline-flex items-center gap-1.5 text-sm text-primary"><Target className="size-4" />Start a 10-minute session<ArrowRight className="size-3.5" /></Link>
          )}
        </Card>
        <Card title="Accuracy trend" action={<Link to="/analytics" className="text-xs text-primary">Improvement</Link>}>
          {view.trend.length < 2 ? (
            <p className="text-sm text-muted">At least two analyzed games with your username are needed to show a trend.</p>
          ) : (
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={view.trend} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                  <XAxis dataKey="i" stroke="#94A3B8" fontSize={10} />
                  <YAxis domain={[0, 100]} stroke="#94A3B8" fontSize={10} />
                  <Tooltip contentStyle={{ background: '#1A2538', border: '1px solid #29364A', borderRadius: 8, fontSize: 12 }} labelFormatter={(_, p) => (p?.[0]?.payload as { label?: string })?.label ?? ''} />
                  <Line type="monotone" dataKey="acc" stroke="#7C9CFF" strokeWidth={2} dot={{ r: 2 }} name="Accuracy" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Recent games" action={<Link to="/games" className="text-xs text-primary">All games</Link>}>
          {view.recent.length === 0 ? <EmptyState icon={<Download className="size-5" />} title="No games match" body="Change the filters to see games." /> : (
            <ul className="divide-y divide-border">
              {view.recent.map((g) => {
                const a = lib.analyses.get(g.id);
                return (
                  <li key={g.id}>
                    <Link to={`/review/${encodeURIComponent(g.id)}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-primary">
                      <span className="min-w-0 truncate text-sm">{g.white} vs {g.black} <span className="text-muted">· {g.result}</span></span>
                      <span className="shrink-0 text-xs text-muted">{a ? 'Reviewed' : 'Not analyzed'} · {formatDate(g.date)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <QueuePanel />
      </div>
    </div>
  );
}
