// Estadísticas por pregunta del método: qué preguntas te cuestan más.
import { BLIND_SPOTS } from './analysis.js';
import { emptyIntuition, intuitionSummary, recordGlance } from './intuition.js';
import { ENDGAME_QUESTIONS, STRATEGIC_QUESTIONS, TACTICAL_QUESTIONS } from './method.js';

export const STATS_VERSION = 1;

/** Todas las preguntas del método con su texto, grupo y si son abiertas. */
export const ALL_QUESTIONS = [
  ...TACTICAL_QUESTIONS.map((q) => ({ ...q, group: 'Táctica' })),
  ...Object.entries(STRATEGIC_QUESTIONS).map(([id, q]) => ({ id, ...q, group: 'Estrategia' })),
  ...Object.entries(ENDGAME_QUESTIONS).map(([id, q]) => ({ id, ...q, group: 'Finales' })),
];

export const emptyStats = () => ({ version: STATS_VERSION, exercises: 0, questions: {}, candidates: { asked: 0, keyFound: 0 }, blindSpots: {}, hints: { exercises: 0, used: 0, needed: 0 } });

const emptyQuestion = () => ({ asked: 0, correct: 0, missed: 0, falseAlarm: 0, unsure: 0, withIdea: 0, key: 0, keyMissed: 0 });
/** Respuestas señalando: proporción encontrada y tiempo (además de los contadores de arriba). */
const emptyPointing = () => ({ n: 0, found: 0, required: 0, falseAlarms: 0, ms: 0 });
/** Últimas respuestas de cada pregunta (para la ayuda que se retira). */
const RECENT = 10;

/** Tipos de fallo de una jugada (ver errors.js). */
export const ERROR_KINDS = ['orden', 'casilla', 'colgada', 'profilaxis', 'otra'];
/** De dónde salió la jugada clave por primera vez (ver timeline.js). */
export const KEY_SOURCES = ['intuicion', 'candidatas', 'preguntas', 'nunca'];

/**
 * Suma un ejercicio terminado a las estadísticas (sin modificar `stats`).
 * @param answers  { [id]: { user: true|false|null, result: { yes } } }
 * @param notes    { [id]: string } ideas escritas en las preguntas abiertas
 * @param keyQuestions ids de preguntas a las que responde SÍ la jugada clave
 * @param keyInCandidates true/false si se usó la técnica de candidatas, null si no
 * @param blind     tipos de "punto ciego" de la jugada clave (ver BLIND_SPOTS)
 * @param hintsUsed pistas pedidas en el ejercicio
 */
