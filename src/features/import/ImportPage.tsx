import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ClipboardPaste, FileUp, Globe } from 'lucide-react';
import { db } from '@/storage/database/db';
import { addGames, allUsernames, completedAnalysisByGame, getSettings, refreshUserColors, saveSettings } from '@/storage/repositories';
import { fetchChessComGames, fetchLichessGames } from './api';
import { MAX_PGN_FILE_BYTES, parseMultiPgn, toGame, type ParseFailure } from '@/chess/pgn/parsePgn';
import { Button, Card, Notice, PageHeader, Segmented, Stat, toast } from '@/components/ui';
import { GameTable } from './GameTable';
import { QueuePanel } from './QueuePanel';
import { cleanUsername } from '@/utils/sanitize';
import type { Game } from '@/types';

type Tab = 'chesscom' | 'lichess' | 'file' | 'paste';
const MAX_FILES = 20;

interface Outcome {
  added: number;
  duplicates: number;
  failures: ParseFailure[];
  skipped: { reason: string; count: number }[];
}

export function ImportPage() {
  const [tab, setTab] = useState<Tab>('chesscom');
  const [username, setUsername] = useState('');
  const [maxGames, setMaxGames] = useState(50);
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const stats = useLiveQuery(async () => {
    const [total, analyses, queued] = await Promise.all([db.games.count(), completedAnalysisByGame(), db.queue.where('status').anyOf('queued', 'running', 'paused').count()]);
    return { total, reviewed: analyses.size, queued };
  }, []);

  const finish = async (games: Game[], failures: ParseFailure[] = [], skipped: Outcome['skipped'] = []) => {
    const res = await addGames(games);
    setOutcome({ added: res.added.length, duplicates: res.duplicates, failures, skipped });
    if (res.added.length) toast.success(`${res.added.length} new game${res.added.length === 1 ? '' : 's'} imported.`);
    else if (games.length) toast.info('No new games: all of them were already in your library.');
  };

  const run = async (fn: (signal: AbortSignal) => Promise<void>) => {
    setBusy(true);
    setError(null);
    setOutcome(null);
    abortRef.current = new AbortController();
    try {
      await fn(abortRef.current.signal);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message || 'Import failed.');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const importOnline = (source: 'chesscom' | 'lichess') =>
    run(async (signal) => {
      const name = cleanUsername(username);
      if (!name) throw new Error('Enter a username.');
      // Remember the username as the player's own account so reviews focus on their moves.
      const s = await getSettings();
      if (!s.usernames[source]) {
        await saveSettings({ usernames: { ...s.usernames, [source]: name } });
      }
      const usernames = allUsernames(await getSettings());
      const opts = { maxGames, usernames, signal, onProgress: (p: { message: string }) => setProgress(p.message) };
      const r = source === 'chesscom' ? await fetchChessComGames(name, opts) : await fetchLichessGames(name, opts);
      await finish(r.games, [], r.skipped);
      await refreshUserColors(usernames);
    });

  const importText = (text: string) =>
    run(async () => {
      const usernames = allUsernames(await getSettings());
      const { games, failures } = parseMultiPgn(text);
      if (games.length === 0 && failures.length === 0) throw new Error('No games found in this text.');
      await finish(games.map((g) => toGame(g, { usernames })), failures);
    });

  const importFiles = (files: FileList | null) =>
    run(async () => {
      if (!files || files.length === 0) return;
      if (files.length > MAX_FILES) throw new Error(`Select at most ${MAX_FILES} files at a time.`);
      const usernames = allUsernames(await getSettings());
      const all: Game[] = [];
      const failures: ParseFailure[] = [];
      for (const f of Array.from(files)) {
        if (f.size > MAX_PGN_FILE_BYTES) {
          failures.push({ index: 0, message: `${f.name} is larger than ${MAX_PGN_FILE_BYTES / 1024 / 1024} MB and was skipped.`, excerpt: '' });
          continue;
        }
        setProgress(`Reading ${f.name}…`);
        const text = await f.text();
        try {
          const r = parseMultiPgn(text);
          all.push(...r.games.map((g) => toGame(g, { usernames })));
          failures.push(...r.failures.map((x) => ({ ...x, message: `${f.name}: ${x.message}` })));
        } catch (e) {
          failures.push({ index: 0, message: `${f.name}: ${(e as Error).message}`, excerpt: '' });
        }
      }
      await finish(all, failures);
      if (fileRef.current) fileRef.current.value = '';
    });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Import games" description="Bring in completed games from Chess.com, Lichess or PGN files. Imports are de-duplicated and stored only on this device." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Imported games" value={stats?.total ?? '–'} />
        <Stat label="Reviewed" value={stats?.reviewed ?? '–'} />
        <Stat label="Unreviewed" value={stats ? stats.total - stats.reviewed : '–'} />
        <Stat label="In analysis queue" value={stats?.queued ?? '–'} to="/import#queue" />
      </div>

      <Card>
        <div className="mb-4">
          <Segmented
            label="Import source"
            value={tab}
            onChange={(t) => { setTab(t); setError(null); setOutcome(null); }}
            options={[
              { value: 'chesscom', label: 'Chess.com' },
              { value: 'lichess', label: 'Lichess' },
              { value: 'file', label: 'PGN files' },
              { value: 'paste', label: 'Paste PGN' },
            ]}
          />
        </div>

        {(tab === 'chesscom' || tab === 'lichess') && (
          <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); importOnline(tab); }}>
            <label className="flex flex-1 flex-col gap-1">
              <span className="label">{tab === 'chesscom' ? 'Chess.com' : 'Lichess'} username</span>
              <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" autoCapitalize="off" autoCorrect="off" spellCheck={false} maxLength={50} />
            </label>
            <label className="flex flex-col gap-1 sm:w-40">
              <span className="label">Most recent games</span>
              <input className="input" type="number" min={1} max={500} value={maxGames} onChange={(e) => setMaxGames(Math.max(1, Math.min(500, Number(e.target.value) || 1)))} />
            </label>
            {busy ? (
              <Button type="button" variant="secondary" onClick={() => abortRef.current?.abort()}>Stop</Button>
            ) : (
              <Button type="submit" variant="primary" icon={<Globe className="size-4" />}>Import</Button>
            )}
          </form>
        )}
        {(tab === 'chesscom' || tab === 'lichess') && (
          <p className="mt-2 text-xs text-muted">Uses the public {tab === 'chesscom' ? 'Chess.com Published-Data' : 'Lichess'} API. No password or login is needed or stored. Only finished standard games are imported.</p>
        )}

        {tab === 'file' && (
          <div className="flex flex-col gap-2">
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-10 text-center hover:border-primary/60">
              <FileUp className="size-6 text-primary" />
              <span className="text-sm">Choose one or more .pgn files</span>
              <span className="text-xs text-muted">Up to {MAX_FILES} files, {MAX_PGN_FILE_BYTES / 1024 / 1024} MB each, 2,000 games per file</span>
              <input ref={fileRef} type="file" accept=".pgn,application/x-chess-pgn,text/plain" multiple className="sr-only" onChange={(e) => importFiles(e.target.files)} data-testid="pgn-file-input" />
            </label>
          </div>
        )}

        {tab === 'paste' && (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="label">PGN text</span>
              <textarea className="input min-h-40 font-mono text-xs" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'[Event "..."]\n\n1. e4 e5 2. Nf3 ...'} spellCheck={false} data-testid="pgn-paste" />
            </label>
            <div>
              <Button variant="primary" icon={<ClipboardPaste className="size-4" />} disabled={!paste.trim() || busy} loading={busy} onClick={() => importText(paste)}>Import PGN</Button>
            </div>
          </div>
        )}

        {busy && progress && <p className="mt-3 text-sm text-muted" role="status">{progress}</p>}
        {error && <Notice kind="error" className="mt-3">{error}</Notice>}
        {outcome && (
          <Notice kind={outcome.added ? 'success' : 'info'} className="mt-3">
            <div data-testid="import-outcome">
              {outcome.added} new game{outcome.added === 1 ? '' : 's'} added{outcome.duplicates ? `, ${outcome.duplicates} already in your library` : ''}.
              {outcome.skipped.map((s) => <div key={s.reason}>{s.reason}: {s.count}</div>)}
              {outcome.failures.length > 0 && (
                <details className="mt-1">
                  <summary className="cursor-pointer">{outcome.failures.length} game{outcome.failures.length === 1 ? '' : 's'} could not be read</summary>
                  <ul className="mt-1 list-disc pl-5 text-xs">
                    {outcome.failures.slice(0, 20).map((f, i) => <li key={i}>{f.message}{f.excerpt && ` (${f.excerpt}…)`}</li>)}
                  </ul>
                </details>
              )}
            </div>
          </Notice>
        )}
      </Card>

      <QueuePanel />

      <Card title="Your library">
        <GameTable />
      </Card>
    </div>
  );
}
