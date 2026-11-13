import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { Pause, Play, RotateCcw, Square, Trash2 } from 'lucide-react';
import { db } from '@/storage/database/db';
import { clearFinishedJobs } from '@/storage/repositories';
import { cancelAll, cancelJob, pauseAll, resumeAll, retryJob, startQueue, useRunner } from '@/engine/scheduler/queueRunner';
import { Badge, Button, Card, IconButton, Notice, ProgressBar } from '@/components/ui';
import type { QueueJob } from '@/types';

const STATUS_COLOR: Record<QueueJob['status'], string> = { queued: '#94A3B8', running: '#7C9CFF', paused: '#FACC15', done: '#4ADE80', error: '#F87171', cancelled: '#64748B' };
const STAGE_LABEL = { screening: 'Stage A · screening', deep: 'Stage B · selective deep analysis', review: 'Stage C · building review' } as const;

export function QueuePanel() {
  const jobs = useLiveQuery(() => db.queue.orderBy('createdAt').reverse().limit(50).toArray(), []);
  const games = useLiveQuery(async () => new Map((await db.games.toArray()).map((g) => [g.id, g])), []);
  const { running, live, lastError, engineName } = useRunner();
  const queued = jobs?.filter((j) => j.status === 'queued').length ?? 0;
  const paused = jobs?.filter((j) => j.status === 'paused').length ?? 0;
  const finished = jobs?.filter((j) => ['done', 'error', 'cancelled'].includes(j.status)).length ?? 0;

  return (
    <Card
      title={<span id="queue">Analysis queue</span>}
      action={
        <div className="flex flex-wrap gap-2">
          {running ? (
            <Button size="sm" icon={<Pause className="size-3.5" />} onClick={() => pauseAll()}>Pause</Button>
          ) : paused > 0 ? (
            <Button size="sm" variant="primary" icon={<Play className="size-3.5" />} onClick={() => resumeAll()}>Resume ({paused})</Button>
          ) : queued > 0 ? (
            <Button size="sm" variant="primary" icon={<Play className="size-3.5" />} onClick={() => startQueue()}>Start ({queued})</Button>
          ) : null}
          {(running || queued > 0 || paused > 0) && (
            <Button size="sm" variant="danger" icon={<Square className="size-3.5" />} onClick={() => cancelAll()}>Cancel all</Button>
          )}
          {finished > 0 && !running && (
            <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => clearFinishedJobs()}>Clear finished</Button>
          )}
        </div>
      }
    >
      {lastError && <Notice kind="error" className="mb-3">{lastError}</Notice>}
      {running && engineName && <p className="mb-3 text-xs text-muted">Engine: {engineName}. Analysis runs on this device; keep the app open. You can keep using other screens.</p>}
      {paused > 0 && !running && <Notice kind="info" className="mb-3">{paused} game{paused === 1 ? ' is' : 's are'} paused. Analysis resumes from the last saved position when you press Resume.</Notice>}
      {!jobs ? null : jobs.length === 0 ? (
        <p className="text-sm text-muted">No games queued. Select games below and choose “Review selected”.</p>
      ) : (
        <ul className="divide-y divide-border">
          {jobs.map((j) => {
            const g = games?.get(j.gameId);
            const l = live[j.id];
            const stage = l?.stage ?? j.stage;
            const done = l ? (l.stage === 'screening' ? l.positionsDone : l.deepDone) : j.stage === 'deep' ? j.deepDone : j.positionsDone;
            const total = l ? (l.stage === 'screening' ? l.positionsTotal : l.deepTotal) : j.stage === 'deep' ? j.deepTotal : j.positionsTotal;
            return (
              <li key={j.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge color={STATUS_COLOR[j.status]}>{j.status}</Badge>
                    <span className="truncate text-sm">{g ? `${g.white} vs ${g.black}` : 'Deleted game'}</span>
                    <span className="text-xs text-muted">{j.preset}</span>
                  </div>
                  {(j.status === 'running' || j.status === 'paused') && stage && (
                    <div className="mt-2 space-y-1">
                      <div className="flex justify-between text-xs text-muted tabular">
                        <span>{STAGE_LABEL[stage]}</span>
                        <span>
                          {stage === 'review' ? '' : `${done}/${total} positions`}
                          {(l?.currentDepth ?? j.currentDepth) > 0 && ` · depth ${l?.currentDepth ?? j.currentDepth}`}
                        </span>
                      </div>
                      {stage !== 'review' && total > 0 && <ProgressBar value={done} max={total} label="Stage progress" />}
                    </div>
                  )}
                  {j.status === 'error' && <p className="mt-1 text-xs text-bad">{j.error}</p>}
                </div>
                <div className="flex shrink-0 gap-1">
                  {j.status === 'done' && g && (
                    <Link to={`/review/${encodeURIComponent(g.id)}`} className="rounded-lg px-3 py-1.5 text-xs font-medium text-primary hover:bg-elevated">Open review</Link>
                  )}
                  {(j.status === 'error' || j.status === 'cancelled') && (
                    <IconButton label="Retry" onClick={async () => { await retryJob(j.id); startQueue(); }}><RotateCcw className="size-4" /></IconButton>
                  )}
                  {['queued', 'running', 'paused'].includes(j.status) && (
                    <IconButton label="Cancel this game" onClick={() => cancelJob(j.id)}><Square className="size-4" /></IconButton>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
