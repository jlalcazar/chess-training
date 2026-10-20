import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  alignments,
  evaluateMove,
  forks,
  load,
  mateInOne,
  pawnStructure,
  threatenedPieces,
  unprotectedPieces,
  worstPieces,
} from '../src/analysis.js';

test('detecta mate en 1 (mate del pasillo)', () => {
  const fen = '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1';
  assert.deepEqual(mateInOne(fen, 'w').map((m) => m.san), ['Ra8#']);
  assert.equal(mateInOne(fen, 'b').length, 0);
});

test('detecta la amenaza de mate del rival pasando turno', () => {
  const fen = 'r5k1/8/8/8/8/8/5PPP/6K1 w - - 0 1';
  assert.deepEqual(mateInOne(fen, 'b').map((m) => m.san), ['Ra1#']);
});

test('piezas desprotegidas y amenazadas', () => {
  const chess = load('4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1');
  assert.deepEqual(unprotectedPieces(chess, 'b').map((p) => p.square), ['d5']);
  assert.deepEqual(threatenedPieces(chess, 'b').map((p) => p.square), ['d5']);
  assert.deepEqual(threatenedPieces(chess, 'w'), []);
});

test('ataque doble de caballo sobre rey y dama', () => {
  const fen = 'q3k3/8/8/1N6/8/8/8/4K3 w - - 0 1';
  const f = forks(fen, 'w');
  const nc7 = f.find((x) => x.move.to === 'c7');
  assert.ok(nc7, 'Nc7 no aparece como ataque doble');
  assert.deepEqual(nc7.targets.map((t) => t.square).sort(), ['a8', 'e8']);
});

test('clavada de alfil contra el rey', () => {
  const chess = load('4k3/8/2n5/1B6/8/8/8/4K3 w - - 0 1');
  const { pins } = alignments(chess, 'w');
  assert.equal(pins.length, 1);
  assert.equal(pins[0].kind, 'clavada');
  assert.equal(pins[0].front.square, 'c6');
});

test('evaluateMove cuenta síes y avisa de piezas colgadas', () => {
  const good = evaluateMove('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', 'Ra8');
  assert.equal(good.mate, true);
  const bad = evaluateMove('4k3/8/8/8/8/8/3r4/Q3K3 w - - 0 1', 'Qa5');
  assert.ok(bad.warnings.length === 0);
  const hang = evaluateMove('4k3/4r3/8/8/8/8/8/Q3K3 w - - 0 1', 'Qe5');
  assert.ok(hang.warnings.some((w) => w.includes('dama')), JSON.stringify(hang.warnings));
});

test('estructura de peones: aislados, doblados y pasados', () => {
  const chess = load('4k3/8/8/8/8/P7/P4P2/4K3 w - - 0 1');
  const s = pawnStructure(chess, 'w');
  assert.deepEqual(s.isolated.map((p) => p.square).sort(), ['a2', 'a3', 'f2']);
  assert.deepEqual(s.doubled.map((p) => p.square).sort(), ['a2', 'a3']);
  assert.equal(s.passed.length, 3);
});

test('peor pieza: el caballo en la esquina', () => {
  const ranked = worstPieces('4k3/8/8/8/3Q4/8/8/N3K3 w - - 0 1', 'w');
  assert.equal(ranked[0].square, 'a1');
});
