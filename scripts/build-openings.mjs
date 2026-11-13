// Builds src/chess/openings/openings.json from the Lichess chess-openings TSV files (CC0).
// named: EPD -> [eco, name] for positions that end a named line.
// book:  53-bit hashes (base36) of EPDs for every position reached inside any named line.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { Chess } from 'chess.js';
import { epdHash } from './epd-hash.mjs';

const named = {};
const book = new Set();
for (const f of ['a', 'b', 'c', 'd', 'e']) {
  const lines = readFileSync(`data/openings/${f}.tsv`, 'utf8').trim().split('\n').slice(1);
  for (const line of lines) {
    const [eco, name, pgn] = line.split('\t');
    const src = new Chess();
    src.loadPgn(pgn);
    const replay = new Chess();
    for (const san of src.history()) {
      replay.move(san);
      book.add(epdHash(replay.fen().split(' ').slice(0, 4).join(' ')));
    }
    const epd = replay.fen().split(' ').slice(0, 4).join(' ');
    if (!named[epd] || name.length < named[epd][1].length) named[epd] = [eco, name];
  }
}
mkdirSync('src/chess/openings', { recursive: true });
writeFileSync('src/chess/openings/openings.json', JSON.stringify({ named, book: [...book] }));
console.log('named', Object.keys(named).length, 'book', book.size);
