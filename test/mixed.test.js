import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePuzzle } from '../src/lichess.js';
import { emptyMixed, isQuietMove, isQuietPosition, quietCandidates, recordMixed } from '../src/mixed.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));

test('posiciones de 2 a 8 medias jugadas antes del error del rival', () => {
  const puzzle = parsePuzzle(fixture('fork-S14en'));
  const list = quietCandidates(puzzle);
  assert.equal(list.length, 7);
  assert.equal(list[0].plies, puzzle.gameMoves.length - 2);
  assert.ok(list.every((p) => p.heroColor === p.fen.split(' ')[1]));
});

test('jugada tranquila y posición de mejorar', () => {
  const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  assert.equal(isQuietMove(start, 'g1f3'), true);
  assert.equal(isQuietMove('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1', 'e4d5'), false);
  assert.equal(isQuietPosition(start, [{ score: { cp: 30 }, pv: ['e2e4'] }]), true);
  assert.equal(isQuietPosition(start, [{ score: { cp: 400 }, pv: ['e2e4'] }]), false, 'muy desequilibrada');
  assert.equal(isQuietPosition(start, [{ score: { cp: 250 }, pv: ['e2e4'] }, { score: { cp: 10 }, pv: ['d2d4'] }]), false, 'una sola jugada buena');
  // Con una ganancia forzada no es tranquila aunque el motor diga otra cosa.
  const fork = '5r1k/ppp2q2/7p/4P1p1/1P1P4/2P3RP/P2Q2K1/8 b - - 3 36';
  // La búsqueda tarda ~800 ms: con el límite normal (300 ms) una máquina lenta o cargada no llegaría.
  assert.equal(isQuietPosition(fork, [{ score: { cp: 100 }, pv: ['a7a6'] }], { maxMs: 5000 }), false);
});

test('combinaciones inventadas y tácticas no vistas', () => {
  let m = emptyMixed();
  m = recordMixed(m, { kind: 'quiet', declared: 'tactic', goodMove: false });
  m = recordMixed(m, { kind: 'quiet', declared: 'quiet', goodMove: true });
  m = recordMixed(m, { kind: 'tactic', declared: 'quiet' });
  assert.equal(m.invented, 1);
  assert.equal(m.missed, 1);
  assert.deepEqual(m.quiet, { n: 2, said: 1 });
  assert.deepEqual(m.quietMoves, { n: 2, good: 1 });
});
