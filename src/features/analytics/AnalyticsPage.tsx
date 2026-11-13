import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRightLeft, BarChart3, ListOrdered, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { CATEGORY_INFO } from '@/features/mistake-memory/categories';
import { useLibrary } from '@/hooks/data';
import { CATEGORY_LABEL, EMPTY_FILTERS, MIN_WINDOW_GAMES, filterGames, improvementComparison, learningPriorities, relevantMistakes, trainingTransfer, type GameFilters, type WindowStats } from './aggregate';
import { Badge, Card, EmptyState, IconChip, PageHeader, Segmented, Skeleton } from '@/components/ui';
import { FilterBar } from '@/features/dashboard/FilterBar';
import { formatDate } from '@/utils/format';

function WindowCell({ w }: { w: WindowStats }) {
  return (
    <div className="text-sm">
      <div className="font-display text-xl font-semibold tabular">{w.occurrences}</div>
      <div className="text-xs text-muted">
        in {w.games} games ({w.perGame.toFixed(2)}/game)
      </div>
      <div className="mt-1 text-[11px] leading-relaxed text-muted">
        {w.from ? `${formatDate(w.from)} – ${formatDate(w.to)}` : 'dates unknown'} · ~{w.userMoves} moves checked
        <br />
        {w.timeClasses.map((t) => `${t.count} ${t.key}`).join(', ')}
        {w.opponentRating && <><br />opponents {w.opponentRating.min}–{w.opponentRating.max}</>}
        {w.presets.length > 0 && <><br />analysis: {w.presets.join(', ')}</>}
      </div>
    </div>
  );
}

