import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyMistake, errorAdvice } from '../src/errors.js';

const FORK_FEN = '5r1k/ppp2q2/7p/4P1p1/1P1P4/2P3RP/P2Q2K1/8 b - - 3 36';
const FORK_SOLUTION = ['f7f1', 'g2h2', 'f8f2', 'd2f2', 'f1f2'];

test('orden equivocado: la jugada es una de tus jugadas posteriores', () => {
  // Mate en 4 (85dvN) tras Rh3 Kg8: Qh6 antes de Rh8+ es la idea en mal orden.
  const fen = 'r1b2rk1/1p1n1pp1/4p3/b2pB3/p2P4/q1P4R/P2Q1PPP/R5K1 w - - 2 20';
  const r = classifyMistake(fen, 'd2h6', ['h3h8', 'g8h8', 'd2h6', 'h8g8', 'h6g7'], 0);
  assert.equal(r.kind, 'orden');
  assert.match(r.text, /primero Rh8\+/);
});

test('buena pieza, mala casilla', () => {
  const r = classifyMistake(FORK_FEN, 'f7f3', FORK_SOLUTION, 0);
  assert.equal(r.kind, 'casilla');
  assert.match(r.text, /Qf1\+, no Qf3\+/);
});

test('deja algo colgado, u otra idea', () => {
  // La dama va a e5, donde la torre de e7 la captura gratis.
  const hang = classifyMistake('4k3/4r3/8/8/8/8/R7/Q3K3 w - - 0 1', 'a1e5', ['a2a8'], 0);
  assert.equal(hang.kind, 'colgada');
  assert.match(hang.text, /dama/);
  const same = classifyMistake('4k3/4r3/8/8/8/8/8/Q3K3 w - - 0 1', 'a1e5', ['a1a8'], 0);
  assert.equal(same.kind, 'casilla', 'con la misma pieza, «buena pieza, mala casilla» va antes');
  const quiet = classifyMistake('4k3/8/8/8/8/8/8/R3K3 w - - 0 1', 'e1d2', ['a1a8'], 0);
  assert.equal(quiet.kind, 'otra');
});

test('fallo de profilaxis: el rival ya tenía una idea forzada', () => {
  // Las negras amenazan Qf1+ con ataque doble (S14en visto desde las blancas).
  const fen = '5r1k/ppp2q2/7p/4P1p1/1P1P4/2P3RP/P2Q2K1/8 w - - 3 36';
  // Búsqueda de ~800 ms: con el límite normal (250 ms) una máquina lenta o cargada no llegaría.
  const r = classifyMistake(fen, 'a2a3', ['g3f3'], 0, { maxMs: 5000 });
  assert.equal(r.kind, 'profilaxis', r.text);
});

test('consejo de estadísticas', () => {
  assert.match(errorAdvice([{ kind: 'orden', rate: 0.4 }]), /El 40 % de tus fallos son «orden equivocado»: entrena la «Línea a ciegas»/);
  assert.equal(errorAdvice([]), null);
});
