import type { Analysis, Color, Game, GameSource, Mistake, MistakeCategory, TimeClass, TrainingAttempt, TrainingExercise } from '@/types';

// All analytics are computed from stored games, reviews, mistakes and training attempts.
// Nothing here is hard-coded; empty inputs produce empty outputs.

export const CATEGORY_LABEL: Record<MistakeCategory, string> = {
  'hanging-piece': 'Hanging pieces',
  'missed-fork': 'Missed forks',
  'missed-pin': 'Missed pins',
  'missed-skewer': 'Missed skewers',
  'missed-checkmate': 'Missed checkmates',
  'missed-tactical-defense': 'Missed tactical defense',
  'back-rank-weakness': 'Back-rank weakness',
  'queen-exposure': 'Unnecessary queen exposure',
  'material-loss': 'Material loss',
  'endgame-conversion': 'Endgame conversion errors',
  'king-safety': 'King-safety errors (allowed mate)',
  'opening-development': 'Opening development',
  other: 'Other / Unclassified',
};

export interface GameFilters {
  from: string | null;
  to: string | null;
  source: GameSource | 'all';
  timeClass: TimeClass | 'all';
  color: Color | 'all';
  opening: string | 'all';
  result: 'all' | 'win' | 'loss' | 'draw';
}

export const EMPTY_FILTERS: GameFilters = { from: null, to: null, source: 'all', timeClass: 'all', color: 'all', opening: 'all', result: 'all' };

export function userOutcome(g: Game): 'win' | 'loss' | 'draw' | null {
  if (!g.userColor || g.result === '*') return null;
  if (g.result === '1/2-1/2') return 'draw';
  const whiteWon = g.result === '1-0';
  return (whiteWon && g.userColor === 'w') || (!whiteWon && g.userColor === 'b') ? 'win' : 'loss';
}

export function filterGames(games: Game[], f: GameFilters): Game[] {
  return games.filter((g) => {
    if (f.from && (!g.date || g.date < f.from)) return false;
    if (f.to && (!g.date || g.date > f.to)) return false;
    if (f.source !== 'all' && g.source !== f.source) return false;
    if (f.timeClass !== 'all' && g.timeClass !== f.timeClass) return false;
    if (f.color !== 'all' && g.userColor !== f.color) return false;
    if (f.opening !== 'all' && (g.opening ?? 'Unknown') !== f.opening) return false;
    if (f.result !== 'all' && userOutcome(g) !== f.result) return false;
    return true;
  });
}

/** Mistakes made by the user (or by both sides when no username is configured for that game). */
export function relevantMistakes(mistakes: Mistake[], games: Game[]): Mistake[] {
  const byId = new Map(games.map((g) => [g.id, g]));
  return mistakes.filter((m) => {
    const g = byId.get(m.gameId);
    if (!g) return false;
    return g.userColor ? m.playerColor === g.userColor : true;
  });
}

export interface WeaknessStat {
  category: MistakeCategory;
  count: number;
  verifiedCount: number;
  totalWinLoss: number;
  avgWinLoss: number;
  games: number;
  lastSeen: number;
}

export function weaknessStats(mistakes: Mistake[], gameDates: Map<string, number>): WeaknessStat[] {
  const map = new Map<MistakeCategory, WeaknessStat & { gameSet: Set<string> }>();
  for (const m of mistakes) {
    const s = map.get(m.category) ?? { category: m.category, count: 0, verifiedCount: 0, totalWinLoss: 0, avgWinLoss: 0, games: 0, lastSeen: 0, gameSet: new Set<string>() };
    s.count++;
    if (m.verified) s.verifiedCount++;
    s.totalWinLoss += m.winPercentLoss;
    s.gameSet.add(m.gameId);
    s.lastSeen = Math.max(s.lastSeen, gameDates.get(m.gameId) ?? m.createdAt);
    map.set(m.category, s);
  }
  return [...map.values()]
    .map(({ gameSet, ...s }) => ({ ...s, games: gameSet.size, avgWinLoss: s.count ? s.totalWinLoss / s.count : 0 }))
    .sort((a, b) => b.count - a.count || b.totalWinLoss - a.totalWinLoss);
}

