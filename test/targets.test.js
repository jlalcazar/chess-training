import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerQuestion, kingWeakness, scorePicks } from '../src/method.js';
import { holes, load, outposts, pieceRoutes, squareControl } from '../src/analysis.js';

const FORK_FEN = '5r1k/ppp2q2/7p/4P1p1/1P1P4/2P3RP/P2Q2K1/8 b - - 3 36';

test('todos los hallazgos llevan targets', () => {
  for (const id of ['mate', 'desprotegidas', 'amenazadas', 'geometria', 'debilidades', 'peorPieza', 'rival', 'cambios', 'estructura', 'coronar', 'torre', 'fijar', 'casillas']) {
    for (const f of answerQuestion(id, FORK_FEN, 'b').findings) assert.ok(Array.isArray(f.targets), `${id}: ${f.text}`);
  }
});

test('amenazadas: el objetivo es la pieza amenazada, no sus atacantes', () => {
  const r = answerQuestion('amenazadas', '4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1', 'w');
  assert.deepEqual(r.findings[0].targets, ['d5']);
  assert.ok(r.findings[0].squares.includes('d1'));
});

test('mate: el objetivo es la jugada de mate (origen y destino)', () => {
  const r = answerQuestion('mate', '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', 'w');
  const f = r.findings.find((x) => x.move === 'a1a8');
  assert.deepEqual(f.targets, ['a1', 'a8']);
  assert.equal(f.match, 'all');
  assert.equal(scorePicks(r.findings, ['a8']).correct, false, 'solo el destino no es jugar el mate');
  assert.equal(scorePicks(r.findings, ['a1', 'a8']).correct, true);
});

test('scorePicks: encontrados, escapados y falsas alarmas', () => {
  const findings = [
    { text: 'a', squares: ['d5', 'd1'], targets: ['d5'], match: 'any' },
    { text: 'b', squares: ['e4'], targets: ['e4'], match: 'any' },
    { text: 'línea', squares: ['a1', 'h8'], targets: [], match: 'any' },
  ];
  const r = scorePicks(findings, ['d5', 'h8', 'c3']);
  assert.equal(r.required, 2);
  assert.equal(r.found.length, 1);
  assert.equal(r.missed[0].text, 'b');
  assert.deepEqual(r.falseAlarms, ['c3'], 'una casilla informativa no es falsa alarma');
  assert.equal(r.correct, false);
  assert.equal(scorePicks([], []).correct, true, '"No hay nada" cuando no hay nada es acierto');
  assert.equal(scorePicks([], ['e4']).correct, false);
});

test('las líneas informativas de geometría no cuentan para el sí', () => {
  // Solo piezas alineadas, sin clavadas ni ataques dobles ni ideas.
  const r = answerQuestion('geometria', '4k3/8/8/8/8/8/8/R3K2R w - - 0 1', 'w');
  assert.ok(r.findings.every((f) => !f.targets.length));
  assert.equal(r.yes, false);
});

test('debilidades: el rey en el centro ya no es siempre un SÍ', () => {
  // Posición inicial: rey en e1 pero puede enrocar y todos los peones en su sitio.
  const start = load('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  assert.equal(kingWeakness(start, 'w'), null);
  assert.equal(answerQuestion('debilidades', start.fen(), 'w').yes, false);
  // Sin enroque y con la columna e abierta: sí es debilidad.
  const open = load('rnbqkbnr/pppp1ppp/8/8/8/8/PPPP1PPP/RNBQKBNR w - - 0 1');
  assert.ok(kingWeakness(open, 'w'));
  // En un final el rey en el centro es bueno.
  assert.equal(kingWeakness(load('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1'), 'w'), null);
});

test('agujeros y puestos avanzados', () => {
  // Blancas: peones c4 y e4 con d4 hueco: d4 es agujero (ningún peón blanco lo cubre).
  const chess = load('4k3/pp3ppp/8/8/2P1P3/8/PP3PPP/4K3 w - - 0 1');
  assert.ok(holes(chess, 'w').includes('d4'));
  assert.ok(!holes(chess, 'w').includes('f3'));
  // Puesto avanzado blanco en d5: defendido por c4 y e4, sin peones negros en c y e.
  const out = load('4k3/pp3ppp/8/8/2P1P3/8/PP3PPP/4K3 w - - 0 1');
  assert.ok(outposts(out, 'w').includes('d5'));
});

test('control de casillas: el peón manda sobre las piezas', () => {
  const c = squareControl(load('4k3/8/8/8/8/3p4/8/2R1R1K1 w - - 0 1'));
  // e2 lo atacan la torre e1 (blanca) y el peón d3 (negro): manda el peón.
  assert.equal(c.e2.owner, 'b');
  assert.equal(c.c3.owner, 'w');
  assert.equal(c.a5.owner, null);
});

test('rutas de una pieza: el caballo de la esquina hasta d4', () => {
  const r = pieceRoutes('4k3/8/8/8/8/8/8/N3K3 w - - 0 1', 'a1', { to: 'd4' });
  assert.equal(r.to.moves, 2);
  assert.deepEqual([r.to.path[0], r.to.path.at(-1)], ['a1', 'd4']);
  assert.equal(r.best.length, 3);
  assert.ok(r.best.every((b) => b.sq !== 'a1'));
  // Las casillas atacadas por un peón rival se marcan como peligrosas.
  const d = pieceRoutes('4k3/8/8/2p5/8/8/8/N3K3 w - - 0 1', 'a1', { to: 'b4' });
  assert.equal(d.routes.b3.dangers.length, 0);
  assert.equal(d.to.dangers.at(-1).why, 'la ataca un peón');
});
