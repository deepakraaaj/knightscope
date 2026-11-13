import type { EngineResult, Evaluation, PvLine } from '@/types';

// Optional Lichess cloud evaluation (https://lichess.org/api#tag/Analysis). Disabled by default.
// Only used when the user enables it; requests are sequential and back off on rate limiting.
let blockedUntil = 0;
let inflight: Promise<unknown> = Promise.resolve();

interface CloudResponse {
  fen: string;
  depth: number;
  pvs: { moves: string; cp?: number; mate?: number }[];
}

export async function fetchCloudEval(fen: string, multiPv: number, signal?: AbortSignal): Promise<EngineResult | null> {
  if (Date.now() < blockedUntil) return null;
  const run = async (): Promise<EngineResult | null> => {
    const url = `https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(fen)}&multiPv=${multiPv}`;
    let res: Response;
    try {
      res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    } catch {
      return null;
    }
    if (res.status === 429) {
      blockedUntil = Date.now() + 60_000;
      return null;
    }
    if (!res.ok) return null; // 404 = position not in the cloud database
    const data = (await res.json()) as CloudResponse;
    if (!Array.isArray(data.pvs) || data.pvs.length === 0) return null;
    // Lichess cloud scores are from White's point of view.
    const lines: PvLine[] = data.pvs.map((p, i) => {
      const ev: Evaluation = p.mate !== undefined ? { kind: 'mate', value: p.mate } : { kind: 'cp', value: p.cp ?? 0 };
      return { multipv: i + 1, eval: ev, moves: p.moves.split(' ').filter(Boolean), depth: data.depth };
    });
    return {
      fen,
      depth: data.depth,
      lines,
      bestMove: lines[0].moves[0] ?? null,
      bestMoveByDepth: { [data.depth]: lines[0].moves[0] },
      evalByDepth: { [data.depth]: lines[0].eval },
      interrupted: false,
      engineId: 'Lichess cloud eval',
      source: 'cloud',
    };
  };
  const p = inflight.then(run, run);
  inflight = p.catch(() => undefined);
  return p;
}
