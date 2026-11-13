// Core domain types shared across KnightScope.

export type Color = 'w' | 'b';
export type GameSource = 'chesscom' | 'lichess' | 'pgn';
export type GameResult = '1-0' | '0-1' | '1/2-1/2' | '*';
export type TimeClass = 'bullet' | 'blitz' | 'rapid' | 'classical' | 'correspondence' | 'unknown';

/** Engine evaluation, always normalized to WHITE's perspective. */
export type Evaluation =
  | { kind: 'cp'; value: number }
  /** value > 0: White mates in `value` moves; value < 0: Black mates. value 0 = side to move is checkmated (see `matedSide`). */
  | { kind: 'mate'; value: number; matedSide?: Color };

export interface Game {
  id: string;
  source: GameSource;
  sourceGameId: string | null;
  pgn: string;
  white: string;
  black: string;
  whiteElo: number | null;
  blackElo: number | null;
  result: GameResult;
  /** ISO date (YYYY-MM-DD) or null when unknown. */
  date: string | null;
  timeControl: string | null;
  timeClass: TimeClass;
  opening: string | null;
  eco: string | null;
  plyCount: number;
  importedAt: number;
  /** Which side the app user played, when it matches a configured username. */
  userColor: Color | null;
  url: string | null;
}

export type AnalysisStatus = 'pending' | 'running' | 'complete' | 'error' | 'cancelled';
export type PresetName = 'fast' | 'balanced' | 'deep';

export interface AnalysisSettings {
  preset: PresetName;
  screeningDepth: number;
  deepDepth: number;
  /** Per-position time cap in ms for screening (keeps phones responsive). */
  screeningMoveTimeMs: number;
  deepMoveTimeMs: number;
  multiPv: number;
}

export interface Analysis {
  id: string;
  gameId: string;
  engineVersion: string;
  analysisSettings: AnalysisSettings;
  status: AnalysisStatus;
  startedAt: number;
  completedAt: number | null;
  whiteAccuracy: number | null;
  blackAccuracy: number | null;
  error: string | null;
}

export type Classification =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder'
  | 'forced'
  | 'book';

export type ConfidenceLabel = 'preliminary' | 'stable' | 'needs-deeper' | 'incomplete';

export interface PvLine {
  multipv: number;
  /** White-perspective evaluation. */
  eval: Evaluation;
  /** UCI moves. */
  moves: string[];
  depth: number;
}

/** Raw engine result for one position. */
export interface EngineResult {
  fen: string;
  depth: number;
  lines: PvLine[];
  bestMove: string | null;
  /** Best move (multipv 1) at each completed depth, used for stability checks. */
  bestMoveByDepth: Record<number, string>;
  /** White-perspective eval of the main line by depth. */
  evalByDepth: Record<number, Evaluation>;
  interrupted: boolean;
  engineId: string;
  source: 'engine' | 'cache' | 'cloud' | 'terminal';
}

export interface ConfidenceInfo {
  label: ConfidenceLabel;
  depth: number;
  bestMoveStable: boolean;
  evalStable: boolean;
  mateConsistent: boolean;
  interrupted: boolean;
  reasons: string[];
}

export interface PositionAnalysis {
  id: string;
  analysisId: string;
  gameId: string;
  /** Ply index of the move played FROM this position (0 = White's first move). */
  ply: number;
  fen: string;
  fenAfter: string;
  mover: Color;
  actualMove: string; // UCI
  actualSan: string;
  bestMove: string | null; // UCI
  bestSan: string | null;
  evaluationBefore: Evaluation | null;
  evaluationAfter: Evaluation | null;
  /** Engine line from the position before the move (best play). */
  principalVariation: string[];
  /** Engine line from the position after the actual move (opponent's best reply first). */
  replyVariation: string[];
  secondBestEval: Evaluation | null;
  depth: number;
  stage: 'screening' | 'deep';
  classification: Classification | null;
  /** Mover's win-percentage loss (0-100). */
  winPercentLoss: number | null;
  centipawnLoss: number | null;
  accuracy: number | null;
  confidence: ConfidenceInfo | null;
  isBook: boolean;
  legalMoveCount: number;
  motifs: TacticalFinding[];
}

export type MistakeCategory =
  | 'hanging-piece'
  | 'missed-fork'
  | 'missed-pin'
  | 'missed-skewer'
  | 'missed-checkmate'
  | 'missed-tactical-defense'
  | 'back-rank-weakness'
  | 'queen-exposure'
  | 'material-loss'
  | 'endgame-conversion'
  | 'king-safety'
  | 'opening-development'
  | 'other';

