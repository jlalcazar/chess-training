import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  alignments,
  evaluateMove,
  forks,
  load,
  mateInOne,
  toSpanish,
  toUci,
  uciToMove,
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

test('idea de varias jugadas: jaque y luego ataque doble (puzzle S14en)', async () => {
  const { describeIdea, findForcingIdea } = await import('../src/analysis.js');
  const fen = '5r1k/ppp2q2/7p/4P1p1/1P1P4/2P3RP/P2Q2K1/8 b - - 3 36';
  const idea = findForcingIdea(fen, { firstMove: { from: 'f7', to: 'f1' } });
  assert.ok(idea, 'no encuentra la idea');
  assert.deepEqual(idea.line.slice(0, 5).map((s) => s.san), ['Qf1+', 'Kh2', 'Rf2+', 'Qxf2', 'Qxf2+']);
  assert.ok(idea.gain >= 4);
  assert.match(describeIdea(idea, { moves: false }), /^da jaque → ataque doble/);
  assert.doesNotMatch(describeIdea(idea, { moves: false }), /Qf1/);
});

test('describeLine explica la solución de un mate en 4', async () => {
  const { describeLine } = await import('../src/analysis.js');
  const idea = describeLine('r1b2r2/1p1n1ppk/4p3/b2pB3/p2P4/q1P1R3/P2Q1PPP/R5K1 w - - 0 19', ['e3h3', 'h7g8', 'h3h8', 'g8h8', 'd2h6', 'h8g8', 'h6g7']);
  assert.equal(idea.mate, true);
  assert.equal(idea.moves, 4);
  assert.ok(idea.line[2].notes.includes('sacrificio'));
});

test('sin jugadas forzadas que ganen no hay idea', async () => {
  const { findForcingIdea } = await import('../src/analysis.js');
  assert.equal(findForcingIdea('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'), null);
});

test('las preguntas de cambios son abiertas y proponen cambios concretos', async () => {
  const { answerQuestion, STRATEGIC_QUESTIONS, ENDGAME_QUESTIONS } = await import('../src/method.js');
  assert.equal(STRATEGIC_QUESTIONS.cambios.open, true);
  assert.equal(ENDGAME_QUESTIONS.cambiosFinal.open, true);
  const r = answerQuestion('cambiosFinal', '3r2k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', 'w');
  assert.ok(r.findings.some((f) => f.text.includes('Cambio disponible: Rxd8')), JSON.stringify(r.findings));
});

const FORK_FEN = '5r1k/ppp2q2/7p/4P1p1/1P1P4/2P3RP/P2Q2K1/8 b - - 3 36';
const MATE4_FEN = 'r1b2r2/1p1n1ppk/4p3/b2pB3/p2P4/q1P1R3/P2Q1PPP/R5K1 w - - 0 19';

test('barrido: cuenta jaques, capturas y amenazas', async () => {
  const { forcingSweep } = await import('../src/analysis.js');
  const s = forcingSweep(FORK_FEN);
  assert.deepEqual(s.checks.map((m) => m.san).sort(), ['Qd5+', 'Qf1+', 'Qf2+', 'Qf3+']);
  assert.deepEqual(s.captures.map((m) => m.san), ['Qxa2']);
  assert.ok(s.threats.every((m) => !m.captured && !m.san.includes('+')));
});

test('puntos ciegos: sacrificio, hacia atrás, largo y pieza olvidada', async () => {
  const { blindSpots } = await import('../src/analysis.js');
  // Rh8+ en el mate en 4: la torre se entrega en h8.
  const afterRh3 = 'r1b2rk1/1p1n1pp1/4p3/b2pB3/p2P4/q1P4R/P2Q1PPP/R5K1 w - - 2 20';
  assert.ok(blindSpots(afterRh3, 'h3h8').includes('sacrificio'));
  assert.ok(blindSpots(FORK_FEN, 'f7f1').includes('largo'));
  assert.deepEqual(blindSpots('4k3/8/8/8/8/8/3B4/4K3 w - - 0 1', 'd2c1'), ['atras', 'tranquila']);
  assert.ok(blindSpots(MATE4_FEN, 'e3h3', ['d2d3']).includes('piezaOlvidada'));
});

test('explainLine reconoce los temas de la solución (como el etiquetador de Lichess)', async () => {
  const { explainLine, narratePly } = await import('../src/analysis.js');
  const mate = explainLine(MATE4_FEN, ['e3h3', 'h7g8', 'h3h8', 'g8h8', 'd2h6', 'h8g8', 'h6g7']);
  const themes = Object.fromEntries(mate.filter((p) => p.by === 'you').map((p) => [p.san, p.themes]));
  assert.ok(themes['Rh8+'].includes('sacrificio') && themes['Rh8+'].includes('atraccion'));
  assert.ok(themes['Qxg7#'].includes('mate'));
  assert.ok(!themes['Qh6+'].includes('sacrificio'));
  assert.equal(mate[3].forced, true);
  assert.match(narratePly(mate[3]), /no tiene otra jugada/);
  const fork = explainLine(FORK_FEN, ['f7f1', 'g2h2', 'f8f2', 'd2f2', 'f1f2']);
  assert.ok(fork[2].themes.includes('ataqueDoble'));
});

test('uciToMove y toUci son inversas', () => {
  assert.deepEqual(uciToMove('e7e8q'), { from: 'e7', to: 'e8', promotion: 'q' });
  assert.equal(toUci(uciToMove('e7e8q')), 'e7e8q');
  assert.equal(toUci(uciToMove('g1f3')), 'g1f3');
});

test('toSpanish traduce las piezas sin tocar el resto del texto', () => {
  assert.equal(toSpanish('Rb8 Nxf7+ Kh2 Qd1# e8=Q Bb5'), 'Tb8 Cxf7+ Rh2 Dd1# e8=D Ab5');
  assert.equal(toSpanish('Busca la torre de b8. Rival: Nf3.'), 'Busca la torre de b8. Rival: Cf3.');
});
