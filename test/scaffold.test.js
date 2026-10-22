import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SURPRISE_EVERY, emptyScaffold, ladder, planQuestions, readyToPromote, stageOf, updateScaffold } from '../src/scaffold.js';

const answer = (ok, ms = 5000, pointed = true) => ({ ok, ms, pointed });

test('sube de etapa con el 85 % de las 10 últimas, señalando y rápido', () => {
  let s = emptyScaffold();
  for (let i = 0; i < 9; i++) s = updateScaffold(s, { answers: { mate: answer(true) } }).scaffold;
  assert.equal(stageOf(s, 'mate'), 0, 'con 9 respuestas aún no');
  const r = updateScaffold(s, { answers: { mate: answer(true) } });
  assert.equal(stageOf(r.scaffold, 'mate'), 1);
  assert.deepEqual(r.changes, [{ id: 'mate', from: 0, to: 1, reason: 'promote' }]);
});

test('no sube si responde con Sí/No, si falla mucho o si tarda', () => {
  let yesNo = emptyScaffold();
  for (let i = 0; i < 12; i++) yesNo = updateScaffold(yesNo, { answers: { mate: answer(true, 3000, false) } }).scaffold;
  assert.equal(stageOf(yesNo, 'mate'), 0);
  let slow = emptyScaffold();
  for (let i = 0; i < 12; i++) slow = updateScaffold(slow, { answers: { mate: answer(true, 30000) } }).scaffold;
  assert.equal(stageOf(slow, 'mate'), 0);
  assert.equal(readyToPromote({ stage: 0, recent: Array.from({ length: 10 }, (_, i) => answer(i > 1)) }), false, '8 de 10 es menos del 85 %');
  assert.equal(readyToPromote({ stage: 2, recent: Array.from({ length: 10 }, () => answer(true)) }), false, 'no hay etapa por encima');
});

test('baja un escalón si la clave respondía SÍ y no estaba entre tus candidatas', () => {
  const s = { exercises: 3, questions: { amenazadas: { stage: 2, recent: [] }, mate: { stage: 0, recent: [] } } };
  const r = updateScaffold(s, { keyQuestions: ['amenazadas', 'mate'], keyInCandidates: false });
  assert.equal(stageOf(r.scaffold, 'amenazadas'), 1);
  assert.equal(stageOf(r.scaffold, 'mate'), 0);
  assert.deepEqual(r.changes.map((c) => c.reason), ['keyMissed']);
  assert.equal(stageOf(updateScaffold(s, { keyQuestions: ['amenazadas'], keyInCandidates: true }).scaffold, 'amenazadas'), 2);
});

test('reparto por etapas y control sorpresa una vez de cada 5', () => {
  const s = { exercises: 0, questions: { mate: { stage: 1 }, desprotegidas: { stage: 2 } } };
  const ids = ['mate', 'desprotegidas', 'amenazadas'];
  const p = planQuestions(s, ids);
  assert.deepEqual(p, { guided: ['amenazadas'], quick: ['mate'], auto: ['desprotegidas'], surprise: null });
  const surprise = planQuestions({ ...s, exercises: SURPRISE_EVERY - 1 }, ids);
  assert.ok(surprise.surprise);
  assert.ok(surprise.guided.includes(surprise.surprise));
  assert.deepEqual(planQuestions(s, ids, { enabled: false }).guided, ids, 'desactivado: todas guiadas');
});

test('escalera para Estadísticas', () => {
  const s = updateScaffold(emptyScaffold(), { answers: { mate: answer(true, 4000) } }).scaffold;
  const [row] = ladder(s, ['mate']);
  assert.equal(row.stage, 0);
  assert.equal(row.pointed, 1);
  assert.equal(row.accuracy, 1);
  assert.equal(row.avgMs, 4000);
});
