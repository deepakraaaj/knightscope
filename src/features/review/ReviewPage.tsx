import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeftRight, ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, ExternalLink, GraduationCap, Microscope, Play, RotateCcw, Scale } from 'lucide-react';
import { db } from '@/storage/database/db';
import { enqueueGames, latestCompleteAnalysis, positionsFor } from '@/storage/repositories';
import { startQueue } from '@/engine/scheduler/queueRunner';
import { parseSingleGame } from '@/chess/pgn/parsePgn';
import { CLASSIFICATION_META } from '@/chess/classification/classify';
import { CONFIDENCE_META } from '@/chess/classification/confidence';
import { lineToSan } from '@/chess/positions/board';
import { forPlayer } from '@/chess/positions/evaluation';
import { Board } from '@/components/chess/Board';
import { EvalBar } from '@/components/chess/EvalBar';
import { EvalGraph } from '@/components/chess/EvalGraph';
import { MoveList } from '@/components/chess/MoveList';
import { ClassificationBadge, ConfidenceBadge } from '@/components/chess/badges';
import { Badge, Button, Card, EmptyState, IconButton, Notice, Skeleton, cx, toast } from '@/components/ui';
import { useKeyboardNav } from '@/hooks/useKeyboardNav';
import { useSettings } from '@/hooks/data';
import { formatDate, formatEval, pct } from '@/utils/format';
import { safeGameUrl } from '@/utils/sanitize';
import type { Classification, Game, PositionAnalysis } from '@/types';
import { WhyNotMyMove } from './WhyNotMyMove';
import { RetryPanel } from './RetryPanel';
import { addPositionToTraining } from './actions';

const ERROR_CLASSES: Classification[] = ['blunder', 'mistake', 'inaccuracy'];
const SUMMARY_ORDER: Classification[] = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'forced', 'inaccuracy', 'mistake', 'blunder'];

export function ReviewPage() {
  const { gameId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const settings = useSettings();
  const data = useLiveQuery(async () => {
    const game = await db.games.get(gameId);
    if (!game) return { game: null };
    const analysis = await latestCompleteAnalysis(gameId);
    const positions = analysis ? await positionsFor(analysis.id) : [];
    const job = await db.queue.where('gameId').equals(gameId).filter((j) => ['queued', 'running', 'paused'].includes(j.status)).first();
    return { game, analysis, positions, job };
  }, [gameId]);

  if (!data) return <ReviewSkeleton />;
  if (!data.game) return <EmptyState icon={<Scale className="size-5" />} title="Game not found" body="This game is not in your library. It may have been deleted." action={<Link className="text-sm text-primary" to="/games">Back to games</Link>} />;
  return <ReviewBody key={data.analysis?.id ?? 'none'} game={data.game} analysis={data.analysis ?? null} positions={data.positions ?? []} queued={!!data.job} initialPly={Number(params.get('ply') ?? '')} onPly={(ply) => setParams({ ply: String(ply) }, { replace: true })} level={settings.explanationLevel} />;
}

function ReviewSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <Skeleton className="aspect-square w-full max-w-[640px]" />
      <Skeleton className="h-96" />
    </div>
  );
}

interface BodyProps {
  game: Game;
  analysis: import('@/types').Analysis | null;
  positions: PositionAnalysis[];
  queued: boolean;
  initialPly: number;
  onPly: (ply: number) => void;
  level: string;
}

