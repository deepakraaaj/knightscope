import { describe, expect, it } from 'vitest';
import { fetchChessComGames, fetchLichessGames, normalizeChessComGame, type ChessComGame } from '@/features/import/api';
import { OPERA_GAME, SCHOLARS_MATE } from '../fixtures/games';

const ccGame = (over: Partial<ChessComGame> = {}): ChessComGame => ({
  url: 'https://www.chess.com/game/live/98765', pgn: SCHOLARS_MATE, time_control: '600', time_class: 'rapid', rules: 'chess', end_time: 1700000000,
  white: { username: 'Alice', rating: 1200, result: 'win' }, black: { username: 'Bob', rating: 1180, result: 'checkmated' }, ...over,
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('Chess.com normalization (mocked network)', () => {
  it('normalizes an archive game', () => {
    const g = normalizeChessComGame(ccGame(), ['bob'])!;
    expect(g).toMatchObject({ id: 'chesscom:98765', source: 'chesscom', timeClass: 'rapid', userColor: 'b', url: 'https://www.chess.com/game/live/98765' });
  });
  it('skips variants', () => {
    expect(normalizeChessComGame(ccGame({ rules: 'chess960' }), [])).toBeNull();
  });
  it('walks archives newest-first and stops at the limit', async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      if (url.endsWith('/archives')) return json({ archives: ['https://api.chess.com/pub/player/bob/games/2024/01', 'https://api.chess.com/pub/player/bob/games/2024/02'] });
      if (url.endsWith('2024/02')) return json({ games: [ccGame({ url: 'https://www.chess.com/game/live/2' }), ccGame({ url: 'https://www.chess.com/game/live/3', rules: 'bughouse' })] });
      return json({ games: [ccGame({ url: 'https://www.chess.com/game/live/1', pgn: OPERA_GAME })] });
    };
    const r = await fetchChessComGames('Bob', { maxGames: 2, usernames: ['bob'], fetchImpl });
    expect(calls[1]).toMatch(/2024\/02$/);
    expect(r.games.map((g) => g.id)).toEqual(['chesscom:2', 'chesscom:1']);
    expect(r.skipped[0].count).toBe(1);
  });
  it('reports unknown users and retries on rate limits', async () => {
    await expect(fetchChessComGames('nobody', { maxGames: 5, usernames: [], fetchImpl: async () => json({}, 404) })).rejects.toThrow(/not found/);
    let n = 0;
    const flaky = async (url: string) => (n++ === 0 ? json({}, 429) : url.endsWith('/archives') ? json({ archives: [] }) : json({ games: [] }));
    const r = await fetchChessComGames('bob', { maxGames: 5, usernames: [], fetchImpl: flaky });
    expect(r.games).toEqual([]);
  }, 20000);
});

describe('Lichess import (mocked network)', () => {
  it('parses NDJSON and skips variants and unfinished games', async () => {
    const lines = [
      { id: 'abcdEFGH', variant: 'standard', speed: 'blitz', status: 'mate', pgn: SCHOLARS_MATE },
      { id: 'zzzzzzzz', variant: 'crazyhouse', speed: 'blitz', status: 'mate', pgn: SCHOLARS_MATE },
      { id: 'yyyyyyyy', variant: 'standard', speed: 'blitz', status: 'started', pgn: SCHOLARS_MATE },
    ].map((l) => JSON.stringify(l)).join('\n');
    const r = await fetchLichessGames('alice', { maxGames: 10, usernames: ['alice'], fetchImpl: async () => new Response(lines, { status: 200 }) });
    expect(r.games).toHaveLength(1);
    expect(r.games[0]).toMatchObject({ id: 'lichess:abcdEFGH', timeClass: 'blitz', userColor: 'w', url: 'https://lichess.org/abcdEFGH' });
    expect(r.skipped[0].count).toBe(2);
  });
});
