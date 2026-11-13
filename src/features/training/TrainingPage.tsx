import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarClock, Target, Timer } from 'lucide-react';
import { useLibrary } from '@/hooks/data';
import { CATEGORY_LABEL, buildDailySession, learningPriorities, relevantMistakes } from '@/features/analytics/aggregate';
import { Badge, Button, Card, EmptyState, Notice, PageHeader, Segmented, Skeleton, cx } from '@/components/ui';
import { ExercisePlayer } from './ExercisePlayer';
import type { MistakeCategory, TrainingExercise } from '@/types';

export function TrainingPage() {
  const lib = useLibrary();
  const [params, setParams] = useSearchParams();
  const [list, setList] = useState<'due' | 'all'>('due');
  const [category, setCategory] = useState<MistakeCategory | 'all'>('all');
  // A session is a frozen list of exercise ids, so finishing one does not reorder the queue.
  const [session, setSession] = useState<{ ids: string[]; index: number; note: string | null; label: string } | null>(null);
  const exerciseParam = params.get('exercise');

  const data = useMemo(() => {
    if (!lib) return null;
    const analyzed = lib.games.filter((g) => lib.analyses.has(g.id));
    const mistakes = relevantMistakes(lib.mistakes, analyzed);
    const priorities = learningPriorities(analyzed, mistakes, lib.analyses, lib.exercises, lib.attempts);
    const byId = new Map(lib.exercises.map((e) => [e.id, e]));
    return { priorities, byId, exercises: lib.exercises, attempts: lib.attempts.slice().sort((a, b) => b.attemptedAt - a.attemptedAt) };
  }, [lib]);

  // Deep link from the dashboard: /training?mode=daily&minutes=10 starts a session once data is loaded.
  const dailyParam = params.get('mode') === 'daily' ? Number(params.get('minutes')) : null;
  useEffect(() => {
    if (!data || dailyParam === null) return;
    const minutes = dailyParam === 5 || dailyParam === 20 ? dailyParam : 10;
    const s = buildDailySession(minutes, data.exercises, data.priorities);
    setSession({ ids: s.exercises.map((e) => e.id), index: 0, note: s.note, label: `${minutes}-minute session` });
    setParams({}, { replace: true });
  }, [data, dailyParam, setParams]);

  if (!lib || !data) return <Skeleton className="h-96" />;
  const now = Date.now();
  const startSession = (ids: string[], label: string, note: string | null = null) => {
    if (ids.length === 0) return;
    setSession({ ids, index: 0, note, label });
    setParams({});
    window.scrollTo({ top: 0 });
  };
  const daily = (minutes: 5 | 10 | 20) => {
    const s = buildDailySession(minutes, data.exercises, data.priorities, now);
    if (s.exercises.length === 0) {
      setSession({ ids: [], index: 0, note: s.note, label: `${minutes}-minute session` });
      return;
    }
    startSession(s.exercises.map((e) => e.id), `${minutes}-minute session`, s.note);
  };
  const current: TrainingExercise | undefined = session && session.ids.length ? data.byId.get(session.ids[session.index]) : exerciseParam ? data.byId.get(exerciseParam) : undefined;

  const filtered = data.exercises
    .filter((e) => (list === 'due' ? e.nextReviewAt <= now : true))
    .filter((e) => (category === 'all' ? true : e.category === category))
    .sort((a, b) => a.nextReviewAt - b.nextReviewAt);
  const cats = [...new Set(data.exercises.map((e) => e.category))];
  const solved = data.attempts.filter((a) => a.correct).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Training lab" description="Practice positions taken from your own analyzed games. Stockfish checks every move, and accepts any move that is about as good as its choice." />

      {current ? (
        <Card title={session ? `${session.label} · ${session.index + 1} of ${session.ids.length}` : 'Exercise'} action={<Button size="sm" variant="ghost" onClick={() => { setSession(null); setParams({}); }}>End</Button>}>
          {session?.note && <Notice kind="info" className="mb-4">{session.note}</Notice>}
          <ExercisePlayer
            exercise={current}
            hasNext={!!session && session.index < session.ids.length - 1}
            onNext={() => session && setSession({ ...session, index: Math.min(session.ids.length - 1, session.index + 1) })}
          />
          {session && session.index === session.ids.length - 1 && <p className="mt-4 text-sm text-muted">This is the last exercise in the session.</p>}
        </Card>
      ) : session && session.ids.length === 0 ? (
        <Notice kind="info">{session.note}</Notice>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="This week's training focus" className="lg:col-span-2">
          {data.priorities.length === 0 ? (
            <p className="text-sm text-muted">Not enough categorized mistakes yet. Analyze more games so priorities can be calculated from your own play.</p>
          ) : (
            <ol className="space-y-4">
              {data.priorities.slice(0, 5).map((p, i) => (
                <li key={p.category} className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex gap-3">
                    <span className="font-display text-xl font-semibold text-primary tabular">{i + 1}</span>
                    <div>
                      <div className="font-medium">{CATEGORY_LABEL[p.category]}</div>
                      <ul className="mt-0.5 text-xs text-muted">{p.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                    </div>
                  </div>
                  {p.availableExercises > 0 ? (
                    <Button size="sm" onClick={() => startSession(data.exercises.filter((e) => e.category === p.category).sort((a, b) => a.nextReviewAt - b.nextReviewAt).map((e) => e.id), CATEGORY_LABEL[p.category])}>
                      Practice ({p.availableExercises})
                    </Button>
                  ) : (
                    <Link to={`/mistakes?category=${p.category}`} className="text-xs text-primary">Create exercises in Mistake memory</Link>
                  )}
                </li>
              ))}
            </ol>
          )}
          <p className="mt-4 text-xs text-muted">Ranking = recent frequency, severity, training results and whether the pattern returned after training. The full formula is shown in Improvement analytics.</p>
        </Card>
        <Card title={<span className="flex items-center gap-2"><Timer className="size-4 text-primary" />Daily practice</span>}>
          <p className="mb-3 text-sm text-muted">A session of due exercises from your top priorities.</p>
          <div className="flex flex-wrap gap-2">
            {([5, 10, 20] as const).map((m) => <Button key={m} variant={m === 10 ? 'primary' : 'secondary'} onClick={() => daily(m)}>{m} minutes</Button>)}
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
            <dt className="text-muted">Exercises</dt><dd className="tabular">{data.exercises.length}</dd>
            <dt className="text-muted">Due now</dt><dd className="tabular">{data.exercises.filter((e) => e.nextReviewAt <= now).length}</dd>
            <dt className="text-muted">Correct attempts</dt><dd className="tabular">{solved}/{data.attempts.length}</dd>
          </dl>
        </Card>
      </div>

      <Card title="Exercises" action={<Segmented label="Exercise list" value={list} onChange={setList} options={[{ value: 'due', label: 'Due' }, { value: 'all', label: 'All' }]} />}>
        {data.exercises.length === 0 ? (
          <EmptyState icon={<Target className="size-5" />} title="No exercises yet" body="Exercises come from real mistakes in your analyzed games. Open a review and choose “Add to training”, or use “Train this” in Mistake memory." action={<Link to="/mistakes" className="text-sm text-primary">Open Mistake memory</Link>} />
        ) : (
          <>
            {cats.length > 1 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {(['all', ...cats] as const).map((c) => (
                  <button key={c} onClick={() => setCategory(c)} className={cx('rounded-md border px-2 py-1 text-xs', category === c ? 'border-primary bg-primary/10 text-text' : 'border-border text-muted hover:text-text')}>
                    {c === 'all' ? 'All categories' : CATEGORY_LABEL[c]}
                  </button>
                ))}
              </div>
            )}
            {filtered.length === 0 ? (
              <p className="py-4 text-sm text-muted">{list === 'due' ? 'Nothing is due right now. Switch to “All” to practise anyway.' : 'No exercises in this category.'}</p>
            ) : (
              <ul className="divide-y divide-border">
                {filtered.slice(0, 100).map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div className="min-w-0">
                      <div className="text-sm">{e.goal.split('.')[0]}. <span className="text-muted">{CATEGORY_LABEL[e.category]}</span></div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                        <CalendarClock className="size-3.5" />
                        {e.nextReviewAt <= now ? 'Due now' : `Next review ${new Date(e.nextReviewAt).toLocaleDateString()}`}
                        · {e.successes}/{e.attempts} solved
                        {e.lastResult && <Badge color={e.lastResult === 'success' ? '#4ADE80' : '#F87171'}>{e.lastResult}</Badge>}
                      </div>
                    </div>
                    <Button size="sm" onClick={() => startSession(filtered.map((x) => x.id).slice(filtered.indexOf(e)), list === 'due' ? 'Due exercises' : 'Exercises')}>Practice</Button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Card>

      <Card title="Training history">
        {data.attempts.length === 0 ? (
          <p className="text-sm text-muted">No attempts yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead><tr className="text-left text-xs text-muted"><th className="py-1 font-medium">Date</th><th className="font-medium">Category</th><th className="font-medium">Result</th><th className="font-medium">Time</th><th className="font-medium">Notes</th></tr></thead>
              <tbody className="divide-y divide-border">
                {data.attempts.slice(0, 30).map((a) => (
                  <tr key={a.id}>
                    <td className="py-1.5 text-muted">{new Date(a.attemptedAt).toLocaleString()}</td>
                    <td>{CATEGORY_LABEL[a.category]}</td>
                    <td><Badge color={a.correct ? '#4ADE80' : '#F87171'}>{a.correct ? 'Solved' : 'Missed'}</Badge></td>
                    <td className="tabular text-muted">{Math.round(a.timeSpentMs / 1000)}s</td>
                    <td className="text-xs text-muted">{[a.usedHint && 'hint used', a.revealedSolution && 'solution shown'].filter(Boolean).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted">Review intervals follow a simple fixed schedule (1, 3, 7, 14, 30 days after correct answers). It is a practice aid, not a scientifically validated memory model.</p>
      </Card>
    </div>
  );
}
