// Real chess games used as test fixtures.

/** Morphy vs Duke Karl / Count Isouard, Paris 1858 ("Opera Game"). */
export const OPERA_GAME = `[Event "Paris"]
[Site "Paris FRA"]
[Date "1858.??.??"]
[Round "?"]
[White "Paul Morphy"]
[Black "Duke Karl / Count Isouard"]
[Result "1-0"]
[ECO "C41"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7
8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7
14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`;

/** Scholar's mate pattern: Black's 3...Nf6?? allows Qxf7#. */
export const SCHOLARS_MATE = `[Event "Casual"]
[Site "?"]
[Date "2024.01.05"]
[White "Alice"]
[Black "Bob"]
[Result "1-0"]
[TimeControl "600"]

1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0`;

/** Legal's mate trap (Legall de Kermur vs Saint Brie, Paris 1750). */
export const LEGAL_MATE = `[Event "Paris"]
[Site "Paris FRA"]
[Date "1750.??.??"]
[White "Legall de Kermur"]
[Black "Saint Brie"]
[Result "1-0"]

1. e4 e5 2. Nf3 d6 3. Bc4 Bg4 4. Nc3 g6 5. Nxe5 Bxd1 6. Bxf7+ Ke7 7. Nd5# 1-0`;

/** Chess.com-style export headers (Link header carries the game id). */
export const CHESSCOM_PGN = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2024.03.10"]
[Round "-"]
[White "testuser"]
[Black "opponent99"]
[Result "0-1"]
[WhiteElo "1412"]
[BlackElo "1450"]
[TimeControl "300+5"]
[Termination "opponent99 won by checkmate"]
[Link "https://www.chess.com/game/live/104857600"]

1. f3 e5 2. g4 Qh4# 0-1`;

export const INVALID_PGN = `[Event "Broken"]
[White "A"]
[Black "B"]

1. e4 e5 2. Ke3 Qh4 3. Kxh4 1-0`;
