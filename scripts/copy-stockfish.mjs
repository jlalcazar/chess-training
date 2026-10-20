// Copia el motor Stockfish WASM (lite, un hilo) desde node_modules a public/,
// para que Vite lo sirva como archivo estático junto a su .wasm.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(dirname(require.resolve('stockfish/package.json')), 'bin');
const out = join(root, 'public', 'stockfish');
mkdirSync(out, { recursive: true });
for (const file of ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm']) {
  copyFileSync(join(bin, file), join(out, file));
}
console.log('Stockfish copiado en public/stockfish/');
