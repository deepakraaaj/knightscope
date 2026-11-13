# KnightScope analysis algorithms

These rules are KnightScope's own heuristics, built on Stockfish evaluations. They are **not** a reproduction of any other site's proprietary algorithms, and their outputs are estimates, not certainties.

## 1. Evaluations and winning chances

- Stockfish reports scores from the side-to-move's perspective. They are converted to **White's perspective** immediately (`src/chess/positions/evaluation.ts`).
- Mate scores keep their distance and sign. `mate +3` means White mates in 3. When the side to move is already checkmated, the score is `mate 0` with `matedSide` recorded.
- Winning chance uses the logistic curve that Lichess publishes: `50 + 50 · (2 / (1 + e^(−0.00368208 · cp)) − 1)`, with cp clamped to ±1000. A mate counts as 100% or 0%.
- **Win% loss** for a move = the mover's winning chance before the move minus their winning chance after it (minimum 0). If the move played is the engine's top move, the loss is 0, because any difference is search noise.

## 2. Three-stage analysis (`src/engine/scheduler/gameAnalyzer.ts`)

**Stage A: screening.** Every position gets a shallow, time-capped search (MultiPV 2).

**Stage B: selective deep search.** A move is searched again at full depth when any of these apply:
- the win% loss is at least the "good" threshold;
- a mate score appears before or after the move;
- the best move changed among the last three screening depths;
- a sacrifice is suspected on the engine's best move (possible brilliant);
- the second-best move is at least `greatGap` worse (possible only-move / great);
- the move played was the engine's second choice (similar candidates).

The deep search covers both the position before and the position after that move. Book moves are skipped. When a username is set, the opponent's moves only get Stage B if their evaluation drops.

**Stage C: review generation.** Each move is classified using the deepest result available for both of its positions.

## 3. Classification (`src/chess/classification/classify.ts`)

Checks are applied in this order:

1. **Book.** The resulting position is in the Lichess chess-openings dataset (CC0), and so is every earlier move.
2. **Forced.** It was the only legal move.
3. **Mate adjustments.**
   - Keeping a forced mate, even a slower one, is never penalised.
   - Losing a forced mate while staying at 90% winning chance or more is capped at Inaccuracy.
4. **Brilliant.** All of the following must hold:
   - the move is the engine's best (or loses at most 1%);
   - the mover still has at least 50% winning chance afterwards;
   - the position was not already 97% or more won (unless it was a mate sequence);
   - the move is a material investment of at least `brilliantMinSacrifice` pawns, attributable to this move: measured after the opponent's reply, still present after the mover's next move, or the moved piece is en prise by a static exchange estimate;
   - the analysis confidence is **Stable at tested depths**.
5. **Great.** The engine's best move, the second-best option is at least `greatGap` (20) win% worse, and the position was not already 95% or more won.
6. **Best.** The engine's top move.
7. **By win% loss.** Excellent ≤ 2, Good ≤ 5, Inaccuracy ≤ 10, Mistake ≤ 20, otherwise Blunder.

All thresholds can be changed in Settings.

## 4. Analysis confidence (`src/chess/classification/confidence.ts`)

Confidence is calculated over the last three tested depths:

| Label | Meaning |
|---|---|
| **Preliminary** | Only Stage A ran. |
| **Stable at tested depths** | After the deep search, the best move was the same, the evaluation stayed within 6 win% points, and any mate sign stayed consistent. |
| **Needs deeper analysis** | After the deep search, one of those checks failed. |
| **Incomplete** | The search was interrupted or failed. |

This is an engineering heuristic, not a probability.

## 5. Mistake categories (`src/chess/tactics/detect.ts`)

A category is assigned only when **both** of these hold:
- a geometric pattern is found on the concrete board;
- the engine line confirms the outcome (material swing of at least 2 pawns, or a mate score).

Categories are checked in this priority order:

1. Missed checkmate
2. Back-rank weakness
3. King-safety error (the move allowed a forced mate)
4. Hanging piece
5. Missed fork
6. Missed pin
7. Missed skewer
8. Missed tactical defense
9. Unnecessary queen exposure
10. Endgame conversion error
11. Material loss
12. Opening development
13. Other / Unclassified

What each check requires:
- **Missed checkmate:** the engine had a mate score for the mover.
- **Back-rank weakness:** the final position of the engine's mating line is mate, the checking rook or queen is on the king's back rank, and the king is blocked in by its own pieces.
- **King-safety error:** the opponent has a forced mate after the move.
- **Hanging piece:** the opponent's best reply captures a non-pawn piece that was undefended, or captures it with a cheaper piece.
- **Missed fork:** the best move attacks two or more targets (the king, more valuable pieces, or undefended pieces).
- **Missed pin / skewer:** the best move is a slider move that creates a pin or skewer along a line.
- **Missed tactical defense:** the opponent's reply is a fork, pin, skewer or discovered attack.
- **Unnecessary queen exposure:** the move was a queen move, and the line attacks the queen with a lesser piece or wins it.
- **Endgame conversion error:** in an endgame, the mover went from 75% or more winning chance to below 60%.
- **Material loss:** the engine line loses at least 2 pawns of material.
- **Opening development:** in the opening, the engine preferred a developing move or castling.

The detector deliberately misses some tactics rather than invent them.

## 6. Accuracy (`src/chess/accuracy/accuracy.ts`)

- **Per-move accuracy** uses the Lichess-published curve: `103.1668 · e^(−0.04354 · loss) − 3.1669`.
- **Game accuracy** is the average of the arithmetic mean and the harmonic mean of the non-book move accuracies.
- These are KnightScope estimates and are not equivalent to Chess.com's accuracy scores.

## 7. Training validation (`src/features/training/logic.ts`)

- **Ordinary positions:** a move is accepted if it is within `trainingAcceptanceWinLoss` (default 4) win% of the engine's best move, searched fresh at the same depth.
- **Mate exercises:** the move must keep a forced mate within the remaining move budget, and stalemate or draw counts as a failure.
- **Tactics:** the user must play up to 3 moves, and the engine plays the opponent's replies.
- **Scheduling** uses fixed Leitner boxes of 1, 3, 7, 14 and 30 days. A failure resets the exercise to a 10-minute retry.

## 8. Learning priorities (`src/features/analytics/aggregate.ts`)

score = 1.0 × occurrences in the last 30 analyzed games
      + 1.5 × occurrences in the last 10
      + 2.0 × (average win% loss ÷ 10)
      + 3.0 × training failure rate (after 3 or more attempts)
      + 1.0 if the pattern recurred after training began
