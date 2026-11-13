import { Chess } from 'chess.js';
import type { Color, Game, GameResult, GameSource, TimeClass } from '@/types';
import { cyrb53 } from '@/utils/hash';
import { cleanText } from '@/utils/sanitize';
import { lookupOpening } from '@/chess/openings/openings';

export const MAX_PGN_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per file
export const MAX_GAMES_PER_IMPORT = 2000;
export const MAX_SINGLE_GAME_CHARS = 200_000;

export interface GameMove {
  ply: number;
  color: Color;
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
}

export interface ParsedGame {
  headers: Record<string, string>;
  moves: GameMove[];
  startFen: string;
  pgn: string;
}

export interface ParseFailure {
  index: number;
  message: string;
  excerpt: string;
}

/** Split a multi-game PGN text into individual game strings. */
export function splitPgn(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  const lines = normalized.split('\n');
  const games: string[] = [];
  let current: string[] = [];
  let seenMoves = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[') && seenMoves) {
      games.push(current.join('\n').trim());
      current = [];
      seenMoves = false;
    }
    if (trimmed && !trimmed.startsWith('[') && !trimmed.startsWith('%')) seenMoves = true;
    current.push(line);
  }
  const last = current.join('\n').trim();
  if (last) games.push(last);
  return games.filter((g) => g.length > 0);
}

/** Parse one game. Throws a readable Error when the PGN is invalid. */
export function parseSingleGame(pgn: string): ParsedGame {
  if (pgn.length > MAX_SINGLE_GAME_CHARS) throw new Error('Game text is too large to be a valid PGN game.');
  const chess = new Chess();
  try {
    chess.loadPgn(pgn, { strict: false });
  } catch (e) {
    throw new Error(`Invalid PGN: ${(e as Error).message.slice(0, 160)}`);
  }
  const headers = chess.getHeaders();
  const history = chess.history({ verbose: true });
  if (history.length === 0) throw new Error('The game contains no moves.');
  const startFen = history[0].before;
  const moves: GameMove[] = history.map((m, i) => ({
    ply: i,
    color: m.color,
    san: m.san,
    uci: m.from + m.to + (m.promotion ?? ''),
    fenBefore: m.before,
    fenAfter: m.after,
  }));
  return { headers, moves, startFen, pgn: chess.pgn() };
}

export function parseMultiPgn(text: string): { games: ParsedGame[]; failures: ParseFailure[] } {
  if (new Blob([text]).size > MAX_PGN_FILE_BYTES) {
    throw new Error(`PGN is larger than ${MAX_PGN_FILE_BYTES / 1024 / 1024} MB. Split it into smaller files.`);
  }
  const chunks = splitPgn(text);
  if (chunks.length > MAX_GAMES_PER_IMPORT) {
    throw new Error(`This PGN contains ${chunks.length} games. The limit per import is ${MAX_GAMES_PER_IMPORT}.`);
  }
  const games: ParsedGame[] = [];
  const failures: ParseFailure[] = [];
  chunks.forEach((chunk, index) => {
    try {
      games.push(parseSingleGame(chunk));
    } catch (e) {
      failures.push({ index, message: (e as Error).message, excerpt: cleanText(chunk.slice(0, 80), 80) });
    }
  });
  return { games, failures };
}

export function timeClassFromControl(tc: string | null | undefined): TimeClass {
  if (!tc || tc === '?' || tc === '') return 'unknown';
  if (tc === '-' || tc.includes('/')) return 'correspondence';
  const m = /^(\d+)(?:\+(\d+))?$/.exec(tc.trim());
  if (!m) return 'unknown';
  const total = Number(m[1]) + 40 * Number(m[2] ?? 0);
  if (total < 180) return 'bullet';
  if (total < 480) return 'blitz';
  if (total < 1500) return 'rapid';
  return 'classical';
}

function parseResult(r: string | undefined): GameResult {
  return r === '1-0' || r === '0-1' || r === '1/2-1/2' ? r : '*';
}

function parseDate(d: string | undefined): string | null {
  if (!d) return null;
  const m = /^(\d{4})[.-](\d{2})[.-](\d{2})$/.exec(d.trim());
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function parseElo(v: string | undefined): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 4000 ? Math.round(n) : null;
}

/** Recognise Chess.com / Lichess game ids from PGN headers so uploads deduplicate against API imports. */
export function detectSourceId(headers: Record<string, string>): { source: GameSource; id: string } | null {
  const link = headers.Link ?? '';
  const cc = /chess\.com\/(?:game\/)?(?:live|daily)\/(?:game\/)?(\d+)/.exec(link) ?? /chess\.com\/(?:game\/)?(?:live|daily)\/(?:game\/)?(\d+)/.exec(headers.Site ?? '');
  if (cc) return { source: 'chesscom', id: cc[1] };
  const li = /lichess\.org\/([A-Za-z0-9]{8})/.exec(headers.Site ?? '') ?? /lichess\.org\/([A-Za-z0-9]{8})/.exec(link);
  if (li) return { source: 'lichess', id: li[1] };
  return null;
}

export function gameIdFor(source: GameSource, sourceGameId: string | null, parsed: ParsedGame): string {
  if (sourceGameId && source !== 'pgn') return `${source}:${sourceGameId}`;
  const h = parsed.headers;
  const key = [h.White ?? '', h.Black ?? '', h.Date ?? '', h.Result ?? '', parsed.startFen, parsed.moves.map((m) => m.uci).join(' ')].join('|');
  return `pgn:${cyrb53(key)}`;
}

export interface GameMeta {
  source?: GameSource;
  sourceGameId?: string | null;
  url?: string | null;
  timeClass?: TimeClass;
  usernames?: string[];
}

export function toGame(parsed: ParsedGame, meta: GameMeta = {}): Game {
  const h = parsed.headers;
  const detected = detectSourceId(h);
  const source: GameSource = meta.source ?? detected?.source ?? 'pgn';
  const sourceGameId = meta.sourceGameId ?? detected?.id ?? null;
  const white = cleanText(h.White, 60) || 'White';
  const black = cleanText(h.Black, 60) || 'Black';
  const names = (meta.usernames ?? []).map((u) => u.toLowerCase()).filter(Boolean);
  const userColor: Color | null = names.includes(white.toLowerCase()) ? 'w' : names.includes(black.toLowerCase()) ? 'b' : null;
  const book = lookupOpening(parsed.moves.map((m) => m.fenAfter));
  const openingHeader = cleanText(h.Opening, 100) || null;
  const url = meta.url ?? (h.Link?.startsWith('https://') ? h.Link : h.Site?.startsWith('https://') ? h.Site : null);
  return {
    id: gameIdFor(source, sourceGameId, parsed),
    source,
    sourceGameId,
    pgn: parsed.pgn,
    white,
    black,
    whiteElo: parseElo(h.WhiteElo),
    blackElo: parseElo(h.BlackElo),
    result: parseResult(h.Result),
    date: parseDate(h.UTCDate ?? h.Date),
    timeControl: cleanText(h.TimeControl, 30) || null,
    timeClass: meta.timeClass ?? timeClassFromControl(h.TimeControl),
    opening: book?.name ?? openingHeader,
    eco: book?.eco ?? (cleanText(h.ECO, 4) || null),
    plyCount: parsed.moves.length,
    importedAt: Date.now(),
    userColor,
    url: cleanText(url ?? '', 200) || null,
  };
}
