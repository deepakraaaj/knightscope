import { describe, expect, it } from 'vitest';
import { parseMultiPgn, parseSingleGame, splitPgn, timeClassFromControl, toGame, detectSourceId, MAX_PGN_FILE_BYTES } from '@/chess/pgn/parsePgn';
import { CHESSCOM_PGN, INVALID_PGN, OPERA_GAME, SCHOLARS_MATE } from '../fixtures/games';

describe('PGN parsing', () => {
  it('parses a valid game with headers and FENs', () => {
    const g = parseSingleGame(OPERA_GAME);
    expect(g.moves).toHaveLength(33);
    expect(g.headers.White).toBe('Paul Morphy');
    expect(g.moves[0]).toMatchObject({ san: 'e4', uci: 'e2e4', color: 'w' });
    expect(g.moves[0].fenAfter).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
    expect(g.moves[22].san).toBe('O-O-O');
    expect(g.moves[22].uci).toBe('e1c1');
    expect(g.moves[32].san).toBe('Rd8#');
  });

  it('splits multi-game PGN text', () => {
    const text = [OPERA_GAME, SCHOLARS_MATE, CHESSCOM_PGN].join('\n\n');
    expect(splitPgn(text)).toHaveLength(3);
    const { games, failures } = parseMultiPgn(text);
    expect(games).toHaveLength(3);
    expect(failures).toHaveLength(0);
  });

  it('reports invalid games without failing the whole import', () => {
    const { games, failures } = parseMultiPgn([OPERA_GAME, INVALID_PGN].join('\n\n'));
    expect(games).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].message).toMatch(/Invalid PGN/);
  });

  it('rejects empty and oversized input', () => {
    expect(() => parseSingleGame('[Event "x"]\n\n*')).toThrow(/no moves/);
    expect(() => parseMultiPgn('x'.repeat(MAX_PGN_FILE_BYTES + 1))).toThrow(/larger than/);
  });

  it('handles comments and variations', () => {
    const g = parseSingleGame('1. e4 {best by test} e5 (1... c5 2. Nf3) 2. Nf3 Nc6 *');
    expect(g.moves.map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
  });

  it('classifies time controls', () => {
    expect(timeClassFromControl('60')).toBe('bullet');
    expect(timeClassFromControl('180+2')).toBe('blitz');
    expect(timeClassFromControl('600')).toBe('rapid');
    expect(timeClassFromControl('1800')).toBe('classical');
    expect(timeClassFromControl('1/259200')).toBe('correspondence');
    expect(timeClassFromControl(undefined)).toBe('unknown');
  });

  // 300+5 => 300 + 40*5 = 500s estimated duration => rapid (Lichess formula; API imports use the site's own class).
  it('normalizes a Chess.com export into a Game with a stable id', () => {
    const parsed = parseSingleGame(CHESSCOM_PGN);
    expect(detectSourceId(parsed.headers)).toEqual({ source: 'chesscom', id: '104857600' });
    const game = toGame(parsed, { usernames: ['TestUser'] });
    expect(game).toMatchObject({ id: 'chesscom:104857600', source: 'chesscom', white: 'testuser', whiteElo: 1412, result: '0-1', date: '2024-03-10', timeClass: 'rapid', userColor: 'w' });
    expect(toGame(parseSingleGame(CHESSCOM_PGN)).id).toBe(game.id);
  });

  it('gives identical PGN uploads the same id and strips unsafe header text', () => {
    const a = toGame(parseSingleGame(SCHOLARS_MATE));
    const b = toGame(parseSingleGame(SCHOLARS_MATE));
    expect(a.id).toBe(b.id);
    const evil = toGame(parseSingleGame('[White "<img src=x onerror=alert(1)>"]\n[Black "B"]\n\n1. e4 *'));
    expect(evil.white).not.toContain('<');
  });

  it('identifies the opening from verified data', () => {
    const game = toGame(parseSingleGame(OPERA_GAME));
    expect(game.eco).toBe('C41');
    expect(game.opening).toMatch(/Philidor/);
  });
});
