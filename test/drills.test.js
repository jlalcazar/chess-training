import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePuzzle } from '../src/lichess.js';
import {
  PACES,
  WOODPECKER_SIZE,
  addPuzzle,
  automated,
  balancePositions,
  burstSummary,
  cycleBudget,
  cycleMode,
  gamePositions,
  newWoodpecker,
  nextInCycle,
  nextPace,
  recordBurst,
  recordWoodpecker,
  rng,
  startNextCycle,
  woodpeckerStatus,
} from '../src/drills.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));

test('ritmo de la ráfaga: 8 s, luego 6 s, luego 4 s', () => {
  let p = { pace: 0, streak: 0 };
  for (let i = 0; i < 3; i++) p = nextPace(p, true);
  assert.equal(PACES[p.pace], 6000);
  for (let i = 0; i < 3; i++) p = nextPace(p, true);
  assert.equal(PACES[p.pace], 4000);
  p = nextPace(p, true);
  assert.equal(p.pace, 2, 'no pasa del más rápido');
  p = nextPace(p, false);
  assert.deepEqual(p, { pace: 1, streak: 0 });
});

test('posiciones de la partida del puzzle', () => {
  const puzzle = parsePuzzle(fixture('fork-S14en'));
  const list = gamePositions(puzzle);
  assert.ok(list.length > 50);
  assert.equal(list.at(-1).fen, puzzle.fen);
  assert.ok(list.every((p) => p.hero === p.fen.split(' ')[1]));
});

test('mitad sí y mitad no', () => {
  const items = [...Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, yes: true })), ...Array.from({ length: 3 }, (_, i) => ({ id: `n${i}`, yes: false }))];
  const out = balancePositions(items, 6, rng(1));
  assert.equal(out.length, 6);
  assert.equal(out.filter((x) => !x.yes).length, 3);
  const few = balancePositions(items, 12, rng(2));
  assert.equal(few.length, 12, 'si faltan de un tipo, se completa con el otro');
});

test('resumen y comparación de ráfagas', () => {
  const s = burstSummary([{ ok: true }, { ok: false }, { ok: true }, { ok: true }], 120000);
  assert.deepEqual(s, { n: 4, correct: 3, accuracy: 0.75, perMinute: 2 });
  const first = recordBurst({}, 'mate', s, 1);
  assert.equal(first.previous, null);
  const second = recordBurst(first.stats, 'mate', { ...s, perMinute: 3 }, 2);
  assert.equal(second.previous.perMinute, 2);
  assert.equal(second.stats.bursts.mate.length, 2);
});

test('Woodpecker: ciclos, mitad de tiempo y patrones automatizados', () => {
  let wp = newWoodpecker('fork', 0);
  assert.equal(nextInCycle(wp), 'nuevo', 'el primer ciclo se llena pidiendo ejercicios');
  for (let i = 0; i < WOODPECKER_SIZE; i++) {
    wp = addPuzzle(wp, { id: `p${i}` });
    wp = recordWoodpecker(wp, `p${i}`, { ok: true, ms: i === 0 ? 8000 : 60000 });
  }
  assert.equal(nextInCycle(wp), null);
  assert.equal(woodpeckerStatus(wp).complete, true);
  assert.equal(cycleMode(1), 'tiempo');
  wp = startNextCycle(wp, 1);
  assert.equal(cycleMode(2), 'apuro');
  assert.equal(cycleBudget(wp), (8000 + 19 * 60000) / 2);
  assert.equal(nextInCycle(wp), 'p0');
  wp = recordWoodpecker(wp, 'p0', { ok: true, ms: 5000 });
  wp = recordWoodpecker(wp, 'p1', { ok: true, ms: 5000 });
  assert.deepEqual(automated(wp), ['p0'], 'p1 fue lento en el primer ciclo');
  assert.equal(addPuzzle(wp, { id: 'x' }).ids.length, WOODPECKER_SIZE, 'el conjunto queda fijo tras el primer ciclo');
});
