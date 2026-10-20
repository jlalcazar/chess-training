import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StockfishEngine, evaluateMoves, formatScore, parseInfo, pvToSan, toCp, verdict } from '../src/engine.js';

test('parseInfo lee puntuación, profundidad y línea', () => {
  const info = parseInfo('info depth 15 seldepth 20 multipv 1 score cp -34 nodes 1000 nps 5000 pv e2e4 e7e5');
  assert.deepEqual(info, { depth: 15, multipv: 1, score: { cp: -34 }, pv: ['e2e4', 'e7e5'] });
  assert.deepEqual(parseInfo('info depth 9 score mate 3 pv h7h8').score, { mate: 3 });
  assert.equal(parseInfo('info depth 9 score cp 20 lowerbound pv a2a3'), null);
  assert.equal(parseInfo('bestmove e2e4'), null);
});

test('formatScore, toCp y verdict', () => {
  assert.equal(formatScore({ cp: 125 }), '+1.25');
  assert.equal(formatScore({ cp: -50 }), '-0.50');
  assert.equal(formatScore({ mate: 2 }), '#2');
  assert.equal(formatScore({ mate: -1 }), '#-1');
  assert.ok(toCp({ mate: 1 }) > toCp({ mate: 3 }));
  assert.ok(toCp({ mate: 3 }) > toCp({ cp: 2000 }));
  assert.ok(toCp({ mate: -3 }) < toCp({ cp: -2000 }));
  assert.equal(verdict(0).label, 'Mejor');
  assert.equal(verdict(80).label, 'Imprecisión');
  assert.equal(verdict(500).label, 'Error grave');
});

test('pvToSan convierte la línea', () => {
  assert.deepEqual(pvToSan('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', ['e2e4', 'e7e5', 'g1f3']), ['e4', 'e5', 'Nf3']);
});

// Worker falso que responde como Stockfish.
class FakeWorker {
  constructor() {
    this.sent = [];
  }
  postMessage(cmd) {
    this.sent.push(cmd);
    const reply = (line) => queueMicrotask(() => this.onmessage({ data: line }));
    if (cmd === 'uci') reply('uciok');
    else if (cmd === 'isready') reply('readyok');
    else if (cmd.startsWith('go')) {
      const move = cmd.includes('searchmoves') ? cmd.split(' ').at(-1) : 'a1a8';
      reply(`info depth 10 multipv 1 score cp ${move === 'a1a8' ? 300 : -100} pv ${move}`);
      reply(`bestmove ${move}`);
    }
  }
  terminate() {}
}

test('StockfishEngine evalúa la mejor jugada y cada candidata con searchmoves', async () => {
  const engine = new StockfishEngine('sf.js', FakeWorker);
  const fen = '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1';
  const { best, rows } = await evaluateMoves('stockfish', fen, ['a1a8', 'g1f2'], { engine, depth: 10 });
  assert.deepEqual(best.pv, ['a1a8']);
  assert.deepEqual(rows.map((r) => [r.uci, r.score.cp]), [['a1a8', 300], ['g1f2', -100]]);
  assert.ok(engine.worker.sent.includes('go depth 10 searchmoves g1f2'));
});

test('nube de Lichess: usa la raíz, evalúa tras la jugada y gira el signo para negras', async () => {
  const fen = '6k1/5ppp/8/8/8/8/8/r5K1 b - - 0 1';
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    if (calls.length === 1) return { ok: true, status: 200, json: async () => ({ depth: 30, pvs: [{ moves: 'a1a2 g1f1', cp: -500 }] }) };
    if (calls.length === 2) return { ok: true, status: 200, json: async () => ({ depth: 25, pvs: [{ moves: 'g1f1', cp: 40 }] }) };
    return { ok: false, status: 404 };
  };
  const { best, rows } = await evaluateMoves('cloud', fen, ['a1a2', 'g8f8', 'h7h6'], { fetchImpl: fakeFetch });
  assert.deepEqual(best.score, { cp: 500 });
  assert.deepEqual(rows[0], { uci: 'a1a2', score: { cp: 500 }, pv: ['a1a2', 'g1f1'], available: true, via: 'cloud' });
  assert.deepEqual(rows[1].score, { cp: -40 });
  assert.equal(rows[2].available, false);
  assert.equal(rows[0].via, 'cloud');
  assert.match(calls[0], /cloud-eval\?fen=.*&multiPv=5/);
});

test('nube de Lichess: completa con Stockfish lo que no tiene', async () => {
  const engine = new StockfishEngine('sf.js', FakeWorker);
  const fen = '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1';
  const notFound = async () => ({ ok: false, status: 404 });
  const { best, rows } = await evaluateMoves('cloud', fen, ['g1f2'], { engine, fetchImpl: notFound, depth: 10 });
  assert.equal(best.via, 'stockfish');
  assert.deepEqual(rows.map((r) => [r.uci, r.via, r.score.cp]), [['g1f2', 'stockfish', -100]]);
});

test('winChance y describeAdvantage', async () => {
  const { winChance, describeAdvantage } = await import('../src/engine.js');
  assert.equal(winChance({ cp: 0 }), 0.5);
  assert.ok(winChance({ cp: 300 }) > 0.7);
  assert.equal(winChance({ mate: -2 }), 0);
  assert.equal(describeAdvantage({ cp: 20 }), 'posición igualada');
  assert.equal(describeAdvantage({ cp: -400 }), 'ventaja decisiva para el rival');
  assert.equal(describeAdvantage({ mate: 3 }), 'das mate en 3');
});
