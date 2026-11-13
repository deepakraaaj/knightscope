// Copies Stockfish WASM engine files from node_modules into public/engines.
// Default: lite single-threaded engine (~1.7 MB). Pass --full to also copy the
// full single-threaded engine (~94 MB) for stronger optional analysis.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'stockfish', 'bin');
const dest = join(root, 'public', 'engines');
if (!existsSync(src)) {
  console.warn('[engine] stockfish package not installed yet; skipping copy');
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
const files = ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm'];
if (process.argv.includes('--full')) files.push('stockfish-19-single.js', 'stockfish-19-single.wasm');
for (const f of files) {
  copyFileSync(join(src, f), join(dest, f));
  console.log(`[engine] copied ${f}`);
}
copyFileSync(join(root, 'node_modules', 'stockfish', 'Copying.txt'), join(dest, 'STOCKFISH-LICENSE.txt'));
