import { useCallback, useEffect, useRef, useState } from 'react';
import { getInteractiveEngine } from '@/engine/stockfish/enginePool';
import type { EngineResult, Evaluation, PvLine } from '@/types';
import type { UciEngine } from '@/engine/stockfish/engine';
import { AbortedError } from '@/engine/stockfish/engine';
import { useSettings } from './data';
import { isTerminal } from '@/chess/positions/board';

/** Lazily start the interactive engine and expose an `analyze` function. */
export function useInteractiveEngine() {
  const settings = useSettings();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const get = useCallback(async (): Promise<UciEngine> => {
    try {
      const e = await getInteractiveEngine(settings.engineFlavor);
      setName(e.name);
      setError(null);
      return e;
    } catch (err) {
      const msg = `The chess engine could not start: ${(err as Error).message}`;
      setError(msg);
      throw new Error(msg);
    }
  }, [settings.engineFlavor]);
  const analyze = useCallback(async (req: { fen: string; depth: number; multiPv?: number }): Promise<EngineResult> => (await get()).analyze(req), [get]);
  return { analyze, error, name, get };
}

export interface LiveAnalysis {
  depth: number;
  lines: PvLine[];
  eval: Evaluation | null;
  running: boolean;
  error: string | null;
  engineName: string | null;
}

/** Streaming analysis of one position; restarts on FEN change and stops on unmount. */
export function useLiveAnalysis(fen: string | null, enabled: boolean, maxDepth: number, multiPv: number): LiveAnalysis {
  const { get } = useInteractiveEngine();
  const [state, setState] = useState<LiveAnalysis>({ depth: 0, lines: [], eval: null, running: false, error: null, engineName: null });
  const reqId = useRef(0);
  useEffect(() => {
    if (!fen || !enabled) {
      setState((s) => ({ ...s, running: false }));
      return;
    }
    if (isTerminal(fen).over) {
      setState({ depth: 0, lines: [], eval: null, running: false, error: null, engineName: null });
      return;
    }
    const id = ++reqId.current;
    const ctrl = new AbortController();
    setState((s) => ({ ...s, depth: 0, lines: [], running: true, error: null }));
    const lines = new Map<number, PvLine>();
    (async () => {
      try {
        const engine = await get();
        if (id !== reqId.current) return;
        setState((s) => ({ ...s, engineName: engine.name }));
        const r = await engine.analyze({
          fen,
          depth: maxDepth,
          multiPv,
          signal: ctrl.signal,
          onProgress: (p) => {
            if (id !== reqId.current || !p.eval) return;
            lines.set(1, { multipv: 1, eval: p.eval, moves: p.pv, depth: p.depth });
            setState((s) => ({ ...s, depth: p.depth, eval: p.eval, lines: [...lines.values()] }));
          },
        });
        if (id !== reqId.current) return;
        setState({ depth: r.depth, lines: r.lines, eval: r.lines[0]?.eval ?? null, running: false, error: null, engineName: engine.name });
      } catch (e) {
        if (e instanceof AbortedError || id !== reqId.current) return;
        setState((s) => ({ ...s, running: false, error: (e as Error).message }));
      }
    })();
    return () => ctrl.abort();
  }, [fen, enabled, maxDepth, multiPv, get]);
  return state;
}
