import { Capacitor } from '@capacitor/core';
import type { AppSettings, EngineResult } from '@/types';
import { UciEngine, type AnalyzeRequest } from './engine';
import { createWorkerTransport } from './transport';
import { createNativeTransport, nativeEngineInfo } from '@/engine/native/nativeTransport';
import { db } from '@/storage/database/db';
import { epdOf } from '@/chess/positions/evaluation';
import { fetchCloudEval } from '@/engine/cache/cloudEval';

export const ENGINE_FILES = {
  lite: 'engines/stockfish-19-lite-single.js',
  full: 'engines/stockfish-19-single.js',
} as const;

export function engineUrl(flavor: 'lite' | 'full'): string {
  return new URL(ENGINE_FILES[flavor], document.baseURI).toString();
}

export async function fullEngineAvailable(): Promise<boolean> {
  // The ~94 MB full engine is never bundled into the native apps.
  if (Capacitor.isNativePlatform()) return false;
  try {
    const r = await fetch(engineUrl('full'), { method: 'HEAD' });
    return r.ok;
  } catch {
    return false;
  }
}

export function maxEnginesAllowed(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
  return Math.max(1, Math.min(4, cores - 1));
}

type Flavor = AppSettings['engineFlavor'];

/** Resolve the flavor that can actually run on this device. */
export async function resolveFlavor(requested: Flavor): Promise<Flavor> {
  if (requested === 'native') return (await nativeEngineInfo()).available ? 'native' : 'lite';
  if (requested === 'full') return (await fullEngineAvailable()) ? 'full' : 'lite';
  return 'lite';
}

function makeEngine(flavor: Flavor, instanceId: string): UciEngine {
  if (flavor === 'native') {
    // One thread per process: review searches are short fixed-depth searches, where Stockfish's
    // multi-threading mostly adds overhead (measured: depth 16 took 0.8 s on 1 thread vs 4.3 s on 7).
    // Parallelism comes from running several engine processes at once instead.
    return new UciEngine(() => createNativeTransport(instanceId), { hashMb: 32, threads: 1 });
  }
  const mobile = Capacitor.isNativePlatform() || /Android|iPhone|iPad/i.test(navigator.userAgent);
  return new UciEngine(() => createWorkerTransport(engineUrl(flavor)), { hashMb: mobile ? 16 : 32 });
}

/** A bounded pool of engine instances. Engines are created lazily and restarted after fatal errors. */
class EnginePool {
  private engines: (UciEngine | null)[] = [];
  private flavor: Flavor = 'lite';
  private initPromises = new Map<number, Promise<UciEngine>>();

  async configure(flavor: Flavor, size: number) {
    const resolved = await resolveFlavor(flavor);
    const bounded = Math.max(1, Math.min(size, maxEnginesAllowed()));
    if (resolved !== this.flavor || bounded !== this.engines.length) {
      this.terminateAll();
      this.flavor = resolved;
      this.engines = new Array(bounded).fill(null);
    }
  }

  get size() {
    return Math.max(1, this.engines.length);
  }

  get activeFlavor() {
    return this.flavor;
  }

  async get(slot = 0): Promise<UciEngine> {
    if (this.engines.length === 0) this.engines = [null];
    const i = slot % this.engines.length;
    const existing = this.engines[i];
    if (existing?.ready) return existing;
    const pending = this.initPromises.get(i);
    if (pending) return pending;
    const p = (async () => {
      existing?.terminate();
      const e = makeEngine(this.flavor, `pool-${i}`);
      try {
        await e.init();
      } catch (err) {
        e.terminate();
        if (this.flavor !== 'lite') {
          // Fall back to the lite WASM engine if a stronger flavor fails to start.
          this.flavor = 'lite';
          const fallback = makeEngine('lite', `pool-${i}`);
          await fallback.init();
          this.engines[i] = fallback;
          return fallback;
        }
        throw err;
      }
      this.engines[i] = e;
      return e;
    })();
    this.initPromises.set(i, p);
    try {
      return await p;
    } finally {
      this.initPromises.delete(i);
    }
  }

  stopAll() {
    for (const e of this.engines) e?.stop();
  }

  terminateAll() {
    for (const e of this.engines) e?.terminate();
    this.engines = this.engines.map(() => null);
  }
}

export const enginePool = new EnginePool();

/**
 * Analyze with caching. A cached result is reused only if it came from the same engine build and
 * reached at least the requested depth with at least the requested number of lines.
 */
export async function cachedAnalyze(
  engine: UciEngine,
  req: AnalyzeRequest & { multiPv: number },
  opts: { cloud: boolean; useCache?: boolean } = { cloud: false },
): Promise<EngineResult> {
  const key = `${engine.name}|${epdOf(req.fen)}|${req.multiPv}`;
  if (opts.useCache !== false) {
    try {
      const hit = await db.engineCache.get(key);
      // Also accept an equally demanding earlier request that stopped early because of its time cap.
      if (hit && hit.result.lines.length >= 1 && (hit.depth >= req.depth || (hit.requestedDepth ?? 0) >= req.depth)) {
        return { ...hit.result, fen: req.fen, source: 'cache' };
      }
    } catch {
      /* cache is an optimisation only */
    }
  }
  if (opts.cloud) {
    const cloud = await fetchCloudEval(req.fen, req.multiPv, req.signal);
    if (cloud && cloud.depth >= req.depth && cloud.lines.length >= req.multiPv) return cloud;
  }
  const result = await engine.analyze(req);
  if (!result.interrupted && result.depth > 0) {
    try {
      const prev = await db.engineCache.get(key);
      if (!prev || prev.depth <= result.depth) await db.engineCache.put({ key, depth: result.depth, requestedDepth: req.depth, result, updatedAt: Date.now() });
    } catch {
      /* ignore cache write failures (e.g. quota) */
    }
  }
  return result;
}

// ------------------------------------------------------------------ interactive engine

let interactive: UciEngine | null = null;
let interactiveFlavor: Flavor | null = null;
let interactiveInit: Promise<UciEngine> | null = null;

/**
 * Engine for interactive features (analysis board, retry, training). Kept separate from the batch pool
 * so a running batch analysis does not block the UI.
 */
export async function getInteractiveEngine(requested: Flavor): Promise<UciEngine> {
  const flavor = await resolveFlavor(requested);
  if (interactive?.ready && interactiveFlavor === flavor) return interactive;
  if (interactiveInit) return interactiveInit;
  interactiveInit = (async () => {
    interactive?.terminate();
    const e = makeEngine(flavor, 'interactive');
    await e.init();
    interactive = e;
    interactiveFlavor = flavor;
    return e;
  })();
  try {
    return await interactiveInit;
  } finally {
    interactiveInit = null;
  }
}

export function terminateInteractiveEngine() {
  interactive?.terminate();
  interactive = null;
}
