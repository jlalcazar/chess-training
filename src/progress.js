// Progreso por ejercicio: temas resueltos y no resueltos, y repaso espaciado
// de los ejercicios fallados. Funciones puras (el "ahora" se pasa como
// parámetro) para poder probarlas; main.js las guarda en localStorage.

export const PROGRESS_VERSION = 1;
const DAY = 24 * 60 * 60 * 1000;
/** Intentos que se guardan por ejercicio (el primero siempre se conserva). */
const MAX_ATTEMPTS = 20;

// El repaso va por días de calendario (hora local): lo que toca "mañana" toca
// desde las 00:00, entrenes a la hora que entrenes.
export function startOfDay(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Las 00:00 del día que cae `days` días después de `t` (setDate respeta el cambio de hora). */
export function addDays(t, days) {
  const d = new Date(startOfDay(t));
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** ¿Toca ya? Compara días: también sirve para fechas guardadas con hora exacta. */
const isDue = (srs, now) => startOfDay(srs.due) <= now;

/** Días hasta el siguiente repaso según la caja (Leitner): fallar vuelve a la primera. */
export const SRS_INTERVALS = [1, 3, 7, 14, 30];

export const emptyProgress = () => ({ version: PROGRESS_VERSION, puzzles: {}, legacyIds: [] });

// ---------------------------------------------------------------- temas

/** Grupo de cada tema de Lichess: lo que interesa para estudiar son táctica, mates y fases. */
export function themeGroup(theme) {
  if (theme === 'misPartidas' || theme.startsWith('propia')) return 'propias';
  if (['oneMove', 'short', 'long', 'veryLong'].includes(theme)) return 'longitud';
  if (['crushing', 'advantage', 'equality'].includes(theme)) return 'evaluacion';
  if (['master', 'masterVsMaster', 'superGM', 'playerGames'].includes(theme)) return 'origen';
  if (['opening', 'middlegame', 'endgame'].includes(theme) || theme.endsWith('Endgame')) return 'fase';
  if (theme === 'mate' || theme.startsWith('mateIn') || theme.endsWith('Mate')) return 'mate';
  return 'tactica';
}

export const THEME_GROUPS = {
  propias: 'Tus partidas (autoevaluación)',
  tactica: 'Motivos tácticos',
  mate: 'Mates',
  fase: 'Fases de la partida',
  longitud: 'Longitud de la solución',
  evaluacion: 'Tipo de ventaja',
  origen: 'Origen de la partida',
};

/** Grupos que señalan "áreas a estudiar" (los demás solo se muestran). */
const STUDY_GROUPS = ['tactica', 'mate', 'fase', 'propias'];

// --------------------------------------------------------------- intentos

/**
 * Registra el resultado de un ejercicio (sin modificar `progress`).
 * Un ejercicio está "resuelto" si se completó sin errores, sin pistas y sin ver
 * la solución; si no, entra (o vuelve) al repaso espaciado.
 */
export function recordAttempt(progress, puzzle, { success, mistakes = 0, hintsUsed = 0, revealed = false, now, detail = null }) {
  const next = structuredClone(progress ?? emptyProgress());
  next.puzzles ??= {};
  const prev = next.puzzles[puzzle.id];
  const rec = prev ?? { id: puzzle.id, rating: puzzle.rating, themes: puzzle.themes, attempts: [], srs: null, learnedAt: null };
  rec.rating = puzzle.rating;
  rec.themes = puzzle.themes;
  const firstTry = rec.attempts.length === 0;
  const wasDue = Boolean(rec.srs && isDue(rec.srs, now));
  // `detail`: qué paso falló (preguntas, puntos ciegos, tipo de error), para recordarlo en el repaso.
  rec.attempts.push({ at: now, success, mistakes, hintsUsed, revealed, review: !firstTry, ...(detail ? { detail } : {}) });
  // Se acota el historial del ejercicio sin perder el primer intento (es el que cuenta en los temas).
  if (rec.attempts.length > MAX_ATTEMPTS) rec.attempts = [rec.attempts[0], ...rec.attempts.slice(-(MAX_ATTEMPTS - 1))];

  if (rec.srs) {
    // En el repaso: fallar siempre reinicia; acertar solo avanza si ya tocaba
    // (repasar antes de tiempo no cuenta como superar la caja).
    if (!success) rec.srs = { ...rec.srs, box: 0, due: addDays(now, SRS_INTERVALS[0]), lapses: rec.srs.lapses + 1, last: now };
    else if (wasDue) {
      const box = rec.srs.box + 1;
      if (box >= SRS_INTERVALS.length) {
        rec.srs = null;
        rec.learnedAt = now;
      } else {
        rec.srs = { ...rec.srs, box, due: addDays(now, SRS_INTERVALS[box]), reps: rec.srs.reps + 1, last: now };
      }
    }
  } else if (!success) {
    rec.srs = { box: 0, due: addDays(now, SRS_INTERVALS[0]), reps: 0, lapses: 1, added: now, last: now };
    rec.learnedAt = null;
  }
  // El ejercicio completo solo se guarda mientras está en el repaso (para poder repetirlo sin conexión).
  rec.puzzle = rec.srs ? puzzle : null;
  next.puzzles[puzzle.id] = rec;
  return next;
}

/** Qué pasó con el repaso tras registrar un intento (para explicárselo al usuario). */
export function srsChange(before, after) {
  const b = before?.srs ?? null;
  const a = after?.srs ?? null;
  if (!b && a) return { kind: 'added', days: SRS_INTERVALS[0] };
  if (b && !a && after?.learnedAt) return { kind: 'learned' };
  if (b && a && a.box === 0 && a.lapses > b.lapses) return { kind: 'reset', days: SRS_INTERVALS[0] };
  if (b && a && a.box > b.box) return { kind: 'advanced', days: SRS_INTERVALS[a.box], box: a.box };
  if (b && a) return { kind: 'early', due: a.due };
  return null;
}

// ---------------------------------------------------------------- repaso

const inQueue = (progress) => Object.values(progress?.puzzles ?? {}).filter((r) => r.srs && r.puzzle);

/** Ejercicios que tocan hoy (o antes), el más atrasado primero. */
export function dueReviews(progress, now) {
  return inQueue(progress).filter((r) => isDue(r.srs, now)).sort((a, b) => a.srs.due - b.srs.due);
}

/** Ejercicios del repaso que aún no tocan, por fecha. */
export function upcomingReviews(progress, now) {
  return inQueue(progress).filter((r) => !isDue(r.srs, now)).sort((a, b) => a.srs.due - b.srs.due);
}

/** Veces que se ha fallado un ejercicio en total (sobrevive a aprenderlo y volver a fallarlo). */
export const failCount = (rec) => rec.attempts.filter((a) => !a.success).length;

/** Ejercicios hechos antes de que existiera el progreso por temas (no guardaban sus temas). */
export function legacyCount(progress) {
  return (progress?.legacyIds ?? []).filter((id) => !progress.puzzles?.[id]).length;
}

export function learnedPuzzles(progress) {
  return Object.values(progress?.puzzles ?? {}).filter((r) => r.learnedAt).sort((a, b) => b.learnedAt - a.learnedAt);
}

/** "hoy", "mañana", "en 3 días"… por días de calendario. */
export function dueText(due, now) {
  // Math.round absorbe los días de 23 o 25 h del cambio de hora.
  const days = Math.round((startOfDay(due) - startOfDay(now)) / DAY);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'mañana';
  return `en ${days} días`;
}

// ---------------------------------------------------------- resumen por tema

/**
 * Para cada tema: ejercicios resueltos y no resueltos (según el primer
 * intento, que es lo que mide si sabes ver el tema), y las áreas a estudiar:
 * los temas con peor porcentaje (suavizado) y al menos `minAttempts` ejercicios.
 */
export function themeSummary(progress, { minAttempts = 3 } = {}) {
  const themes = new Map();
  for (const rec of Object.values(progress?.puzzles ?? {})) {
    const first = rec.attempts[0];
    if (!first) continue;
    for (const theme of rec.themes ?? []) {
      const t = themes.get(theme) ?? { theme, group: themeGroup(theme), solved: [], failed: [], inReview: 0 };
      (first.success ? t.solved : t.failed).push(rec);
      if (rec.srs) t.inReview++;
      themes.set(theme, t);
    }
  }
  const rows = [...themes.values()].map((t) => {
    const total = t.solved.length + t.failed.length;
    return {
      ...t,
      total,
      rate: total ? t.solved.length / total : 0,
      // Laplace: con pocos ejercicios no se extrapola (1 de 1 no es 100 %).
      smoothed: (t.solved.length + 1) / (total + 2),
      enough: total >= minAttempts,
    };
  });
  const byRate = (a, b) => a.smoothed - b.smoothed || b.total - a.total;
  const studyable = rows.filter((r) => STUDY_GROUPS.includes(r.group) && r.enough);
  const weakest = studyable.filter((r) => r.failed.length).sort(byRate).slice(0, 3);
  // Un punto fuerte lo es por su propio resultado, no por comparación con los demás.
  const strongest = studyable.filter((r) => r.rate >= 0.75 && !weakest.includes(r)).sort((a, b) => -byRate(a, b)).slice(0, 3);
  const groups = Object.keys(THEME_GROUPS)
    .map((group) => ({ group, name: THEME_GROUPS[group], themes: rows.filter((r) => r.group === group).sort(byRate) }))
    .filter((g) => g.themes.length);
  const all = Object.values(progress?.puzzles ?? {}).filter((r) => r.attempts.length);
  return {
    groups,
    weakest,
    strongest,
    anyEnough: studyable.length > 0,
    total: all.length,
    solved: all.filter((r) => r.attempts[0].success).length,
  };
}
