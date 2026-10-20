import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchNextPuzzle, parsePuzzle } from '../src/lichess.js';
import { answerQuestion, questionPlan } from '../src/method.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));

test('reconstruye la posición del puzzle desde el pgn', () => {
  const p = parsePuzzle(fixture('fork-S14en'));
  assert.equal(p.fen.split(' ')[0], '5r1k/ppp2q2/7p/4P1p1/1P1P4/2P3RP/P2Q2K1/8');
  assert.equal(p.heroColor, 'b');
  assert.deepEqual(p.lastMove, { from: 'd3', to: 'd2', san: 'Qd2' });
});

test('el FEN coincide con el que da Lichess cuando lo incluye', () => {
  const data = fixture('mate-85dvN');
  const p = parsePuzzle(data);
  assert.equal(p.fen.split(' ')[0], data.puzzle.fen.split(' ')[0]);
  assert.equal(p.heroColor, 'w');
});

test('todas las preguntas del plan responden sin errores', () => {
  for (const name of ['fork-S14en', 'mate-85dvN']) {
    const p = parsePuzzle(fixture(name));
    for (const level of ['casual', 'intermedio', 'avanzado', 'experto']) {
      const plan = questionPlan(p.fen, level);
      for (const q of [...plan.tactical, ...plan.strategic]) {
        const r = answerQuestion(q.id, p.fen, p.heroColor);
        assert.equal(typeof r.yes, 'boolean', `${name} ${q.id}`);
      }
    }
  }
});

test('fetchNextPuzzle construye la URL con tema y dificultad', async () => {
  let url;
  const fakeFetch = async (u) => {
    url = u;
    return { ok: true, status: 200, json: async () => fixture('fork-S14en') };
  };
  await fetchNextPuzzle({ angle: 'fork', difficulty: 'easier' }, fakeFetch);
  assert.equal(url, 'https://lichess.org/api/puzzle/next?angle=fork&difficulty=easier');
  await fetchNextPuzzle({ angle: 'mix' }, fakeFetch);
  assert.equal(url, 'https://lichess.org/api/puzzle/next');
});

test('un 429 de Lichess da un mensaje claro', async () => {
  const fakeFetch = async () => ({ ok: false, status: 429, statusText: 'Too Many Requests' });
  await assert.rejects(fetchNextPuzzle({}, fakeFetch), /esperar un minuto/);
});
