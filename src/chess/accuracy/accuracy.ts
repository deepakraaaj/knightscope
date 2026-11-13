// Move and game accuracy derived from win-percentage loss.
// The per-move curve is the formula Lichess publishes (https://lichess.org/page/accuracy).
// These numbers are KnightScope estimates and are NOT equivalent to Chess.com's proprietary scores.

export function moveAccuracy(winPercentLoss: number): number {
  const loss = Math.max(0, winPercentLoss);
  const acc = 103.1668 * Math.exp(-0.04354 * loss) - 3.1669;
  return Math.max(0, Math.min(100, acc));
}

/**
 * Game accuracy: average of the arithmetic and harmonic means of move accuracies.
 * The harmonic mean makes a few severe errors weigh more than many small ones.
 */
export function gameAccuracy(moveAccuracies: number[]): number | null {
  const xs = moveAccuracies.filter((x) => Number.isFinite(x));
  if (xs.length === 0) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const harmonic = xs.length / xs.reduce((a, b) => a + 1 / Math.max(b, 1), 0);
  return Math.max(0, Math.min(100, (mean + harmonic) / 2));
}
