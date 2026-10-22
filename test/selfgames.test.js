import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyOwnMistake, fetchUserGames, gameExercises, parseNdjson, selfSummary, userColor } from '../src/selfgames.js';
import { load } from '../src/analysis.js';

const text = readFileSync(new URL('./fixtures/own-game.ndjson', import.meta.url), 'utf8');

test('lee ndjson y reconoce el color del usuario', () => {
  const games = parseNdjson(`${text}\nbasura\n`);
  assert.equal(games.length, 2);
  assert.equal(userColor(games[0], 'Tester'), 'w');
  assert.equal(userColor(games[1], 'tester'), null);
});

test('convierte tus errores en ejercicios jugables', () => {
  const [game, other] = parseNdjson(text);
  const ex = gameExercises(game, 'tester');
  assert.deepEqual(ex.map((e) => e.id), ['abcd1234-6', 'abcd1234-8', 'abcd1234-12']);
  const first = ex[0];
  assert.equal(first.heroColor, 'w');
  assert.equal(first.solution[0], 'f3d4', 'la mejor según Lichess');
  assert.equal(first.solution.length % 2, 1, 'acaba con una jugada tuya');
  assert.ok(first.themes.includes('misPartidas') && first.themes.includes('propiaError'));
  assert.equal(first.lastMove.san, 'Nd4');
  // La solución es legal desde la posición.
  const chess = load(first.fen);
  for (const u of first.solution) chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
  assert.equal(gameExercises(other, 'tester').length, 0);
});

test('clasifica el error con las 5 preguntas de autoevaluación', () => {
  const [game] = parseNdjson(text);
  const [first, second] = gameExercises(game, 'tester');
  // Nxe5?? en lugar de Nxd4: cambio de piezas (caballo por caballo).
  assert.ok(first.themes.includes('propiaCambios'), JSON.stringify(first.themes));
  // Nxf7?? con la dama negra atacando g2: profilaxis.
  assert.ok(second.themes.includes('propiaProfilaxis'), JSON.stringify(second.themes));
  assert.ok(classifyOwnMistake('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'a2a3', ['e2e4']).includes('propiaPeones'));
  const summary = selfSummary(gameExercises(game, 'tester'));
  assert.equal(summary.length, 5);
});

test('fetchUserGames pide ndjson y avisa si no hay usuario', async () => {
  let asked;
  const ok = await fetchUserGames('tester', {}, async (url, opts) => {
    asked = { url, accept: opts.headers.Accept };
    return { ok: true, status: 200, text: async () => text };
  });
  assert.equal(ok.length, 2);
  assert.match(asked.url, /games\/user\/tester\?max=20&analysed=true&evals=true&pgnInJson=true/);
  assert.equal(asked.accept, 'application/x-ndjson');
  await assert.rejects(fetchUserGames('nadie', {}, async () => ({ ok: false, status: 404 })), /no encuentra/);
});
