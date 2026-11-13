import type { EngineResult, Evaluation, PvLine } from '@/types';
import { normalizeScore, sideToMoveFromFen } from '@/chess/positions/evaluation';
import { parseBestMove, parseIdName, parseInfoLine } from '@/engine/uci/parse';
import type { EngineTransport, TransportFactory } from './transport';

export interface AnalyzeRequest {
  fen: string;
  depth: number;
  multiPv?: number;
  /** Optional hard time cap; search stops at depth OR time, whichever comes first. */
  moveTimeMs?: number;
  /** Restrict the search to these UCI moves. */
  searchMoves?: string[];
  signal?: AbortSignal;
  onProgress?: (p: { depth: number; eval: Evaluation | null; pv: string[] }) => void;
}

export class EngineError extends Error {
  constructor(message: string, readonly recoverable = true) {
    super(message);
    this.name = 'EngineError';
  }
}

export class AbortedError extends Error {
  constructor() {
    super('Analysis was cancelled.');
    this.name = 'AbortedError';
  }
}

type Waiter = { match: (line: string) => boolean; resolve: (line: string) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

interface ActiveSearch {
  req: AnalyzeRequest;
  sideToMove: 'w' | 'b';
  lines: Map<number, PvLine>;
  bestMoveByDepth: Record<number, string>;
  evalByDepth: Record<number, Evaluation>;
  maxDepth: number;
  stopped: boolean;
  resolve: (r: EngineResult) => void;
  reject: (e: Error) => void;
  watchdog: ReturnType<typeof setTimeout> | null;
}

const INIT_TIMEOUT_MS = 30_000;

/**
 * UCI engine wrapper with a deterministic, strictly serialized command queue.
 * Each search is bracketed by `position` + `isready`/`readyok` and ends at `bestmove`, so output
 * from a previous (possibly cancelled) search can never be attributed to a later position.
 */
export class UciEngine {
  name = 'Unknown engine';
  private transport: EngineTransport | null = null;
  private waiters: Waiter[] = [];
  private active: ActiveSearch | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private currentMultiPv = 1;
  private dead = false;
  private fatalError: Error | null = null;

  constructor(private readonly factory: TransportFactory, private readonly options: { hashMb?: number; threads?: number } = {}) {}

  get ready(): boolean {
    return this.transport !== null && !this.dead;
  }

  async init(): Promise<void> {
    this.dead = false;
    this.fatalError = null;
    this.transport = await this.factory();
    this.transport.setListener(
      (l) => this.handleLine(l),
      (e) => this.handleFatal(e),
    );
    const idLines: string[] = [];
    const collector = (l: string) => {
      const n = parseIdName(l);
      if (n) idLines.push(n);
      return l === 'uciok';
    };
    this.send('uci');
    await this.waitFor(collector, INIT_TIMEOUT_MS, 'Engine did not respond to "uci". It may have failed to load.');
    if (idLines[0]) this.name = idLines[0];
    if (this.options.hashMb) this.send(`setoption name Hash value ${this.options.hashMb}`);
    if (this.options.threads && this.options.threads > 1) this.send(`setoption name Threads value ${this.options.threads}`);
    this.send('setoption name MultiPV value 1');
    this.currentMultiPv = 1;
    await this.sync();
  }

  /** Queue an analysis. Requests run strictly one at a time in submission order. */
  analyze(req: AnalyzeRequest): Promise<EngineResult> {
    const run = () => this.runSearch(req);
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  /** Clears engine hash between unrelated games, inside the queue. */
  newGame(): Promise<void> {
    const run = async () => {
      this.ensureAlive();
      this.send('ucinewgame');
      await this.sync();
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  /** Stop the current search (its promise resolves with interrupted=true or rejects if aborted). */
  stop(): void {
    if (this.active && !this.active.stopped) {
      this.active.stopped = true;
      this.send('stop');
    }
  }

  async restart(): Promise<void> {
    this.terminate();
    await this.init();
  }

  terminate(): void {
    this.dead = true;
    for (const w of this.waiters) {
      clearTimeout(w.timer);
      w.reject(new EngineError('Engine terminated.'));
    }
    this.waiters = [];
    if (this.active) {
      if (this.active.watchdog) clearTimeout(this.active.watchdog);
      this.active.reject(new EngineError('Engine terminated during analysis.'));
      this.active = null;
    }
    try {
      this.transport?.post('quit');
    } catch {
      /* worker may already be gone */
    }
    this.transport?.terminate();
    this.transport = null;
  }

  private ensureAlive() {
    if (this.fatalError) throw this.fatalError;
    if (!this.transport || this.dead) throw new EngineError('Engine is not running.');
  }

  private send(cmd: string) {
    this.ensureAlive();
    this.transport!.post(cmd);
  }

  private sync(timeoutMs = 15_000): Promise<string> {
    this.send('isready');
    return this.waitFor((l) => l === 'readyok', timeoutMs, 'Engine stopped responding.');
  }

  private waitFor(match: (l: string) => boolean, timeoutMs: number, message: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.timer !== timer);
        reject(new EngineError(message));
      }, timeoutMs);
      this.waiters.push({ match, resolve, reject, timer });
    });
  }

  private async runSearch(req: AnalyzeRequest): Promise<EngineResult> {
    this.ensureAlive();
    if (req.signal?.aborted) throw new AbortedError();
    const multiPv = Math.max(1, Math.min(5, req.multiPv ?? 1));
    if (multiPv !== this.currentMultiPv) {
      this.send(`setoption name MultiPV value ${multiPv}`);
      this.currentMultiPv = multiPv;
    }
    this.send(`position fen ${req.fen}`);
    await this.sync();
    if (req.signal?.aborted) throw new AbortedError();

    return new Promise<EngineResult>((resolve, reject) => {
      const active: ActiveSearch = {
        req,
        sideToMove: sideToMoveFromFen(req.fen),
        lines: new Map(),
        bestMoveByDepth: {},
        evalByDepth: {},
        maxDepth: 0,
        stopped: false,
        resolve,
        reject,
        watchdog: null,
      };
      this.active = active;
      const onAbort = () => this.stop();
      req.signal?.addEventListener('abort', onAbort, { once: true });
      // Watchdog: if the engine never answers with bestmove, fail instead of hanging forever.
      const budget = (req.moveTimeMs ?? 0) > 0 ? req.moveTimeMs! * 4 + 20_000 : 180_000 + req.depth * 10_000;
      active.watchdog = setTimeout(() => {
        if (this.active === active) {
          this.active = null;
          req.signal?.removeEventListener('abort', onAbort);
          reject(new EngineError('Engine search timed out and was abandoned. The engine will be restarted.'));
          this.handleFatal(new EngineError('Engine search watchdog expired.'));
        }
      }, budget);
      let cmd = `go depth ${Math.max(1, Math.floor(req.depth))}`;
      if (req.moveTimeMs && req.moveTimeMs > 0) cmd += ` movetime ${Math.floor(req.moveTimeMs)}`;
      if (req.searchMoves?.length) cmd += ` searchmoves ${req.searchMoves.join(' ')}`;
      const cleanup = () => req.signal?.removeEventListener('abort', onAbort);
      active.resolve = (r) => {
        cleanup();
        if (req.signal?.aborted) reject(new AbortedError());
        else resolve(r);
      };
      active.reject = (e) => {
        cleanup();
        reject(e);
      };
      this.send(cmd);
    });
  }

  private handleLine(line: string) {
    for (const w of [...this.waiters]) {
      if (w.match(line)) {
        clearTimeout(w.timer);
        this.waiters = this.waiters.filter((x) => x !== w);
        w.resolve(line);
      }
    }
    const a = this.active;
    if (!a) return; // Output outside an active search window is ignored (prevents stale attribution).
    if (line.startsWith('info ')) {
      const info = parseInfoLine(line);
      if (!info || !info.score) return;
      const ev = normalizeScore(info.score, a.sideToMove);
      if (info.bound === null && info.pv.length > 0) {
        a.lines.set(info.multipv, { multipv: info.multipv, eval: ev, moves: info.pv, depth: info.depth });
        if (info.multipv === 1) {
          a.bestMoveByDepth[info.depth] = info.pv[0];
          a.evalByDepth[info.depth] = ev;
          a.maxDepth = Math.max(a.maxDepth, info.depth);
          a.req.onProgress?.({ depth: info.depth, eval: ev, pv: info.pv });
        }
      } else if (info.depth === 0 && info.score.kind === 'mate') {
        // Terminal position reported by the engine (checkmated side to move).
        a.lines.set(1, { multipv: 1, eval: ev, moves: [], depth: 0 });
        a.evalByDepth[0] = ev;
      } else if (info.depth === 0 && info.score.kind === 'cp' && info.pv.length === 0) {
        a.lines.set(1, { multipv: 1, eval: ev, moves: [], depth: 0 });
        a.evalByDepth[0] = ev;
      }
      return;
    }
    const bm = parseBestMove(line);
    if (bm) {
      if (a.watchdog) clearTimeout(a.watchdog);
      this.active = null;
      const lines = [...a.lines.values()].sort((x, y) => x.multipv - y.multipv);
      const reachedDepth = a.maxDepth;
      a.resolve({
        fen: a.req.fen,
        depth: reachedDepth,
        lines,
        bestMove: bm.bestMove,
        bestMoveByDepth: a.bestMoveByDepth,
        evalByDepth: a.evalByDepth,
        interrupted: a.stopped,
        engineId: this.name,
        source: 'engine',
      });
    }
  }

  private handleFatal(err: Error) {
    this.fatalError = err instanceof EngineError ? err : new EngineError(err.message);
    this.dead = true;
    if (this.active) {
      if (this.active.watchdog) clearTimeout(this.active.watchdog);
      this.active.reject(this.fatalError);
      this.active = null;
    }
    for (const w of this.waiters) {
      clearTimeout(w.timer);
      w.reject(this.fatalError);
    }
    this.waiters = [];
    try {
      this.transport?.terminate();
    } catch {
      /* ignore */
    }
    this.transport = null;
  }
}
