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

test('puntos ciegos y pistas', () => {
  let s = emptyStats();
  s = recordExercise(s, { answers: { mate: yes(true) }, keyInCandidates: false, blind: ['sacrificio', 'atras'], hintsUsed: 2 });
  s = recordExercise(s, { answers: { mate: yes(true) }, keyInCandidates: true, blind: ['sacrificio'] });
  const { blindSpots, hints } = summarize(s);
  assert.deepEqual(blindSpots.map((b) => [b.kind, b.missed, b.seen]), [['atras', 1, 1], ['sacrificio', 1, 2]]);
  assert.deepEqual(hints, { exercises: 2, used: 2, needed: 1 });
});

test('estadísticas antiguas sin puntos ciegos se siguen leyendo', () => {
  const old = { version: 1, exercises: 1, questions: {}, candidates: { asked: 0, keyFound: 0 } };
  const s = recordExercise(old, { answers: {}, keyInCandidates: true, blind: ['caballo'] });
  assert.equal(s.blindSpots.caballo.seen, 1);
});

test('responder señalando: decir siempre que sí ya no puntúa como acierto', async () => {
  const { emptyStats, recordExercise, summarize } = await import('../src/stats.js');
  const answers = {
    amenazadas: { user: true, result: { yes: true }, pointed: { found: 1, required: 3, falseAlarms: 0, ms: 9000, correct: false } },
    mate: { user: true, result: { yes: true }, pointed: { found: 1, required: 1, falseAlarms: 0, ms: 4000, correct: true } },
  };
  const s = recordExercise(emptyStats(), { answers, keyQuestions: ['amenazadas'] });
  assert.equal(s.questions.amenazadas.correct, 0);
  assert.equal(s.questions.amenazadas.missed, 1);
  assert.equal(s.questions.amenazadas.keyMissed, 1, 'señalar solo una de tres no cuenta como ver la clave');
  assert.equal(s.questions.mate.correct, 1);
  assert.deepEqual(s.questions.mate.recent, [{ ok: true, ms: 4000, pointed: true }]);
  const row = summarize(s, { minAnswers: 1 }).rows.find((r) => r.id === 'amenazadas');
  assert.ok(Math.abs(row.foundRate - 1 / 3) < 1e-9);
  assert.equal(row.avgMs, 9000);
});

test('estadísticas nuevas: intuición, tipos de fallo, origen de la clave y predicciones', async () => {
  const { emptyStats, recordExercise, summarize } = await import('../src/stats.js');
  let s = recordExercise(emptyStats(), { glance: { confidence: 'segura', correct: true, kase: 'acertoJugo' }, errors: ['orden', 'orden', 'colgada'], keySource: 'intuicion', predictions: { ok: 2, total: 3 } });
  s = recordExercise(s, { errors: ['otra'], keySource: 'nunca' });
  const sum = summarize(s);
  assert.equal(sum.intuition.n, 1);
  assert.equal(sum.errors[0].kind, 'orden');
  assert.equal(sum.errors[0].rate, 0.5);
  assert.equal(sum.keySources.find((k) => k.source === 'intuicion').rate, 0.5);
  assert.deepEqual(sum.predictions, { total: 3, ok: 2 });
});

test('estadísticas antiguas (sin bloques nuevos) siguen funcionando', async () => {
  const { recordExercise, summarize } = await import('../src/stats.js');
  const old = { version: 1, exercises: 2, questions: { mate: { asked: 2, correct: 2, missed: 0, falseAlarm: 0, unsure: 0, withIdea: 0, key: 0, keyMissed: 0 } }, candidates: { asked: 2, keyFound: 1 } };
  const sum = summarize(old);
  assert.equal(sum.intuition, null);
  assert.deepEqual(sum.errors, []);
  const next = recordExercise(old, { answers: { mate: { user: false, result: { yes: false } } } });
  assert.equal(next.questions.mate.correct, 3);
});
