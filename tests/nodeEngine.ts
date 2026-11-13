// Test-only transport: runs the real Stockfish 19 lite WASM build in a Node child process.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import type { EngineTransport } from '@/engine/stockfish/transport';

const require = createRequire(import.meta.url);

export function createNodeTransport(): EngineTransport {
  const enginePath: string = require('stockfish').findEngine('lite-single');
  const child = spawn(process.execPath, [enginePath], { stdio: ['pipe', 'pipe', 'pipe'] });
  let onLine: (l: string) => void = () => {};
  let onError: (e: Error) => void = () => {};
  let buf = '';
  child.stdout.on('data', (d: Buffer) => {
    buf += d.toString();
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onLine(line);
    }
  });
  child.on('error', (e) => onError(e));
  return {
    post: (c) => child.stdin.write(c + '\n'),
    setListener: (l, e) => {
      onLine = l;
      onError = e;
    },
    terminate: () => child.kill(),
  };
}