export function recordExercise(stats, { answers = {}, notes = {}, keyQuestions = [], keyInCandidates = null, blind = [], hintsUsed = 0, glance = null, errors = [], keySource = null, predictions = null }) {
  const next = { ...emptyStats(), ...structuredClone(stats ?? emptyStats()) };
  next.blindSpots ??= {};
  next.hints ??= { exercises: 0, used: 0, needed: 0 };
  // Golpe de vista: { confidence, correct, kase }.
  if (glance?.confidence) next.intuition = recordGlance(next.intuition ?? emptyIntuition(), glance);
  // Tipos de fallo de tus jugadas.
  if (errors.length) {
    next.errors ??= {};
    for (const kind of errors) next.errors[kind] = (next.errors[kind] ?? 0) + 1;
  }
  if (keySource) {
    next.keySources ??= {};
    next.keySources[keySource] = (next.keySources[keySource] ?? 0) + 1;
  }
  if (predictions?.total) {
    next.predictions ??= { total: 0, ok: 0 };
    next.predictions.total += predictions.total;
    next.predictions.ok += predictions.ok;
  }
  // Solo cuentan los ejercicios con preguntas (el modo "sin tiempo" no las tiene).
  if (Object.values(answers).some(Boolean)) next.exercises++;
  const keys = new Set(keyQuestions);
  for (const [id, answer] of Object.entries(answers)) {
    if (!answer) continue;
    const q = (next.questions[id] ??= emptyQuestion());
    const open = ALL_QUESTIONS.find((x) => x.id === id)?.open;
    q.asked++;
    const pointed = answer.pointed;
    if (pointed && !open) {
      // Señalando: acierto solo si se encontró todo lo importante (decir "sí" ya no basta).
      const p = (q.pointing ??= emptyPointing());
      p.n++;
      p.found += pointed.found;
      p.required += pointed.required;
      p.falseAlarms += pointed.falseAlarms;
      p.ms += pointed.ms;
      if (pointed.correct) q.correct++;
      else if (pointed.found < pointed.required) q.missed++;
      else q.falseAlarm++;
    } else if (open) {
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
    // La pregunta señalaba la jugada clave (y de verdad había algo): ¿la viste?
    if (keys.has(id) && answer.result.yes) {
      q.key++;
      const missedKey = pointed ? pointed.found < pointed.required : answer.user !== true;
      if (!open && missedKey) q.keyMissed++;
    }
    if (!open && answer.user !== undefined) {
      const ok = pointed ? pointed.correct : answer.user !== null && answer.user === answer.result.yes;
      q.recent = [...(q.recent ?? []), { ok, ms: pointed?.ms ?? answer.ms ?? null, pointed: Boolean(pointed) }].slice(-RECENT);
    }
  }
  if (keyInCandidates !== null) {
    next.candidates.asked++;
    if (keyInCandidates) next.candidates.keyFound++;
    // Puntos ciegos: qué tipo de jugada clave se te escapa de las candidatas.
    for (const kind of blind) {
      const b = (next.blindSpots[kind] ??= { seen: 0, missed: 0 });
      b.seen++;
      if (!keyInCandidates) b.missed++;
    }
  }
  next.hints.exercises++;
  next.hints.used += hintsUsed;
  if (hintsUsed) next.hints.needed++;
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
      foundRate: s.pointing?.required ? s.pointing.found / s.pointing.required : null,
      avgMs: s.pointing?.n ? s.pointing.ms / s.pointing.n : null,
    };
  });
  rows.sort((a, b) => score(b) - score(a));
  const hardest = rows.filter((r) => !r.open && r.enough && (r.difficulty > 0 || r.keyMissed > 0))[0] ?? null;
  const blindSpots = Object.entries(stats?.blindSpots ?? {})
    .filter(([kind]) => BLIND_SPOTS[kind])
    .map(([kind, b]) => ({ kind, text: BLIND_SPOTS[kind], ...b, rate: b.seen ? b.missed / b.seen : 0 }))
    .sort((a, b) => b.rate - a.rate || b.missed - a.missed);
  const errorTotal = Object.values(stats?.errors ?? {}).reduce((a, b) => a + b, 0);
  const errors = errorTotal
    ? ERROR_KINDS.filter((k) => stats.errors[k]).map((kind) => ({ kind, n: stats.errors[kind], rate: stats.errors[kind] / errorTotal })).sort((a, b) => b.n - a.n)
    : [];
  const sourceTotal = Object.values(stats?.keySources ?? {}).reduce((a, b) => a + b, 0);
  const keySources = sourceTotal ? KEY_SOURCES.map((k) => ({ source: k, n: stats.keySources[k] ?? 0, rate: (stats.keySources[k] ?? 0) / sourceTotal })) : [];
  return {
    rows,
    hardest,
    exercises: stats?.exercises ?? 0,
    candidates: stats?.candidates ?? { asked: 0, keyFound: 0 },
    blindSpots,
    hints: stats?.hints ?? { exercises: 0, used: 0, needed: 0 },
    intuition: intuitionSummary(stats?.intuition),
    errors,
    errorTotal,
    keySources,
    predictions: stats?.predictions ?? null,
  };
}

// Ordena por lo que más importa: no ver la pregunta que llevaba a la solución.
function score(r) {
  if (r.open) return -1;
  return (r.enough ? 1 : 0.5) * ((r.keyMissRate ?? 0) * 2 + (r.difficulty ?? 0));
}
