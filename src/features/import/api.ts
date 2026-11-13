import type { Game, TimeClass } from '@/types';
import { parseSingleGame, toGame } from '@/chess/pgn/parsePgn';
import { cleanUsername } from '@/utils/sanitize';

// Public, unauthenticated APIs only. No credentials or tokens are ever requested or stored.
// Chess.com: https://www.chess.com/news/view/published-data-api  (serial requests; 429 => back off)
// Lichess:   https://lichess.org/api#tag/Games/operation/apiGamesUser (one request at a time; 429 => wait 60s)

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ImportProgress {
  message: string;
  fetched: number;
}

export interface FetchGamesResult {
  games: Game[];
  skipped: { reason: string; count: number }[];
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });

async function fetchWithBackoff(f: FetchLike, url: string, init: RequestInit, signal?: AbortSignal, waitMs = 5000): Promise<Response> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await f(url, { ...init, signal });
    if (res.status !== 429) return res;
    await sleep(waitMs * (attempt + 1), signal);
  }
  throw new Error('The server is rate limiting requests. Please wait a minute and try again.');
}

// ------------------------------------------------------------------ Chess.com

interface ChessComPlayer {
  username: string;
  rating?: number;
  result?: string;
}

export interface ChessComGame {
  url: string;
  pgn?: string;
  time_control?: string;
  time_class?: string;
  rules?: string;
  end_time?: number;
  white: ChessComPlayer;
  black: ChessComPlayer;
  eco?: string;
  uuid?: string;
}

export function chessComTimeClass(tc: string | undefined): TimeClass {
  switch (tc) {
    case 'bullet':
    case 'blitz':
    case 'rapid':
      return tc;
    case 'daily':
      return 'correspondence';
    default:
      return 'unknown';
  }
}

/** Normalize one Chess.com archive entry. Returns null for non-standard or unparsable games. */
export function normalizeChessComGame(g: ChessComGame, usernames: string[]): Game | null {
  if (g.rules && g.rules !== 'chess') return null;
  if (!g.pgn) return null;
  const idMatch = /\/(\d+)(?:\?.*)?$/.exec(g.url ?? '');
  let parsed;
  try {
    parsed = parseSingleGame(g.pgn);
  } catch {
    return null;
  }
  const game = toGame(parsed, {
    source: 'chesscom',
    sourceGameId: idMatch ? idMatch[1] : g.uuid ?? null,
    url: g.url,
    timeClass: chessComTimeClass(g.time_class),
    usernames,
  });
  if (game.whiteElo === null && typeof g.white.rating === 'number') game.whiteElo = g.white.rating;
  if (game.blackElo === null && typeof g.black.rating === 'number') game.blackElo = g.black.rating;
  return game;
}

export async function fetchChessComGames(
  rawUsername: string,
  opts: { maxGames: number; usernames: string[]; signal?: AbortSignal; onProgress?: (p: ImportProgress) => void; fetchImpl?: FetchLike },
): Promise<FetchGamesResult> {
  const f = opts.fetchImpl ?? ((u, i) => fetch(u, i));
  const username = cleanUsername(rawUsername).toLowerCase();
  if (!username) throw new Error('Enter a Chess.com username.');
  opts.onProgress?.({ message: 'Looking up monthly archives…', fetched: 0 });
  const res = await fetchWithBackoff(f, `https://api.chess.com/pub/player/${username}/games/archives`, { headers: { Accept: 'application/json' } }, opts.signal);
  if (res.status === 404) throw new Error(`Chess.com user "${username}" was not found.`);
  if (!res.ok) throw new Error(`Chess.com returned an error (${res.status}). Try again later.`);
  const { archives } = (await res.json()) as { archives?: string[] };
  const months = (archives ?? []).slice().reverse(); // newest first
  const games: Game[] = [];
  let nonStandard = 0;
  for (const url of months) {
    if (games.length >= opts.maxGames) break;
    if (!/^https:\/\/api\.chess\.com\/pub\/player\/[^/]+\/games\/\d{4}\/\d{2}$/.test(url)) continue;
    opts.onProgress?.({ message: `Fetching ${url.slice(-7)}…`, fetched: games.length });
    const r = await fetchWithBackoff(f, url, { headers: { Accept: 'application/json' } }, opts.signal);
    if (!r.ok) throw new Error(`Chess.com archive request failed (${r.status}).`);
    const data = (await r.json()) as { games?: ChessComGame[] };
    const monthGames = (data.games ?? []).slice().sort((a, b) => (b.end_time ?? 0) - (a.end_time ?? 0));
    for (const g of monthGames) {
      if (games.length >= opts.maxGames) break;
      const n = normalizeChessComGame(g, opts.usernames);
      if (n) games.push(n);
      else nonStandard++;
    }
  }
  return { games, skipped: nonStandard ? [{ reason: 'Variant or unreadable games skipped', count: nonStandard }] : [] };
}