export function AnalyticsPage() {
  const lib = useLibrary();
  const [filters, setFilters] = useState<GameFilters>(EMPTY_FILTERS);
  const [windowSize, setWindowSize] = useState<'10' | '20' | '50'>('20');
  const view = useMemo(() => {
    if (!lib) return null;
    const games = filterGames(lib.games, filters).filter((g) => lib.analyses.has(g.id));
    const mistakes = relevantMistakes(lib.mistakes, games);
    return {
      games,
      rows: improvementComparison(games, mistakes, lib.analyses, Number(windowSize)).filter((r) => r.category !== 'other'),
      transfer: trainingTransfer(games, mistakes, lib.analyses, lib.exercises, lib.attempts),
      priorities: learningPriorities(games, mistakes, lib.analyses, lib.exercises, lib.attempts),
    };
  }, [lib, filters, windowSize]);

  if (!lib || !view) return <Skeleton className="h-96" />;
  const n = Math.min(Number(windowSize), Math.floor(view.games.length / 2));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader icon={BarChart3} steps={['Analyze at least 10 games', 'Compare older vs recent games', 'Check whether training carries over']} title="Improvement analytics" description="Are specific mistakes becoming less frequent? Each weakness is tracked separately, with the context you need to judge the comparison." />
      <FilterBar filters={filters} onChange={setFilters} games={lib.games} />
      {view.games.length === 0 ? (
        <Card><EmptyState icon={<BarChart3 className="size-5" />} title="No analyzed games" body="Analytics are calculated from your analyzed games only." action={<Link to="/import" className="text-sm text-primary">Import and analyze games</Link>} /></Card>
      ) : (
        <>
          <Card icon={TrendingDown} piece="pawn" title="Mistake frequency: earlier vs recent games" hint="Fewer occurrences per game = the pattern shows up less often" action={<Segmented label="Window size" value={windowSize} onChange={setWindowSize} options={[{ value: '10', label: '10 games' }, { value: '20', label: '20 games' }, { value: '50', label: '50 games' }]} />}>
            {n < MIN_WINDOW_GAMES ? (
              <p className="text-sm text-muted">{view.games.length} analyzed game{view.games.length === 1 ? '' : 's'} match the filters. At least {MIN_WINDOW_GAMES * 2} are needed for a comparison ({MIN_WINDOW_GAMES} per period).</p>
            ) : view.rows.length === 0 ? (
              <p className="text-sm text-muted">No categorized mistakes in these games.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px]">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="pb-2 font-medium">Weakness</th>
                      <th className="pb-2 font-medium">Previous {n} games</th>
                      <th className="pb-2 font-medium">Recent {n} games</th>
                      <th className="pb-2 font-medium">Observation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border align-top">
                    {view.rows.map((r) => (
                      <tr key={r.category}>
                        <td className="py-3 pr-3 text-sm font-medium"><span className="flex items-center gap-2"><IconChip icon={CATEGORY_INFO[r.category].icon} color={CATEGORY_INFO[r.category].color} size="sm" />{CATEGORY_LABEL[r.category]}</span></td>
                        <td className="py-3 pr-3"><WindowCell w={r.previous} /></td>
                        <td className="py-3 pr-3"><WindowCell w={r.recent} /></td>
                        <td className="py-3 text-sm">
                          <div className="flex items-start gap-2">
                            {r.verdict === 'fewer' ? <TrendingDown className="mt-0.5 size-4 shrink-0 text-good" /> : r.verdict === 'more' ? <TrendingUp className="mt-0.5 size-4 shrink-0 text-bad" /> : <Minus className="mt-0.5 size-4 shrink-0 text-muted" />}
                            <span>{r.message}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-muted">This compares how often a pattern was detected, not why. Opponents, time controls, openings and analysis depth can all differ between periods, so a change does not prove improvement. A change is only reported when it is at least 2 occurrences and 25%.</p>
          </Card>

          <Card icon={ArrowRightLeft} piece="knight" title="Training transfer" hint="Does practising a pattern help you avoid it in real games?">
            {view.transfer.length === 0 ? (
              <p className="text-sm text-muted">No training exercises yet. Training transfer compares your exercise results with what happens in your later games.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="pb-2 font-medium">Weakness</th>
                      <th className="pb-2 font-medium">1 · Solving exercises</th>
                      <th className="pb-2 font-medium">2 · Occurrences per game, before → after training</th>
                      <th className="pb-2 font-medium">Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border align-top">
                    {view.transfer.map((t) => (
                      <tr key={t.category}>
                        <td className="py-3 pr-3 font-medium"><span className="flex items-center gap-2"><IconChip icon={CATEGORY_INFO[t.category].icon} color={CATEGORY_INFO[t.category].color} size="sm" />{CATEGORY_LABEL[t.category]}</span></td>
                        <td className="py-3 pr-3 tabular">{t.solveRate === null ? '–' : `${Math.round(t.solveRate * 100)}%`} <span className="text-xs text-muted">({t.attempts} attempts, {t.exercises} exercises)</span></td>
                        <td className="py-3 pr-3 tabular">
                          {t.rateBefore === null ? '–' : t.rateBefore.toFixed(2)} → {t.rateAfter === null ? '–' : t.rateAfter.toFixed(2)}
                          <div className="text-xs text-muted">{t.gamesBefore} games before · {t.gamesAfter} after</div>
                        </td>
                        <td className="py-3 text-xs text-muted">{t.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-muted">Solving exercises and avoiding the mistake in real games are different skills. Both are shown so you can see whether practice is carrying over.</p>
          </Card>

          <Card icon={ListOrdered} title="How training priorities are ranked" hint="A transparent formula, no AI">
            <p className="text-sm text-muted">score = 1.0 × occurrences in your last 30 analyzed games + 1.5 × occurrences in the last 10 + 2.0 × (average winning-chance loss ÷ 10) + 3.0 × training failure rate (after 3+ attempts) + 1.0 if the pattern returned after training began.</p>
            {view.priorities.length > 0 && (
              <ol className="mt-3 space-y-1 text-sm">
                {view.priorities.slice(0, 8).map((p, i) => (
                  <li key={p.category} className="flex justify-between gap-2">
                    <span>{i + 1}. {CATEGORY_LABEL[p.category]}</span>
                    <Badge color="#7C9CFF">{p.score.toFixed(1)}</Badge>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
