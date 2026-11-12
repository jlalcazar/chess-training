import test from 'node:test';
import assert from 'node:assert/strict';
import { choiceSummary, distractorPool, pickOptions, recordChoice } from '../src/choose.js';

const FEN = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 2 3';

test('distractorPool: forzantes primero, luego las indicadas, sin las excluidas ni repetidas', () => {
  const pool = distractorPool(FEN, ['f3e5'], { first: ['d2d4'], max: 6 });
  assert.deepEqual(pool[0], { uci: 'c4f7', forcing: true }); // Axf7+: jaque y captura
  assert.ok(pool.slice(0, 3).every((x) => x.forcing));
  assert.ok(pool.some((x) => x.uci === 'd2d4'));
  assert.ok(pool.some((x) => !x.forcing));
  assert.ok(!pool.some((x) => x.uci === 'f3e5'));
  assert.equal(new Set(pool.map((x) => x.uci)).size, pool.length);
  assert.ok(pool.length <= 6);
});

test('pickOptions: la mejor, una forzante que pierde y la que menos pierde', () => {
  const graded = [{ uci: 'a', loss: 3 }, { uci: 'b', loss: 40, forcing: true }, { uci: 'c', loss: 12 }, { uci: 'd', loss: 9 }];
  const options = pickOptions({ uci: 'best' }, graded, { random: () => 0.99 });
  assert.equal(options.length, 3);
  assert.deepEqual(options.filter((o) => o.best).map((o) => o.uci), ['best']);
  assert.deepEqual(options.filter((o) => !o.best).map((o) => o.uci).sort(), ['b', 'd']);
  assert.equal(pickOptions({ uci: 'best' }, [{ uci: 'a', loss: 3 }]), null);
});

test('recordChoice y choiceSummary: acierto total y por tipo', () => {
  let b = null;
  b = recordChoice(b, { ok: true, kind: 'tactic' });
  b = recordChoice(b, { ok: false, kind: 'quiet' });
  b = recordChoice(b, { ok: true, kind: 'quiet' });
  const s = choiceSummary(b);
  assert.equal(s.n, 3);
  assert.equal(s.tactic.rate, 1);
  assert.equal(s.quiet.rate, 0.5);
  assert.equal(s.lastN, 3);
  assert.equal(choiceSummary(null), null);
});
