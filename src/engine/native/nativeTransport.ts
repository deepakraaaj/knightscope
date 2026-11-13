import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { EngineTransport } from '@/engine/stockfish/transport';

/**
 * Native Stockfish bridge (Android). Stockfish 19 Lite is compiled with the NDK, shipped as
 * libstockfish.so in jniLibs, and started as a child process from nativeLibraryDir by the
 * KnightScopeEngine plugin. UCI text flows over the Capacitor bridge, one event per line.
 */
export interface NativeEnginePlugin {
  isAvailable(): Promise<{ available: boolean; engineName?: string; cores?: number }>;
  start(): Promise<void>;
  send(options: { command: string }): Promise<void>;
  stop(): Promise<void>;
  addListener(event: 'line', cb: (data: { line: string }) => void): Promise<PluginListenerHandle>;
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

export async function createNativeTransport(): Promise<EngineTransport> {
  let onLine: (l: string) => void = () => {};
  let onError: (e: Error) => void = () => {};
  const handle = await NativeEngine.addListener('line', (d) => {
    if (d?.line) onLine(d.line);
  });
  await NativeEngine.start();
  return {
    post: (command) => {
      NativeEngine.send({ command }).catch((e: Error) => onError(new Error(`Native engine error: ${e.message}`)));
    },
    setListener: (l, e) => {
      onLine = l;
      onError = e;
    },
    terminate: () => {
      handle.remove().catch(() => undefined);
      NativeEngine.stop().catch(() => undefined);
    },
  };
}
