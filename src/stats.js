// Estadísticas por pregunta del método: qué preguntas te cuestan más.
import { ENDGAME_QUESTIONS, STRATEGIC_QUESTIONS, TACTICAL_QUESTIONS } from './method.js';

export const STATS_VERSION = 1;

/** Todas las preguntas del método con su texto, grupo y si son abiertas. */
export const ALL_QUESTIONS = [
  ...TACTICAL_QUESTIONS.map((q) => ({ ...q, group: 'Táctica' })),
  ...Object.entries(STRATEGIC_QUESTIONS).map(([id, q]) => ({ id, ...q, group: 'Estrategia' })),
  ...Object.entries(ENDGAME_QUESTIONS).map(([id, q]) => ({ id, ...q, group: 'Finales' })),
];

export const emptyStats = () => ({ version: STATS_VERSION, exercises: 0, questions: {}, candidates: { asked: 0, keyFound: 0 } });

const emptyQuestion = () => ({ asked: 0, correct: 0, missed: 0, falseAlarm: 0, unsure: 0, withIdea: 0, key: 0, keyMissed: 0 });

/**
 * Suma un ejercicio terminado a las estadísticas (sin modificar `stats`).
 * @param answers  { [id]: { user: true|false|null, result: { yes } } }
 * @param notes    { [id]: string } ideas escritas en las preguntas abiertas
 * @param keyQuestions ids de preguntas a las que responde SÍ la jugada clave
 * @param keyInCandidates true/false si se usó la técnica de candidatas, null si no
 */
export function recordExercise(stats, { answers = {}, notes = {}, keyQuestions = [], keyInCandidates = null }) {
  const next = structuredClone(stats ?? emptyStats());
  next.exercises++;
  const keys = new Set(keyQuestions);
  for (const [id, answer] of Object.entries(answers)) {
    if (!answer) continue;
    const q = (next.questions[id] ??= emptyQuestion());
    const open = ALL_QUESTIONS.find((x) => x.id === id)?.open;
    q.asked++;
    if (open) {
      if (notes[id]?.trim()) q.withIdea++;
    } else if (answer.user === null) {
      q.unsure++;
    } else if (answer.user === answer.result.yes) {
      q.correct++;
    } else if (answer.result.yes) {
      q.missed++;
    } else {
      q.falseAlarm++;
    }
    // La pregunta señalaba la jugada clave: ¿la viste?
    if (keys.has(id)) {
      q.key++;
      if (!open && answer.user !== true) q.keyMissed++;
    }
  }
  if (keyInCandidates !== null) {
    next.candidates.asked++;
    if (keyInCandidates) next.candidates.keyFound++;
  }
  return next;
}

/** Filas listas para mostrar, de la que más cuesta a la que menos. */
export function summarize(stats, { minAnswers = 3 } = {}) {
  const rows = ALL_QUESTIONS.filter((q) => stats?.questions[q.id]?.asked).map((q) => {
    const s = stats.questions[q.id];
    const judged = s.correct + s.missed + s.falseAlarm + s.unsure;
    // Tasa de dificultad: fallos y dudas sobre las respuestas cerradas.
    const difficulty = q.open ? null : judged ? (s.missed + s.falseAlarm + s.unsure) / judged : 0;
    return {
      id: q.id,
      text: q.text,
      group: q.group,
      open: Boolean(q.open),
      ...s,
      accuracy: q.open || !judged ? null : s.correct / judged,
      difficulty,
      keyMissRate: s.key ? s.keyMissed / s.key : null,
      enough: s.asked >= minAnswers,
    };
  });
  rows.sort((a, b) => score(b) - score(a));
  const hardest = rows.filter((r) => !r.open && r.enough && (r.difficulty > 0 || r.keyMissed > 0))[0] ?? null;
  return { rows, hardest, exercises: stats?.exercises ?? 0, candidates: stats?.candidates ?? { asked: 0, keyFound: 0 } };
}

// Ordena por lo que más importa: no ver la pregunta que llevaba a la solución.
function score(r) {
  if (r.open) return -1;
  return (r.enough ? 1 : 0.5) * ((r.keyMissRate ?? 0) * 2 + (r.difficulty ?? 0));
}
