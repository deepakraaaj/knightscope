/** Minimal bidirectional line transport to a UCI engine (Web Worker, native plugin, Node child process). */
export interface EngineTransport {
  post(command: string): void;
  setListener(onLine: (line: string) => void, onError: (err: Error) => void): void;
  terminate(): void;
}

export type TransportFactory = () => EngineTransport | Promise<EngineTransport>;

/** Browser transport: runs the stockfish.js build inside a dedicated Web Worker. */
export function createWorkerTransport(scriptUrl: string): EngineTransport {
  const worker = new Worker(scriptUrl);
  let onLine: (l: string) => void = () => {};
  let onError: (e: Error) => void = () => {};
  worker.onmessage = (ev: MessageEvent) => {
    const data = typeof ev.data === 'string' ? ev.data : String(ev.data ?? '');
    for (const l of data.split('\n')) if (l.trim()) onLine(l.trim());
  };
  worker.onerror = (ev: ErrorEvent) => {
    ev.preventDefault();
    onError(new Error(ev.message || 'Engine worker failed to load. Check that the engine files are available.'));
  };
  worker.onmessageerror = () => onError(new Error('Engine worker message could not be decoded.'));
  return {
    post: (c) => worker.postMessage(c),
    setListener: (l, e) => {
      onLine = l;
      onError = e;
    },
    terminate: () => worker.terminate(),
  };
}
