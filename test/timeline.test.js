import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countEvents, fixation, keyFirstSeen, phaseAt, phaseDurations } from '../src/timeline.js';

const tl = [
  { t: 0, type: 'phase', step: 'calma' },
  { t: 30000, type: 'phase', step: 'candidatas' },
  { t: 34000, type: 'candidate', uci: 'e2e4' },
  { t: 40000, type: 'phase', step: 'tactica' },
  { t: 45000, type: 'answer', q: 'mate' },
  { t: 52000, type: 'answer', q: 'amenazadas' },
  { t: 60000, type: 'phase', step: 'decision' },
  { t: 61000, type: 'candidate', uci: 'f7f1' },
  { t: 65000, type: 'phase', step: 'resolver' },
  { t: 66000, type: 'move', uci: 'f7f1', ply: 0, ok: true },
];

test('segundos por fase', () => {
  const d = phaseDurations(tl, 70000);
  assert.deepEqual(d.map((r) => [r.step, r.seconds]), [['calma', 30], ['candidatas', 10], ['tactica', 20], ['decision', 5], ['resolver', 5]]);
  assert.equal(phaseAt(tl, 50000), 'tactica');
});

test('dónde apareció la clave', () => {
  assert.deepEqual(keyFirstSeen(tl, 'f7f1'), { where: 'preguntas', seconds: 61, phase: 'decision', after: 'amenazadas' });
  assert.equal(keyFirstSeen(tl, 'e2e4').where, 'candidatas');
  assert.equal(keyFirstSeen(tl, 'a1a2').where, 'nunca');
  const glance = [{ t: 0, type: 'phase', step: 'vistazo' }, { t: 3000, type: 'candidate', uci: 'f7f1', source: 'intuicion' }];
  assert.equal(keyFirstSeen(glance, 'f7f1').where, 'intuicion');
});

test('aviso de fijación: una sola candidata a los pocos segundos', () => {
  const one = [{ t: 0, type: 'phase', step: 'candidatas' }, { t: 4000, type: 'candidate', uci: 'e2e4' }];
  assert.deepEqual(fixation(one), { seconds: 4, uci: 'e2e4' });
  assert.equal(fixation(tl), null, 'con dos candidatas no hay fijación');
  assert.equal(countEvents(tl).candidates, 2);
});