export function groupCount<T>(items: T[], key: (t: T) => string): { key: string; count: number }[] {
  const m = new Map<string, number>();
  for (const it of items) m.set(key(it), (m.get(key(it)) ?? 0) + 1);
  return [...m.entries()].map(([k, count]) => ({ key: k, count })).sort((a, b) => b.count - a.count);
}

/** Sort key for a game in time (game date, falling back to import time). */
export function gameTime(g: Game): number {
  if (g.date) {
    const t = Date.parse(g.date + 'T12:00:00Z');
    if (!Number.isNaN(t)) return t;
  }
  return g.importedAt;
}

// ------------------------------------------------------------------ improvement comparison

export interface WindowStats {
  games: number;
  occurrences: number;
  userMoves: number;
  perGame: number;
  timeClasses: { key: string; count: number }[];
  opponentRating: { min: number; max: number } | null;
  presets: string[];
  from: string | null;
  to: string | null;
}

export interface ImprovementRow {
  category: MistakeCategory;
  previous: WindowStats;
  recent: WindowStats;
  verdict: 'fewer' | 'more' | 'similar' | 'insufficient';
  message: string;
}

export const MIN_WINDOW_GAMES = 5;

function windowStats(games: Game[], mistakes: Mistake[], analyses: Map<string, Analysis>, category: MistakeCategory): WindowStats {
  const ids = new Set(games.map((g) => g.id));
  const occ = mistakes.filter((m) => m.category === category && ids.has(m.gameId)).length;
  const ratings = games.map((g) => (g.userColor === 'w' ? g.blackElo : g.userColor === 'b' ? g.whiteElo : null)).filter((r): r is number => r !== null);
  const userMoves = games.reduce((n, g) => n + (g.userColor ? Math.floor((g.plyCount + (g.userColor === 'w' ? 1 : 0)) / 2) : g.plyCount), 0);
  const dates = games.map((g) => g.date).filter((d): d is string => !!d).sort();
  return {
    games: games.length,
    occurrences: occ,
    userMoves,
    perGame: games.length ? occ / games.length : 0,
    timeClasses: groupCount(games, (g) => g.timeClass),
    opponentRating: ratings.length ? { min: Math.min(...ratings), max: Math.max(...ratings) } : null,
    presets: [...new Set(games.map((g) => analyses.get(g.id)?.analysisSettings.preset).filter(Boolean) as string[])],
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
  };
}

/**
 * Compare the previous N analyzed games with the most recent N for each weakness category.
 * The comparison is descriptive only: it does not claim causation.
 */
export function improvementComparison(games: Game[], mistakes: Mistake[], analyses: Map<string, Analysis>, windowSize = 20): ImprovementRow[] {
  const analyzed = games.filter((g) => analyses.has(g.id)).sort((a, b) => gameTime(a) - gameTime(b));
  const n = Math.min(windowSize, Math.floor(analyzed.length / 2));
  const recentGames = analyzed.slice(analyzed.length - n);
  const previousGames = analyzed.slice(analyzed.length - 2 * n, analyzed.length - n);
  const cats = [...new Set(mistakes.map((m) => m.category))];
  return cats.map((category) => {
    const previous = windowStats(previousGames, mistakes, analyses, category);
    const recent = windowStats(recentGames, mistakes, analyses, category);
    const label = CATEGORY_LABEL[category].toLowerCase();
    if (n < MIN_WINDOW_GAMES) {
      return { category, previous, recent, verdict: 'insufficient' as const, message: `Not enough analyzed games to compare (${analyzed.length} analyzed; at least ${MIN_WINDOW_GAMES * 2} needed).` };
    }
    const diff = recent.occurrences - previous.occurrences;
    const rel = previous.occurrences > 0 ? diff / previous.occurrences : recent.occurrences > 0 ? 1 : 0;
    if (Math.abs(diff) >= 2 && Math.abs(rel) >= 0.25) {
      return diff < 0
        ? { category, previous, recent, verdict: 'fewer' as const, message: `Fewer ${label} mistakes were detected in your recent ${n} games than in the ${n} before them.` }
        : { category, previous, recent, verdict: 'more' as const, message: `More ${label} mistakes were detected in your recent ${n} games than in the ${n} before them.` };
    }
    return { category, previous, recent, verdict: 'similar' as const, message: `No clear change in ${label} mistakes between the two periods.` };
  }).sort((a, b) => b.previous.occurrences + b.recent.occurrences - (a.previous.occurrences + a.recent.occurrences));
}

