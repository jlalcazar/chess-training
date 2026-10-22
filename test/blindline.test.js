import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blindQuestions, cpToSymbol, firstDeviation, gradeBlind, playLine, rivalNode } from '../src/blindline.js';

const FORK_FEN = '5r1k/ppp2q2/7p/4P1p1/1P1P4/2P3RP/P2Q2K1/8 b - - 3 36';
const FORK_SOLUTION = ['f7f1', 'g2h2', 'f8f2', 'd2f2', 'f1f2'];

test('playLine recorre la línea y se para en una jugada ilegal', () => {
  const l = playLine(FORK_FEN, ['f7f1', 'g2h2', 'a1a2']);
  assert.deepEqual(l.moves.map((m) => m.san), ['Qf1+', 'Kh2']);
  assert.deepEqual(l.moves.map((m) => m.by), ['you', 'rival']);
});

test('primera jugada que se aparta de la solución', () => {
  assert.equal(firstDeviation(FORK_FEN, FORK_SOLUTION, FORK_SOLUTION), -1);
  assert.equal(firstDeviation(FORK_FEN, ['f7f1', 'g2h2', 'f8f2', 'd2f2'], FORK_SOLUTION), -1, 'una línea más corta que coincide');
  assert.equal(firstDeviation(FORK_FEN, ['f7f1', 'g2h3'], FORK_SOLUTION), 1, 'la respuesta del rival no era esa');
  assert.equal(firstDeviation(FORK_FEN, ['f7f3'], FORK_SOLUTION), 0);
  // Otro mate también vale.
  assert.equal(firstDeviation('6k1/5ppp/8/8/8/8/8/R5KR w - - 0 1', ['a1a8'], ['h1h8']), -1);
});

test('preguntas sobre la posición final y su corrección', () => {
  const qs = blindQuestions(FORK_FEN, FORK_SOLUTION);
  assert.ok(qs.length >= 2 && qs.length <= 3);
  const where = qs.find((q) => q.id === 'donde');
  assert.deepEqual(where.answer, ['f2'], 'la dama acaba en f2');
  assert.equal(gradeBlind(where, 'f2'), true);
  assert.equal(gradeBlind(where, 'f1'), false);
  const mat = qs.find((q) => q.id === 'material');
  assert.equal(mat.answer, 'ganas');
  // Con 5 jugadas toca la pieza indefensa; con 4, lo que le queda al rival.
  assert.ok(qs.some((q) => q.id === 'indefensa'));
  const pending = blindQuestions(FORK_FEN, FORK_SOLUTION.slice(0, 4)).find((q) => q.id === 'pendiente');
  assert.equal(typeof pending.answer, 'boolean');
  assert.equal(gradeBlind({ kind: 'squares', answer: [] }, []), true, '«ninguna» cuando no hay ninguna');
  assert.equal(gradeBlind({ kind: 'squares', answer: ['e4'] }, ['e4']), true);
  assert.equal(gradeBlind({ kind: 'squares', answer: ['e4'] }, ['e4', 'a1']), false);
});

test('nodo del rival: jaques, capturas y cuántos has mirado', () => {
  // Tras Qf1+ las blancas solo tienen jugadas de rey: ningún jaque ni captura.
  const afterQf1 = playLine(FORK_FEN, ['f7f1']).fen;
  assert.deepEqual(rivalNode(afterQf1, []), { checks: 0, captures: 0, total: 0, seen: 0 });
  // Tras Qf1+ Kh2 Rf2+ el rival puede capturar en f2.
  const node = rivalNode(playLine(FORK_FEN, ['f7f1', 'g2h2', 'f8f2']).fen, ['d2f2']);
  assert.ok(node.captures >= 1);
  assert.equal(node.seen, 1);
});

test('escala de valoración', () => {
  assert.equal(cpToSymbol(350), 2);
  assert.equal(cpToSymbol(120), 1);
  assert.equal(cpToSymbol(-20), 0);
  assert.equal(cpToSymbol(-150), -1);
  assert.equal(cpToSymbol(-900), -2);
});
