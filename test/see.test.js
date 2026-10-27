import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMove, forcingSweep, load, replyGain, see, seeMove, threatenedPieces } from '../src/analysis.js';

test('SEE: pieza indefensa se gana entera', () => {
  const chess = load('4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1');
  assert.equal(see(chess, 'd5', 'w'), 3);
});

test('SEE: torre por caballo defendido por peón pierde material', () => {
  const chess = load('4k3/8/4p3/3n4/8/8/8/3RK3 w - - 0 1');
  assert.equal(see(chess, 'd5', 'w'), 0, 'sin forzar, no conviene capturar');
  assert.equal(seeMove(chess, { from: 'd1', to: 'd5' }), -2);
});

test('SEE: rayos X, la torre doblada decide el cambio', () => {
  // Caballo d5 defendido por la torre d8; las blancas atacan con dos torres en la columna d.
  const chess = load('3rk3/8/8/3n4/8/8/3R4/3RK3 w - - 0 1');
  assert.equal(see(chess, 'd5', 'w'), 3, 'Txd5 Txd5 Txd5: gana el caballo');
  // Sin la segunda torre el cambio es igualado (caballo por torre: pierde).
  const single = load('3rk3/8/8/3n4/8/8/3R4/4K3 w - - 0 1');
  assert.equal(see(single, 'd5', 'w'), 0);
});

test('SEE: captura siempre con la pieza de menos valor', () => {
  // Peón e6 defendido por el peón f7; las blancas atacan con peón d5 y dama.
  const chess = load('4k3/5p2/4p3/3P4/8/7Q/8/4K3 w - - 0 1');
  assert.equal(see(chess, 'e6', 'w'), 1, 'dxe6 fxe6 Qxe6+: dos peones por uno');
});

test('SEE: el rey no captura en una casilla defendida', () => {
  const chess = load('4k3/8/8/8/8/2b5/3q4/4K3 w - - 0 1');
  assert.equal(see(chess, 'd2', 'w'), 0);
  const free = load('4k3/8/8/8/8/8/3q4/4K3 w - - 0 1');
  assert.equal(see(free, 'd2', 'w'), 9);
});

test('threatenedPieces usa el cambio, no el número de atacantes', () => {
  // Caballo e5 atacado por dos torres y defendido por un peón: el cambio no gana nada.
  const chess = load('4k3/8/3p4/4n3/8/8/4R3/4R1K1 b - - 0 1');
  assert.deepEqual(threatenedPieces(chess, 'b'), [], 'antes contaba "más atacantes que defensores"');
  // El peón d4 ataca dos piezas (aunque el alfil esté defendido, vale más que el peón).
  const pawn = load('4k3/8/3n4/2n1b3/3P4/8/8/4K3 b - - 0 1');
  assert.deepEqual(threatenedPieces(pawn, 'b').map((p) => p.square).sort(), ['c5', 'e5']);
});

test('evaluateMove: capturar con pérdida es un aviso, no un sí', () => {
  const ev = evaluateMove('4k3/8/4p3/3n4/8/8/8/3RK3 w - - 0 1', 'Rxd5');
  assert.equal(ev.exchange, -2);
  assert.ok(ev.warnings.some((w) => w.includes('pierde material en el cambio')));
  assert.ok(!ev.tags.some((t) => t.q === 'amenazadas'));
});

test('el barrido solo cuenta amenazas que ganan material en el cambio', () => {
  // Cb5 o Cd5 atacan la torre de c7.
  const s = forcingSweep('4k3/2r5/8/8/8/2N5/8/4K3 w - - 0 1');
  assert.ok(s.threats.some((m) => m.san === 'Nb5' || m.san === 'Ne4' || m.san === 'Nd5'));
  const defended = forcingSweep('4k3/1nr5/8/8/8/2N5/8/4K3 w - - 0 1');
  // Con la torre defendida sigue siendo amenaza: caballo (3) por torre (5).
  assert.ok(defended.threats.length > 0);
});

test('cambio de damas: recapturar no cuenta como ganar la dama', () => {
  // Puzzle KRz0m: Qxd6 Rxd6 es dama por dama (y es la jugada clave).
  const fen = '1rb2rk1/4qpb1/p2Qp1pp/2p5/P3PN2/1P2N2P/2P2PP1/1R1R2K1 b - - 0 1';
  const ev = evaluateMove(fen, 'Qxd6');
  assert.ok(ev.exchange === 0, 'cambio igualado');
  assert.ok(!ev.warnings.some((w) => w.includes('dama de d6')), 'no avisa de dama colgada');
  const chess = load(fen);
  const played = chess.move('Qxd6');
  const rxd6 = chess.moves({ verbose: true }).find((m) => m.san === 'Rxd6');
  assert.equal(replyGain(chess, rxd6, played), 0);
});

test('replyGain: la recaptura sí gana si tu captura perdía material', () => {
  // Qxd6 exd6: dama por peón.
  const chess = load('4k3/4p3/3p4/8/8/8/8/3QK3 w - - 0 1');
  const played = chess.move('Qxd6');
  const exd6 = chess.moves({ verbose: true }).find((m) => m.san === 'exd6');
  assert.equal(replyGain(chess, exd6, played), 8);
  const ev = evaluateMove('4k3/4p3/3p4/8/8/8/8/3QK3 w - - 0 1', 'Qxd6');
  assert.ok(ev.warnings.some((w) => w.includes('pierde material en el cambio')));
});