function ReviewBody({ game, analysis, positions, queued, initialPly, onPly }: BodyProps) {
  const parsed = useMemo(() => parseSingleGame(game.pgn), [game.pgn]);
  const total = parsed.moves.length;
  const [cur, setCurState] = useState(() => (Number.isFinite(initialPly) && initialPly >= 0 && initialPly <= total ? initialPly : 0));
  const [flip, setFlip] = useState(game.userColor === 'b');
  const [why, setWhy] = useState(false);
  const [retry, setRetry] = useState(false);
  const [tab, setTab] = useState<'summary' | 'moves'>('summary');
  const byPly = useMemo(() => new Map(positions.map((p) => [p.ply, p])), [positions]);
  const setCur = (n: number) => {
    const v = Math.max(0, Math.min(total, n));
    setCurState(v);
    setRetry(false);
    onPly(v);
  };
  useKeyboardNav({ prev: () => setCur(cur - 1), next: () => setCur(cur + 1), first: () => setCur(0), last: () => setCur(total), flip: () => setFlip((f) => !f) });

  const fen = cur === 0 ? parsed.startFen : parsed.moves[cur - 1].fenAfter;
  const move = cur > 0 ? parsed.moves[cur - 1] : null;
  const p = cur > 0 ? byPly.get(cur - 1) ?? null : null;
  const evalNow = cur === 0 ? positions[0]?.evaluationBefore ?? null : p?.evaluationAfter ?? null;
  const orientation = flip ? 'black' : 'white';
  const showBestArrow = p && p.bestMove && p.bestMove !== p.actualMove && p.classification !== 'book';
  const critical = positions.filter((x) => (ERROR_CLASSES.includes(x.classification!) && (!game.userColor || x.mover === game.userColor || x.classification === 'blunder')) || x.classification === 'brilliant' || x.classification === 'great');
  const counts = (color: 'w' | 'b') => {
    const m = new Map<Classification, number>();
    for (const x of positions) if (x.mover === color && x.classification) m.set(x.classification, (m.get(x.classification) ?? 0) + 1);
    return m;
  };
  const wc = counts('w');
  const bc = counts('b');
  const url = safeGameUrl(game.url);
  const confidenceTally = positions.reduce((acc, x) => {
    const l = x.confidence?.label ?? 'incomplete';
    acc[l] = (acc[l] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const addToTraining = async () => {
    if (!p) return;
    const r = await addPositionToTraining(game, p);
    if (r === 'created') toast.success('Saved as a training exercise.');
    else if (r === 'exists') toast.info('This position is already in your Training Lab.');
    else toast.error('This move cannot be turned into an exercise (no better engine move was recorded).');
  };

  const PlayerBar = ({ color }: { color: 'w' | 'b' }) => {
    const name = color === 'w' ? game.white : game.black;
    const elo = color === 'w' ? game.whiteElo : game.blackElo;
    const acc = analysis ? (color === 'w' ? analysis.whiteAccuracy : analysis.blackAccuracy) : null;
    return (
      <div className="flex items-center justify-between gap-2 py-1.5 text-sm">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cx('size-3 shrink-0 rounded-sm border border-border', color === 'w' ? 'bg-[#e8ecf4]' : 'bg-[#0b1020]')} aria-hidden />
          <span className={cx('truncate', game.userColor === color && 'font-semibold')}>{name}</span>
          {elo && <span className="text-xs text-muted">{elo}</span>}
          {game.userColor === color && <Badge color="#7C9CFF">You</Badge>}
        </div>
        {acc !== null && <span className="text-xs text-muted tabular" title="KnightScope accuracy estimate">Accuracy {pct(acc)}</span>}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold sm:text-xl">{game.white} vs {game.black} <span className="text-muted">· {game.result}</span></h1>
          <p className="text-xs text-muted">
            {formatDate(game.date)} · <span className="capitalize">{game.timeClass}</span>{game.timeControl ? ` (${game.timeControl})` : ''} · {game.opening ?? 'Opening unknown'}
            {url && (
              <a href={url} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex items-center gap-1 text-primary">Source <ExternalLink className="size-3" /></a>
            )}
          </p>
        </div>
        {analysis && (
          <p className="text-xs text-muted">
            {analysis.engineVersion} · {analysis.analysisSettings.preset} preset · depth {analysis.analysisSettings.screeningDepth}/{analysis.analysisSettings.deepDepth}
          </p>
        )}
      </div>

      {!analysis && (
        <Notice kind="info">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{queued ? 'This game is in the analysis queue. The review appears here when it finishes.' : 'This game has not been analyzed yet. You can step through the moves now, or analyze it with Stockfish.'}</span>
            {!queued && (
              <Button size="sm" variant="primary" icon={<Play className="size-3.5" />} onClick={async () => { await enqueueGames([game.id], 'balanced'); await startQueue(); toast.info('Analysis started.'); }}>Analyze game</Button>
            )}
          </div>
        </Notice>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="mx-auto w-full max-w-[680px]">
            <PlayerBar color={flip ? 'w' : 'b'} />
            <div className="flex gap-2">
              {analysis && <div className="hidden sm:flex"><EvalBar evaluation={evalNow} orientation={orientation} /></div>}
              <div className="min-w-0 flex-1">
                {retry && p ? (
                  <RetryPanel key={p.id} p={p} game={game} orientation={orientation} onClose={() => setRetry(false)} />
                ) : (
                  <Board
                    id="review"
                    fen={fen}
                    orientation={orientation}
                    lastMove={move?.uci ?? null}
                    arrows={showBestArrow ? [{ from: p!.bestMove!.slice(0, 2), to: p!.bestMove!.slice(2, 4), color: 'rgba(74,222,128,0.85)' }] : []}
                  />
                )}
              </div>
            </div>
            {analysis && <div className="mt-2 sm:hidden"><EvalBar evaluation={evalNow} horizontal /></div>}
            <PlayerBar color={flip ? 'b' : 'w'} />
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface p-1">
              <div className="flex">
                <IconButton label="Start (Home)" onClick={() => setCur(0)} disabled={cur === 0}><ChevronFirst className="size-5" /></IconButton>
                <IconButton label="Previous move (Left arrow)" onClick={() => setCur(cur - 1)} disabled={cur === 0}><ChevronLeft className="size-5" /></IconButton>
                <IconButton label="Next move (Right arrow)" onClick={() => setCur(cur + 1)} disabled={cur === total}><ChevronRight className="size-5" /></IconButton>
                <IconButton label="End (End)" onClick={() => setCur(total)} disabled={cur === total}><ChevronLast className="size-5" /></IconButton>
              </div>
              <span className="text-xs text-muted tabular">{cur}/{total}</span>
              <IconButton label="Flip board (F)" onClick={() => setFlip((f) => !f)}><ArrowLeftRight className="size-4" /></IconButton>
            </div>
          </div>
          {analysis && positions.length > 0 && (
            <div className="mx-auto w-full max-w-[680px] rounded-lg border border-border bg-surface p-2">
              <EvalGraph positions={positions} current={cur} onSelect={setCur} />
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {p && analysis && (
            <Card padded>
              <div className="flex flex-wrap items-center gap-2" data-testid="current-move">
                <span className="font-display text-lg font-semibold">{Math.floor(p.ply / 2) + 1}{p.mover === 'w' ? '.' : '…'} {p.actualSan}</span>
                <ClassificationBadge c={p.classification} />
                <ConfidenceBadge label={p.confidence?.label} />
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted">Eval before</dt>
                <dd className="tabular">{formatEval(p.evaluationBefore)}</dd>
                <dt className="text-muted">Eval after</dt>
                <dd className="tabular">{formatEval(p.evaluationAfter)}</dd>
                {p.winPercentLoss !== null && p.winPercentLoss > 0.5 && (
                  <>
                    <dt className="text-muted">Winning chances lost</dt>
                    <dd className="tabular">{p.winPercentLoss.toFixed(1)}%</dd>
                  </>
                )}
                {p.centipawnLoss !== null && p.centipawnLoss > 0 && (
                  <>
                    <dt className="text-muted">Centipawn loss</dt>
                    <dd className="tabular">{p.centipawnLoss}</dd>
                  </>
                )}
                <dt className="text-muted">Engine best</dt>
                <dd className="font-medium">{p.bestSan ?? '–'}</dd>
                <dt className="text-muted">Depth</dt>
                <dd className="tabular">{p.depth} <span className="text-xs text-muted">({p.stage === 'deep' ? 'deep pass' : 'screening'})</span></dd>
              </dl>
              {p.principalVariation.length > 0 && (
                <p className="mt-3 text-xs leading-relaxed text-muted">
                  <span className="label mr-1">Line</span>
                  {lineToSan(p.fen, p.principalVariation.slice(0, 10)).join(' ')}
                </p>
              )}
              {p.confidence && p.confidence.reasons.length > 0 && p.confidence.label !== 'stable' && (
                <p className="mt-2 text-xs text-muted">{CONFIDENCE_META[p.confidence.label].description} {p.confidence.reasons[0]}</p>
              )}
              {p.classification === 'brilliant' && <p className="mt-2 text-xs text-muted">Brilliant: a material sacrifice the engine confirmed at multiple depths. This is a heuristic label, not a certainty.</p>}
              {p.bestMove && p.bestMove !== p.actualMove && p.classification !== 'book' && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" variant="primary" icon={<Scale className="size-3.5" />} onClick={() => setWhy(true)}>Why not my move?</Button>
                  <Button size="sm" icon={<RotateCcw className="size-3.5" />} onClick={() => setRetry(true)}>Retry position</Button>
                  <Button size="sm" icon={<GraduationCap className="size-3.5" />} onClick={addToTraining}>Add to training</Button>
                  <Link to={`/analysis?fen=${encodeURIComponent(p.fen)}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs text-muted hover:bg-elevated hover:text-text"><Microscope className="size-3.5" />Analyze</Link>
                </div>
              )}
            </Card>
          )}

          <div className="card flex min-h-0 flex-col">
            <div className="flex border-b border-border" role="tablist">
              {(['summary', 'moves'] as const).map((t) => (
                <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx('flex-1 px-4 py-2.5 text-sm capitalize', tab === t ? 'border-b-2 border-primary text-text' : 'text-muted hover:text-text')}>
                  {t === 'summary' ? 'Review summary' : 'Moves'}
                </button>
              ))}
            </div>
            {tab === 'moves' ? (
              <div className="max-h-[440px] p-2">
                <MoveList moves={parsed.moves.map((m) => ({ ply: m.ply, san: m.san, color: m.color, moveNo: Number(m.fenBefore.split(' ')[5]), analysis: byPly.get(m.ply) }))} current={cur} onSelect={setCur} />
              </div>
            ) : !analysis ? (
              <p className="p-4 text-sm text-muted">The summary appears after analysis.</p>
            ) : (
              <div className="flex flex-col gap-4 p-4">
                <div>
                  <div className="label mb-2">Critical moments</div>
                  {critical.length === 0 ? (
                    <p className="text-sm text-muted">No mistakes or standout moves were detected{game.userColor ? ' for you' : ''}.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5" data-testid="critical-moments">
                      {critical.map((x) => (
                        <button key={x.ply} onClick={() => setCur(x.ply + 1)} className={cx('rounded-md border px-2 py-1 text-xs tabular transition-colors', cur === x.ply + 1 ? 'border-primary bg-primary/10' : 'border-border hover:border-[#3a4a63]')} style={{ color: CLASSIFICATION_META[x.classification!].color }} aria-label={`${CLASSIFICATION_META[x.classification!].label} at move ${Math.floor(x.ply / 2) + 1}`}>
                          {Math.floor(x.ply / 2) + 1}{x.mover === 'w' ? '.' : '…'} {x.actualSan} {CLASSIFICATION_META[x.classification!].symbol}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted">
                      <th className="text-left font-medium">Move quality</th>
                      <th className="w-16 text-right font-medium">White</th>
                      <th className="w-16 text-right font-medium">Black</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="py-1 text-muted">Accuracy</td>
                      <td className="text-right tabular">{pct(analysis.whiteAccuracy)}</td>
                      <td className="text-right tabular">{pct(analysis.blackAccuracy)}</td>
                    </tr>
                    {SUMMARY_ORDER.map((c) => (
                      <tr key={c}>
                        <td className="py-0.5"><span style={{ color: CLASSIFICATION_META[c].color }}>{CLASSIFICATION_META[c].symbol}</span> {CLASSIFICATION_META[c].label}</td>
                        <td className="text-right tabular">{wc.get(c) ?? 0}</td>
                        <td className="text-right tabular">{bc.get(c) ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="text-xs text-muted">
                  <div className="label mb-1">Analysis confidence</div>
                  {Object.entries(confidenceTally).map(([k, v]) => `${CONFIDENCE_META[k as keyof typeof CONFIDENCE_META].label}: ${v}`).join(' · ')}
                  <p className="mt-2">Accuracy is a KnightScope estimate from engine win-chance loss. It is not equivalent to scores on other sites.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <WhyNotMyMove open={why} onClose={() => setWhy(false)} game={game} p={p} />
      {/* evaluation shown to screen readers for the current position */}
      <span className="sr-only" aria-live="polite">{p ? `${p.actualSan}, ${p.classification ?? ''}, evaluation ${formatEval(p.evaluationAfter ? forPlayer(p.evaluationAfter, 'w') : null)}` : ''}</span>
    </div>
  );
}
