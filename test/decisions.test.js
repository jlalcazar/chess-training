import test from 'node:test';
import assert from 'node:assert/strict';
import { GOOD_LOSS, decisionLoss, decisionSummary, recordDecision } from '../src/decisions.js';

test('decisionLoss: la mejor jugada no pierde nada y nunca es negativa', () => {
  assert.equal(decisionLoss({ cp: 300 }, { cp: 300 }), 0);
  assert.equal(decisionLoss({ cp: 100 }, { cp: 140 }), 0);
});

test('decisionLoss: dos jugadas ganadoras pierden poco; regalar la ventaja, mucho', () => {
  assert.ok(decisionLoss({ cp: 900 }, { cp: 800 }) <= GOOD_LOSS);
  assert.ok(decisionLoss({ cp: 500 }, { cp: 0 }) > 30);
  assert.equal(decisionLoss({ mate: 2 }, { mate: -1 }), 100);
});

test('recordDecision y decisionSummary: media, buenas y tendencia', () => {
  let b = null;
  for (let i = 0; i < 20; i++) b = recordDecision(b, 20);
  for (let i = 0; i < 20; i++) b = recordDecision(b, 0);
  const s = decisionSummary(b);
  assert.equal(s.n, 40);
  assert.equal(s.avg, 10);
  assert.equal(s.goodRate, 0.5);
  assert.equal(s.last, 0);
  assert.equal(s.before, 20);
  assert.equal(decisionSummary(null), null);
});

test('recordDecision no modifica el bloque original', () => {
  const a = recordDecision(null, 3);
  const b = recordDecision(a, 50);
  assert.equal(a.n, 1);
  assert.equal(b.n, 2);
  assert.equal(b.good, 1);
});
