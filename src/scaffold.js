// Ayuda que se retira: cada pregunta cerrada del método tiene una etapa.
// Guiada (como siempre) → Rápida (en la tarjeta «Chequeo rápido» de 30 s) →
// Chequeo automático de 30 s. La última no elimina la pregunta: el método
// dice «hazlas igualmente». Funciones puras; se guarda en stats.scaffold.

export const STAGES = [
  { id: 0, label: 'Guiada', text: 'paso a paso, como siempre' },
  { id: 1, label: 'Rápida', text: 'en la tarjeta «Chequeo rápido» de 30 s' },
  { id: 2, label: 'Chequeo automático', text: 'un recordatorio dentro del chequeo de 30 s' },
];

/** Para subir de etapa: el 85 % de las 10 últimas, respondiendo señalando, y por debajo del tiempo límite. */
export const PROMOTION = { window: 10, accuracy: 0.85, maxMs: [20000, 10000] };
/** Una vez de cada 5 ejercicios, una pregunta avanzada vuelve como control sorpresa. */
export const SURPRISE_EVERY = 5;

export const emptyScaffold = () => ({ exercises: 0, questions: {} });

export const stageOf = (scaffold, id) => scaffold?.questions?.[id]?.stage ?? 0;

/** ¿Cumple las condiciones para subir? Solo cuentan las respuestas señalando de la etapa actual. */
export function readyToPromote(entry) {
  if (!entry || entry.stage >= STAGES.length - 1) return false;
  const pointed = (entry.recent ?? []).filter((r) => r.pointed).slice(-PROMOTION.window);
  if (pointed.length < PROMOTION.window) return false;
  const ok = pointed.filter((r) => r.ok).length / pointed.length;
  const times = pointed.map((r) => r.ms).filter((ms) => ms != null);
  const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : Infinity;
  return ok >= PROMOTION.accuracy && avg <= PROMOTION.maxMs[entry.stage];
}

/** Progreso hacia la siguiente etapa (para la escalera de Estadísticas). */
export function ladder(scaffold, ids) {
  return ids.map((id) => {
    const e = scaffold?.questions?.[id] ?? { stage: 0, recent: [] };
    const pointed = (e.recent ?? []).filter((r) => r.pointed).slice(-PROMOTION.window);
    const times = pointed.map((r) => r.ms).filter((ms) => ms != null);
    return {
      id,
      stage: e.stage ?? 0,
      pointed: pointed.length,
      accuracy: pointed.length ? pointed.filter((r) => r.ok).length / pointed.length : null,
      avgMs: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null,
      lastChange: e.lastChange ?? null,
    };
  });
}

/**
 * Reparte las preguntas de un grupo según su etapa: guiadas, rápidas y de
 * chequeo automático. Cada SURPRISE_EVERY ejercicios, una avanzada vuelve
 * como guiada (control sorpresa), rotando entre ellas.
 */
export function planQuestions(scaffold, ids, { enabled = true } = {}) {
  if (!enabled) return { guided: ids, quick: [], auto: [], surprise: null };
  const advanced = ids.filter((id) => stageOf(scaffold, id) > 0);
  const n = scaffold?.exercises ?? 0;
  const surprise = advanced.length && n % SURPRISE_EVERY === SURPRISE_EVERY - 1 ? advanced[Math.floor(n / SURPRISE_EVERY) % advanced.length] : null;
  return {
    guided: ids.filter((id) => stageOf(scaffold, id) === 0 || id === surprise),
    quick: ids.filter((id) => stageOf(scaffold, id) === 1 && id !== surprise),
    auto: ids.filter((id) => stageOf(scaffold, id) === 2 && id !== surprise),
    surprise,
  };
}

/**
 * Registra un ejercicio: las respuestas ({ id: { ok, ms, pointed } }) suben de
 * etapa a las preguntas que cumplen; si la jugada clave respondía SÍ a una
 * pregunta avanzada (`keyQuestions`) y no estaba entre tus candidatas, esa
 * pregunta baja un escalón. Devuelve { scaffold, changes: [{ id, from, to, reason }] }.
 */
export function updateScaffold(scaffold, { answers = {}, keyQuestions = [], keyInCandidates = null, closed = null, now = 0 }) {
  const next = structuredClone(scaffold ?? emptyScaffold());
  next.questions ??= {};
  next.exercises = (next.exercises ?? 0) + 1;
  const changes = [];
  for (const [id, a] of Object.entries(answers)) {
    if (closed && !closed.includes(id)) continue;
    const e = (next.questions[id] ??= { stage: 0, recent: [] });
    e.recent = [...(e.recent ?? []), { ok: Boolean(a.ok), ms: a.ms ?? null, pointed: Boolean(a.pointed) }].slice(-PROMOTION.window);
    if (readyToPromote(e)) {
      changes.push({ id, from: e.stage, to: e.stage + 1, reason: 'promote' });
      e.stage++;
      e.recent = [];
      e.lastChange = { at: now, to: e.stage, reason: 'promote' };
    }
  }
  if (keyInCandidates === false) {
    for (const id of keyQuestions) {
      const e = next.questions[id];
      if (!e?.stage || changes.some((c) => c.id === id)) continue;
      changes.push({ id, from: e.stage, to: e.stage - 1, reason: 'keyMissed' });
      e.stage--;
      e.recent = [];
      e.lastChange = { at: now, to: e.stage, reason: 'keyMissed' };
    }
  }
  return { scaffold: next, changes };
}
