import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyStats, recordExercise, summarize } from '../src/stats.js';

const yes = (user) => ({ user, result: { yes: true } });
const no = (user) => ({ user, result: { yes: false } });

test('clasifica aciertos, fallos, falsas alarmas y dudas', () => {
  let s = emptyStats();
  s = recordExercise(s, { answers: { mate: yes(true), desprotegidas: yes(false), amenazadas: no(true), geometria: yes(null) } });
  const q = s.questions;
  assert.equal(q.mate.correct, 1);
  assert.equal(q.desprotegidas.missed, 1);
  assert.equal(q.amenazadas.falseAlarm, 1);
  assert.equal(q.geometria.unsure, 1);
  assert.equal(s.exercises, 1);
});

test('no modifica las estadísticas recibidas', () => {
  const s = emptyStats();
  recordExercise(s, { answers: { mate: yes(true) } });
  assert.deepEqual(s, emptyStats());
});

test('las preguntas abiertas no se puntúan, solo cuentan ideas escritas', () => {
  const s = recordExercise(emptyStats(), { answers: { cambios: { user: null, result: { yes: true } } }, notes: { cambios: 'cambiar damas' }, keyQuestions: ['cambios'] });
  assert.deepEqual(
    { asked: s.questions.cambios.asked, withIdea: s.questions.cambios.withIdea, unsure: s.questions.cambios.unsure, keyMissed: s.questions.cambios.keyMissed },
    { asked: 1, withIdea: 1, unsure: 0, keyMissed: 0 },
  );
  assert.equal(summarize(s).rows[0].accuracy, null);
});

test('la pregunta que más cuesta es la que llevaba a la clave y no se vio', () => {
  let s = emptyStats();
  for (let i = 0; i < 3; i++) {
    s = recordExercise(s, {
      answers: { mate: yes(true), geometria: yes(false), desprotegidas: no(true) },
      keyQuestions: ['geometria'],
      keyInCandidates: i === 0,
    });
  }
  const { hardest, rows, candidates } = summarize(s);
  assert.equal(hardest.id, 'geometria');
  assert.equal(rows[0].id, 'geometria');
  assert.equal(hardest.keyMissed, 3);
  assert.deepEqual(candidates, { asked: 3, keyFound: 1 });
});

test('sin datos suficientes no se señala ninguna', () => {
  const s = recordExercise(emptyStats(), { answers: { geometria: yes(false) } });
  assert.equal(summarize(s).hardest, null);
});

test('responder bien "no" no cuenta como clave no vista', () => {
  // La clave da jaque (etiqueta de la pregunta de mate) pero no hay mate: "No" es correcto.
  const s = recordExercise(emptyStats(), { answers: { mate: no(false) }, keyQuestions: ['mate'] });
  assert.equal(s.questions.mate.correct, 1);
  assert.equal(s.questions.mate.key, 0);
  assert.equal(s.questions.mate.keyMissed, 0);
});

test('los ejercicios sin preguntas no cuentan como ejercicios', () => {
  const s = recordExercise(emptyStats(), { answers: {}, keyInCandidates: null });
  assert.equal(s.exercises, 0);
});
