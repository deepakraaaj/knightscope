// Pure parsers for UCI engine output. Scores are in side-to-move perspective here;
// normalization to White's perspective happens in the engine layer.

export interface UciInfo {
  depth: number;
  seldepth?: number;
  multipv: number;
  score: { kind: 'cp' | 'mate'; value: number } | null;
  bound: 'lower' | 'upper' | null;
  pv: string[];
  nodes?: number;
  nps?: number;
  time?: number;
}

const INT_FIELDS = new Set(['depth', 'seldepth', 'multipv', 'nodes', 'nps', 'time', 'hashfull', 'tbhits']);

export function parseInfoLine(line: string): UciInfo | null {
  if (!line.startsWith('info ')) return null;
  const t = line.trim().split(/\s+/);
  const info: UciInfo = { depth: -1, multipv: 1, score: null, bound: null, pv: [] };
  for (let i = 1; i < t.length; i++) {
    const tok = t[i];
    if (tok === 'string') return null; // free-form engine message
    if (INT_FIELDS.has(tok)) {
      const n = Number(t[i + 1]);
      if (!Number.isFinite(n)) return null;
      (info as unknown as Record<string, number>)[tok] = n;
      i++;
    } else if (tok === 'score') {
      const kind = t[i + 1];
      const value = Number(t[i + 2]);
      if ((kind !== 'cp' && kind !== 'mate') || !Number.isFinite(value)) return null;
      info.score = { kind, value };
      i += 2;
    } else if (tok === 'lowerbound') info.bound = 'lower';
    else if (tok === 'upperbound') info.bound = 'upper';
    else if (tok === 'pv') {
      info.pv = t.slice(i + 1).filter((m) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m));
      break;
    }
  }
  if (info.depth < 0) return null;
  return info;
}

export function parseBestMove(line: string): { bestMove: string | null; ponder: string | null } | null {
  const m = /^bestmove\s+(\S+)(?:\s+ponder\s+(\S+))?/.exec(line.trim());
  if (!m) return null;
  const bm = m[1] === '(none)' || m[1] === '0000' ? null : m[1];
  return { bestMove: bm, ponder: m[2] ?? null };
}

export function parseIdName(line: string): string | null {
  const m = /^id name\s+(.+)$/.exec(line.trim());
  return m ? m[1].trim() : null;
}
