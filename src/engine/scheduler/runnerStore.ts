import { create } from 'zustand';
import type { GameAnalyzerProgress } from './gameAnalyzer';

// Lightweight live state for the analysis queue (kept separate so the app shell does not load the engine code).
export interface LiveJob extends GameAnalyzerProgress {
  jobId: string;
  gameId: string;
  engine: string;
}

interface RunnerState {
  running: boolean;
  live: Record<string, LiveJob>;
  lastError: string | null;
  engineName: string | null;
  set: (patch: Partial<RunnerState>) => void;
}

export const useRunner = create<RunnerState>((set) => ({
  running: false,
  live: {},
  lastError: null,
  engineName: null,
  set: (patch) => set(patch),
}));