// ------------------------------------------------------------------ Lichess

export interface LichessGameJson {
  id: string;
  variant?: string;
  speed?: string;
  status?: string;
  createdAt?: number;
  pgn?: string;
  opening?: { eco?: string; name?: string };
  players?: { white?: { user?: { name?: string }; rating?: number }; black?: { user?: { name?: string }; rating?: number } };
}

export function lichessTimeClass(speed: string | undefined): TimeClass {
  switch (speed) {
    case 'ultraBullet':
    case 'bullet':
      return 'bullet';
    case 'blitz':
    case 'rapid':
    case 'classical':
    case 'correspondence':
      return speed;
    default:
      return 'unknown';
  }
}

export function normalizeLichessGame(g: LichessGameJson, usernames: string[]): Game | null {
  if (g.variant && g.variant !== 'standard') return null;
  if (!g.pgn || g.status === 'started' || g.status === 'created') return null;
  let parsed;
  try {
    parsed = parseSingleGame(g.pgn);
  } catch {
    return null;
  }
  return toGame(parsed, { source: 'lichess', sourceGameId: g.id, url: `https://lichess.org/${g.id}`, timeClass: lichessTimeClass(g.speed), usernames });
}

export async function fetchLichessGames(
  rawUsername: string,
  opts: { maxGames: number; usernames: string[]; signal?: AbortSignal; onProgress?: (p: ImportProgress) => void; fetchImpl?: FetchLike },
): Promise<FetchGamesResult> {
  const f = opts.fetchImpl ?? ((u, i) => fetch(u, i));
  const username = cleanUsername(rawUsername);
  if (!username) throw new Error('Enter a Lichess username.');
  const max = Math.max(1, Math.min(opts.maxGames, 500));
  opts.onProgress?.({ message: 'Requesting games from Lichess…', fetched: 0 });
  const url = `https://lichess.org/api/games/user/${encodeURIComponent(username)}?max=${max}&pgnInJson=true&opening=true&clocks=false&evals=false&ongoing=false&finished=true`;
  const res = await fetchWithBackoff(f, url, { headers: { Accept: 'application/x-ndjson' } }, opts.signal, 60_000);
  if (res.status === 404) throw new Error(`Lichess user "${username}" was not found.`);
  if (!res.ok) throw new Error(`Lichess returned an error (${res.status}). Try again later.`);
  const text = await readStream(res, (n) => opts.onProgress?.({ message: `Received ${n} games…`, fetched: n }));
  const games: Game[] = [];
  let skipped = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const n = normalizeLichessGame(JSON.parse(line) as LichessGameJson, opts.usernames);
      if (n) games.push(n);
      else skipped++;
    } catch {
      skipped++;
    }
  }
  return { games, skipped: skipped ? [{ reason: 'Variant, unfinished or unreadable games skipped', count: skipped }] : [] };
}

async function readStream(res: Response, onLines: (n: number) => void): Promise<string> {
  if (!res.body || typeof res.body.getReader !== 'function') return res.text();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    onLines((text.match(/\n/g) ?? []).length);
  }
  return text + decoder.decode();
}