// ------------------------------------------------------------------ training transfer

export interface TransferRow {
  category: MistakeCategory;
  exercises: number;
  attempts: number;
  solveRate: number | null;
  firstTrainedAt: number | null;
  gamesBefore: number;
  gamesAfter: number;
  rateBefore: number | null;
  rateAfter: number | null;
  note: string;
}

/**
 * Two separate measurements per category:
 *  1. Training performance: share of correct attempts on exercises from this category.
 *  2. In-game recurrence: occurrences per analyzed game before vs after the first training attempt.
 */
export function trainingTransfer(games: Game[], mistakes: Mistake[], analyses: Map<string, Analysis>, exercises: TrainingExercise[], attempts: TrainingAttempt[]): TransferRow[] {
  const analyzed = games.filter((g) => analyses.has(g.id));
  const cats = [...new Set([...exercises.map((e) => e.category)])];
  return cats.map((category) => {
    const exs = exercises.filter((e) => e.category === category);
    const atts = attempts.filter((a) => a.category === category);
    const solveRate = atts.length ? atts.filter((a) => a.correct).length / atts.length : null;
    const firstTrainedAt = atts.length ? Math.min(...atts.map((a) => a.attemptedAt)) : null;
    let gamesBefore = 0;
    let gamesAfter = 0;
    let occBefore = 0;
    let occAfter = 0;
    if (firstTrainedAt !== null) {
      const ids = new Map<string, boolean>();
      for (const g of analyzed) {
        const after = gameTime(g) > firstTrainedAt;
        ids.set(g.id, after);
        if (after) gamesAfter++;
        else gamesBefore++;
      }
      for (const m of mistakes) {
        if (m.category !== category || !ids.has(m.gameId)) continue;
        if (ids.get(m.gameId)) occAfter++;
        else occBefore++;
      }
    }
    const rateBefore = gamesBefore ? occBefore / gamesBefore : null;
    const rateAfter = gamesAfter ? occAfter / gamesAfter : null;
    let note: string;
    if (firstTrainedAt === null) note = 'No training attempts yet.';
    else if (gamesAfter < 3) note = `Only ${gamesAfter} analyzed game${gamesAfter === 1 ? '' : 's'} played after training started. Analyze more recent games to measure transfer.`;
    else if (rateBefore !== null && rateAfter !== null && rateAfter < rateBefore) note = 'This pattern has appeared less often per game since you started training it. Other factors (opponents, time controls) may contribute.';
    else if (rateBefore !== null && rateAfter !== null && rateAfter > rateBefore) note = 'This pattern still appears as often or more often in games, even though you have trained it.';
    else note = 'No measurable difference yet.';
    return { category, exercises: exs.length, attempts: atts.length, solveRate, firstTrainedAt, gamesBefore, gamesAfter, rateBefore, rateAfter, note };
  });
}

// ------------------------------------------------------------------ learning priorities

export interface Priority {
  category: MistakeCategory;
  score: number;
  reasons: string[];
  availableExercises: number;
  dueExercises: number;
}

