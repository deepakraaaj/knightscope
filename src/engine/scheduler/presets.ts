import type { AnalysisSettings, PresetName } from '@/types';

/**
 * Analysis presets. Stage A (screening) is shallow and time-capped so phones stay responsive;
 * Stage B (deep) only runs on critical positions. Depths are search depths reported by Stockfish.
 */
export const PRESETS: Record<PresetName, AnalysisSettings> = {
  fast: { preset: 'fast', screeningDepth: 10, screeningMoveTimeMs: 250, deepDepth: 14, deepMoveTimeMs: 1500, multiPv: 2 },
  balanced: { preset: 'balanced', screeningDepth: 12, screeningMoveTimeMs: 500, deepDepth: 18, deepMoveTimeMs: 4000, multiPv: 2 },
  deep: { preset: 'deep', screeningDepth: 14, screeningMoveTimeMs: 1000, deepDepth: 22, deepMoveTimeMs: 10000, multiPv: 2 },
};

export function settingsFor(preset: PresetName, custom: { screening: number; deep: number } | null): AnalysisSettings {
  const base = PRESETS[preset];
  if (!custom) return base;
  const screeningDepth = clamp(custom.screening, 6, 30);
  const deepDepth = clamp(Math.max(custom.deep, screeningDepth), 8, 40);
  return { ...base, screeningDepth, deepDepth };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

export const BENCHMARK_FEN = 'r1bq1rk1/pp2bppp/2n1pn2/2pp4/3P4/2PBPN2/PP1N1PPP/R2QK2R w KQ - 0 8';
export const BENCHMARK_DEPTH = 16;

/** Recommend a preset from the time needed to search the benchmark position to depth 16. */
export function recommendPreset(ms: number): PresetName {
  if (ms <= 1500) return 'deep';
  if (ms <= 5000) return 'balanced';
  return 'fast';
}
