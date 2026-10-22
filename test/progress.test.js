import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SRS_INTERVALS,
  dueReviews,
  dueText,
  emptyProgress,
  learnedPuzzles,
  recordAttempt,
  srsChange,
  themeGroup,
  themeSummary,
  upcomingReviews,
} from '../src/progress.js';

const DAY = 86400000;
const T0 = Date.UTC(2026, 9, 22, 10);
const puzzle = (id, themes, rating = 1500) => ({ id, rating, themes, fen: '8/8/8/8/8/8/8/K6k w - - 0 1', solution: ['a1a2'] });

test('un fallo entra en el repaso para mañana; un acierto no', () => {
  let p = recordAttempt(emptyProgress(), puzzle('A', ['fork']), { success: false, mistakes: 1, now: T0 });
  p = recordAttempt(p, puzzle('B', ['pin']), { success: true, now: T0 });
  assert.equal(p.puzzles.A.srs.box, 0);
  assert.equal(p.puzzles.A.srs.due, T0 + DAY);
  assert.ok(p.puzzles.A.puzzle, 'guarda el ejercicio para repetirlo');
  assert.equal(p.puzzles.B.srs, null);
  assert.equal(p.puzzles.B.puzzle, null);
  assert.equal(dueReviews(p, T0).length, 0);
  assert.deepEqual(dueReviews(p, T0 + DAY).map((r) => r.id), ['A']);
});

test('acertar cuando toca avanza de caja hasta aprenderlo; fallar reinicia', () => {
  let now = T0;
  let p = recordAttempt(emptyProgress(), puzzle('A', ['fork']), { success: false, now });
  for (let box = 1; box < SRS_INTERVALS.length; box++) {
    now = p.puzzles.A.srs.due;
    const before = p.puzzles.A;
    p = recordAttempt(p, puzzle('A', ['fork']), { success: true, now });
    assert.equal(p.puzzles.A.srs.box, box);
    assert.equal(p.puzzles.A.srs.due, now + SRS_INTERVALS[box] * DAY);
    assert.deepEqual(srsChange(before, p.puzzles.A), { kind: 'advanced', days: SRS_INTERVALS[box], box });
  }
  // Fallar en una caja alta vuelve a la primera.
  const before = p.puzzles.A;
  const failed = recordAttempt(p, puzzle('A', ['fork']), { success: false, now: p.puzzles.A.srs.due });
  assert.equal(failed.puzzles.A.srs.box, 0);
  assert.equal(failed.puzzles.A.srs.lapses, 2);
  assert.equal(srsChange(before, failed.puzzles.A).kind, 'reset');
  // Acertar en la última caja lo da por aprendido y libera el ejercicio guardado.
  now = p.puzzles.A.srs.due;
  const learned = recordAttempt(p, puzzle('A', ['fork']), { success: true, now });
  assert.equal(learned.puzzles.A.srs, null);
  assert.equal(learned.puzzles.A.puzzle, null);
  assert.equal(learnedPuzzles(learned).length, 1);
  assert.equal(srsChange(p.puzzles.A, learned.puzzles.A).kind, 'learned');
});

test('repasar antes de tiempo y acertar no avanza la caja', () => {
  let p = recordAttempt(emptyProgress(), puzzle('A', ['fork']), { success: false, now: T0 });
  const before = p.puzzles.A;
  p = recordAttempt(p, puzzle('A', ['fork']), { success: true, now: T0 + 1000 });
  assert.equal(p.puzzles.A.srs.box, 0);
  assert.equal(p.puzzles.A.srs.due, T0 + DAY);
  assert.equal(srsChange(before, p.puzzles.A).kind, 'early');
  assert.deepEqual(upcomingReviews(p, T0).map((r) => r.id), ['A']);
});

test('no modifica el progreso recibido', () => {
  const p = emptyProgress();
  recordAttempt(p, puzzle('A', ['fork']), { success: false, now: T0 });
  assert.deepEqual(p, emptyProgress());
});

test('temas: separa resueltos y no resueltos por el primer intento', () => {
  let p = emptyProgress();
  p = recordAttempt(p, puzzle('A', ['fork', 'middlegame', 'short']), { success: false, now: T0 });
  p = recordAttempt(p, puzzle('B', ['fork', 'endgame']), { success: true, now: T0 });
  p = recordAttempt(p, puzzle('C', ['pin', 'middlegame']), { success: true, now: T0 });
  // Repetir A y acertar no cambia que el primer intento fue un fallo.
  p = recordAttempt(p, puzzle('A', ['fork', 'middlegame', 'short']), { success: true, now: T0 + DAY });
  const s = themeSummary(p, { minAttempts: 1 });
  const fork = s.groups.find((g) => g.group === 'tactica').themes.find((t) => t.theme === 'fork');
  assert.deepEqual(fork.solved.map((r) => r.id), ['B']);
  assert.deepEqual(fork.failed.map((r) => r.id), ['A']);
  assert.equal(s.total, 3);
  assert.equal(s.solved, 2);
  assert.ok(s.groups.some((g) => g.group === 'longitud'));
});

test('áreas a estudiar: los temas con peor porcentaje y datos suficientes', () => {
  let p = emptyProgress();
  let n = 0;
  const add = (themes, success) => (p = recordAttempt(p, puzzle(`P${n++}`, themes), { success, now: T0 }));
  for (let i = 0; i < 4; i++) add(['pin'], i === 0); // 1/4
  for (let i = 0; i < 4; i++) add(['fork'], i < 3); // 3/4
  for (let i = 0; i < 2; i++) add(['skewer'], false); // 0/2: pocos datos
  for (let i = 0; i < 5; i++) add(['short'], false); // longitud: no es un área a estudiar
  const s = themeSummary(p, { minAttempts: 3 });
  assert.deepEqual(s.weakest.map((t) => t.theme), ['pin', 'fork']);
  assert.deepEqual(s.strongest.map((t) => t.theme), []);
  const s2 = themeSummary(p, { minAttempts: 2 });
  assert.equal(s2.weakest[0].theme, 'skewer');
});

test('grupos de temas', () => {
  assert.equal(themeGroup('fork'), 'tactica');
  assert.equal(themeGroup('mateIn2'), 'mate');
  assert.equal(themeGroup('backRankMate'), 'mate');
  assert.equal(themeGroup('rookEndgame'), 'fase');
  assert.equal(themeGroup('veryLong'), 'longitud');
  assert.equal(themeGroup('crushing'), 'evaluacion');
});

test('dueText', () => {
  assert.equal(dueText(T0 - 1, T0), 'hoy');
  assert.equal(dueText(T0 + DAY, T0), 'mañana');
  assert.equal(dueText(T0 + 3 * DAY, T0), 'en 3 días');
});