export type GamePhase = 'opening' | 'middlegame' | 'endgame';

/** A verified tactical fact, traceable to a concrete position and line. */
export interface TacticalFinding {
  motif:
    | 'hanging-piece'
    | 'fork'
    | 'pin'
    | 'skewer'
    | 'discovered-attack'
    | 'mate'
    | 'back-rank-mate'
    | 'material-loss'
    | 'material-gain'
    | 'queen-exposure'
    | 'development'
    | 'check';
  /** Whose tactic: 'missed' = available to the mover with the best move; 'allowed' = opponent's reply after the actual move. */
  side: 'missed' | 'allowed';
  squares: string[];
  pieces: string[];
  materialSwing: number;
  mateIn: number | null;
  /** UCI line that demonstrates the finding, starting from the relevant position. */
  line: string[];
  lineStartFen: string;
}

export interface Mistake {
  id: string;
  gameId: string;
  analysisId: string;
  positionId: string;
  ply: number;
  moveNumber: number;
  fen: string;
  playerColor: Color;
  actualMove: string;
  actualSan: string;
  bestMove: string;
  bestSan: string;
  evaluationBefore: Evaluation;
  evaluationAfter: Evaluation;
  winPercentLoss: number;
  severity: 'inaccuracy' | 'mistake' | 'blunder';
  category: MistakeCategory;
  motifs: TacticalFinding[];
  verified: boolean;
  detectionMethod: string;
  phase: GamePhase;
  opening: string | null;
  timeClass: TimeClass;
  confidence: ConfidenceLabel;
  gameDate: string | null;
  createdAt: number;
  /** True when the mover is the configured app user. */
  isUserMove: boolean;
}

export type ExerciseKind = 'mate' | 'tactic' | 'best-move';

export interface TrainingExercise {
  id: string;
  sourceMistakeId: string | null;
  gameId: string | null;
  fen: string;
  sideToMove: Color;
  kind: ExerciseKind;
  goal: string;
  /** UCI solution line (user moves and opponent replies interleaved). */
  solution: string[];
  solutionEval: Evaluation;
  /** Number of user moves that must be demonstrated. */
  requiredUserMoves: number;
  mateIn: number | null;
  category: MistakeCategory;
  difficulty: 1 | 2 | 3;
  createdAt: number;
  nextReviewAt: number;
  box: number;
  attempts: number;
  successes: number;
  lastResult: 'success' | 'failure' | null;
}

export interface TrainingAttempt {
  id: string;
  exerciseId: string;
  fen: string;
  attemptedMoves: string[];
  correct: boolean;
  usedHint: boolean;
  revealedSolution: boolean;
  timeSpentMs: number;
  attemptedAt: number;
  category: MistakeCategory;
  engineSettings: { depth: number; engineId: string; acceptanceWinLoss: number };
}

export interface ClassificationThresholds {
  excellent: number;
  good: number;
  inaccuracy: number;
  mistake: number;
  /** Win% gap to second-best needed for a "great" (only-move) classification. */
  greatGap: number;
  /** Minimum sacrificed material (pawn units) for a brilliant candidate. */
  brilliantMinSacrifice: number;
}

export type ExplanationLevel = 'beginner' | 'intermediate' | 'advanced';

export interface AppSettings {
  id: 'app';
  usernames: { chesscom: string; lichess: string; other: string[] };
  preset: PresetName;
  customDepth: { screening: number; deep: number } | null;
  maxEngines: number;
  engineFlavor: 'lite' | 'full' | 'native';
  explanationLevel: ExplanationLevel;
  thresholds: ClassificationThresholds;
  trainingAcceptanceWinLoss: number;
  boardTheme: 'slate' | 'classic';
  showCoordinates: boolean;
  cloudEval: boolean;
  /** Time to search a fixed position to depth 16 on this device. */
  benchmark: { ms: number; at: number; recommended: PresetName; engine: string } | null;
}

export interface QueueJob {
  id: string;
  gameId: string;
  status: 'queued' | 'running' | 'paused' | 'done' | 'error' | 'cancelled';
  stage: 'screening' | 'deep' | 'review' | null;
  positionsDone: number;
  positionsTotal: number;
  deepTotal: number;
  deepDone: number;
  currentDepth: number;
  preset: PresetName;
  createdAt: number;
  updatedAt: number;
  error: string | null;
  analysisId: string | null;
}
