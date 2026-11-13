import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { EngineTransport } from '@/engine/stockfish/transport';

/**
 * Native Stockfish bridge (Android). Stockfish 19 Lite is compiled with the NDK, shipped as
 * libstockfish.so in jniLibs, and started as child processes from nativeLibraryDir by the
 * KnightScopeEngine plugin. Each instance has an id; UCI text flows over the Capacitor bridge,
 * one { id, line } event per stdout line.
 */
export interface NativeEnginePlugin {
  isAvailable(): Promise<{ available: boolean; engineName?: string; cores?: number }>;
  start(options: { id: string }): Promise<void>;
  send(options: { id: string; command: string }): Promise<void>;
  stop(options: { id: string }): Promise<void>;
  addListener(event: 'line', cb: (data: { id?: string; line: string }) => void): Promise<PluginListenerHandle>;
}

export const NativeEngine = registerPlugin<NativeEnginePlugin>('KnightScopeEngine');

export async function nativeEngineInfo(): Promise<{ available: boolean; engineName?: string; cores?: number }> {
  if (!Capacitor.isNativePlatform()) return { available: false };
  try {
    return await NativeEngine.isAvailable();
  } catch {
    return { available: false };
  }
}

/** Transport to one native engine instance. Instances with different ids run as separate processes. */
export async function createNativeTransport(id: string): Promise<EngineTransport> {
  let onLine: (l: string) => void = () => {};
  let onError: (e: Error) => void = () => {};
  const handle = await NativeEngine.addListener('line', (d) => {
    if (d?.line && (d.id ?? 'main') === id) onLine(d.line);
  });
  await NativeEngine.start({ id });
  return {
    post: (command) => {
      NativeEngine.send({ id, command }).catch((e: Error) => onError(new Error(`Native engine error: ${e.message}`)));
    },
    setListener: (l, e) => {
      onLine = l;
      onError = e;
    },
    terminate: () => {
      handle.remove().catch(() => undefined);
      NativeEngine.stop({ id }).catch(() => undefined);
    },
  };
}