/**
 * Deterministic, transparent ranking:
 * score = 1.0 * occurrences in the last 30 analyzed games
 *       + 1.5 * occurrences in the last 10 analyzed games (recency)
 *       + 2.0 * average win% loss / 10 (severity)
 *       + 3.0 * training failure rate (when there are at least 3 attempts)
 *       + 1.0 if the pattern recurred after training started
 */
export function learningPriorities(games: Game[], mistakes: Mistake[], analyses: Map<string, Analysis>, exercises: TrainingExercise[], attempts: TrainingAttempt[], now = Date.now()): Priority[] {
  const analyzed = games.filter((g) => analyses.has(g.id)).sort((a, b) => gameTime(b) - gameTime(a));
  const last30 = new Set(analyzed.slice(0, 30).map((g) => g.id));
  const last10 = new Set(analyzed.slice(0, 10).map((g) => g.id));
  const cats = [...new Set(mistakes.map((m) => m.category))].filter((c) => c !== 'other');
  const transfer = new Map(trainingTransfer(games, mistakes, analyses, exercises, attempts).map((t) => [t.category, t]));
  return cats
    .map((category) => {
      const ms = mistakes.filter((m) => m.category === category);
      const freq = ms.filter((m) => last30.has(m.gameId)).length;
      const recent = ms.filter((m) => last10.has(m.gameId)).length;
      const severity = ms.length ? ms.reduce((s, m) => s + m.winPercentLoss, 0) / ms.length : 0;
      const atts = attempts.filter((a) => a.category === category);
      const failRate = atts.length >= 3 ? atts.filter((a) => !a.correct).length / atts.length : 0;
      const t = transfer.get(category);
      const recurred = t && t.rateAfter !== null && t.gamesAfter >= 3 && t.rateAfter > 0;
      const score = freq * 1 + recent * 1.5 + (severity / 10) * 2 + failRate * 3 + (recurred ? 1 : 0);
      const reasons: string[] = [];
      if (freq) reasons.push(`${freq} occurrence${freq === 1 ? '' : 's'} in your last ${Math.min(30, analyzed.length)} analyzed games`);
      if (recent) reasons.push(`${recent} in the last ${Math.min(10, analyzed.length)} games`);
      reasons.push(`average cost ${severity.toFixed(0)}% winning chances per occurrence`);
      if (atts.length >= 3) reasons.push(`${Math.round(failRate * 100)}% of your training attempts in this area failed`);
      if (recurred) reasons.push('still appearing in games after training started');
      const exs = exercises.filter((e) => e.category === category);
      return { category, score, reasons, availableExercises: exs.length, dueExercises: exs.filter((e) => e.nextReviewAt <= now).length };
    })
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score);
}

/** Pick exercises for a timed daily session, favouring due exercises in priority categories. */
export function buildDailySession(minutes: 5 | 10 | 20, exercises: TrainingExercise[], priorities: Priority[], now = Date.now()): { exercises: TrainingExercise[]; note: string | null } {
  const target = Math.max(2, Math.round(minutes / 1.5));
  const rank = new Map(priorities.map((p, i) => [p.category, i]));
  const sorted = exercises.slice().sort((a, b) => {
    const dueA = a.nextReviewAt <= now ? 0 : 1;
    const dueB = b.nextReviewAt <= now ? 0 : 1;
    if (dueA !== dueB) return dueA - dueB;
    const ra = rank.get(a.category) ?? 99;
    const rb = rank.get(b.category) ?? 99;
    if (ra !== rb) return ra - rb;
    return a.nextReviewAt - b.nextReviewAt;
  });
  const picked = sorted.slice(0, target);
  const note = exercises.length === 0
    ? 'You have no training exercises yet. Analyze games, then add mistakes to training from a review or from Mistake Memory.'
    : picked.length < target
      ? `Only ${picked.length} exercise${picked.length === 1 ? ' is' : 's are'} available from your games, fewer than a full ${minutes}-minute session.`
      : null;
  return { exercises: picked, note };
}
