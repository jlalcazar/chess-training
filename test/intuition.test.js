import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyIntuition, glanceCase, intuitionSummary, recordGlance } from '../src/intuition.js';

test('los cuatro casos del golpe de vista', () => {
  assert.equal(glanceCase({ glance: 'e2e4', played: 'e2e4', key: 'e2e4' }), 'acertoJugo');
  assert.equal(glanceCase({ glance: 'e2e4', played: 'd2d4', key: 'e2e4' }), 'acertoCambio');
  assert.equal(glanceCase({ glance: 'd2d4', played: 'e2e4', key: 'e2e4' }), 'falloCorregido');
  assert.equal(glanceCase({ glance: 'd2d4', played: 'd2d4', key: 'e2e4' }), 'falloJugo');
  assert.equal(glanceCase({ glance: 'd2d4', played: 'c2c4', key: 'e2e4' }), 'otra');
  assert.equal(glanceCase({ glance: null, played: 'c2c4', key: 'e2e4' }), null);
  assert.equal(glanceCase({ glance: 'a1a8', played: 'a1a8', key: 'h1h8', glanceMates: true }), 'acertoJugo');
});

test('Brier y acierto por seguridad', () => {
  let b = emptyIntuition();
  b = recordGlance(b, { confidence: 'segura', correct: true, kase: 'acertoJugo' });
  b = recordGlance(b, { confidence: 'segura', correct: false, kase: 'falloJugo' });
  b = recordGlance(b, { confidence: 'corazonada', correct: false });
  const s = intuitionSummary(b);
  assert.equal(s.n, 3);
  // (0.9-1)^2 + (0.9-0)^2 + (0.35-0)^2 = 0.01 + 0.81 + 0.1225
  assert.ok(Math.abs(s.brier - 0.9425 / 3) < 1e-9);
  assert.equal(s.rows.find((r) => r.id === 'segura').rate, 0.5);
  assert.equal(s.rows.find((r) => r.id === 'probable').rate, null);
  assert.equal(s.cases.acertoJugo, 1);
  assert.equal(intuitionSummary(emptyIntuition()), null);
  assert.deepEqual(recordGlance(b, { confidence: 'x', correct: true }), b, 'seguridad desconocida no cuenta');
});

test('diagnóstico de exceso de confianza', () => {
  let b = emptyIntuition();
  for (let i = 0; i < 5; i++) b = recordGlance(b, { confidence: 'segura', correct: i === 0 });
  assert.match(intuitionSummary(b).diagnosis, /Exceso de confianza/);
});
