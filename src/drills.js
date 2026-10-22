// Ráfagas de fluidez (2 minutos de una sola pregunta) y ciclos Woodpecker por
// tema (el mismo conjunto de ejercicios, cada vez en la mitad de tiempo).
// Funciones puras: el "ahora" y el azar se pasan como parámetros.
import { Chess } from 'chess.js';

// ------------------------------------------------------------------ ráfagas

export const BURST_SECONDS = 120;
/** Tiempo por posición: empieza en 8 s y se adapta (8 → 6 → 4). */
export const PACES = [8000, 6000, 4000];
/** Aciertos seguidos para subir el ritmo. */
export const PACE_STREAK = 3;

/** Siguiente ritmo: 3 aciertos seguidos lo suben; un fallo lo baja un escalón. */
export function nextPace({ pace = 0, streak = 0 }, ok) {
  if (!ok) return { pace: Math.max(0, pace - 1), streak: 0 };
  const s = streak + 1;
  if (s >= PACE_STREAK && pace < PACES.length - 1) return { pace: pace + 1, streak: 0 };
  return { pace, streak: s };
}

/**
 * Posiciones de una partida (puzzle.gameMoves) para las ráfagas: desde la
 * jugada `from` hasta la posición del ejercicio, con el bando al que le toca.
 */
export function gamePositions(puzzle, { from = 8 } = {}) {
  const chess = new Chess();
  const out = [];
  (puzzle.gameMoves ?? []).forEach((san, i) => {
    try {
      chess.move(san);
    } catch {
      return;
    }
    if (i + 1 >= from) out.push({ fen: chess.fen(), hero: chess.turn(), source: puzzle.id });
  });
  if (puzzle.fen && !out.some((p) => p.fen === puzzle.fen)) out.push({ fen: puzzle.fen, hero: puzzle.heroColor ?? puzzle.fen.split(' ')[1], source: puzzle.id });
  return out;
}

/** Generador pseudoaleatorio reproducible (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(list, random = Math.random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Mitad con respuesta SÍ y mitad NO (alternando), hasta `n` posiciones. */
export function balancePositions(items, n, random = Math.random) {
  const yes = shuffle(items.filter((x) => x.yes), random);
  const no = shuffle(items.filter((x) => !x.yes), random);
  const out = [];
  while (out.length < n && (yes.length || no.length)) {
    const want = out.length % 2 === 0 ? yes : no;
    const other = want === yes ? no : yes;
    out.push((want.length ? want : other).shift());
  }
  return shuffle(out, random);
}

/** Resumen de una ráfaga: posiciones por minuto y acierto. */
export function burstSummary(results, ms) {
  const n = results.length;
  const correct = results.filter((r) => r.ok).length;
  const minutes = Math.max(ms, 1) / 60000;
  return { n, correct, accuracy: n ? correct / n : 0, perMinute: Math.round((n / minutes) * 10) / 10 };
}

/** Guarda la ráfaga en stats.bursts[pregunta] (las 20 últimas) y la compara con la anterior. */
export function recordBurst(stats, qid, summary, now) {
  const next = structuredClone(stats ?? {});
  next.bursts ??= {};
  const list = next.bursts[qid] ?? [];
  const previous = list.at(-1) ?? null;
  next.bursts[qid] = [...list, { at: now, ...summary }].slice(-20);
  return { stats: next, previous };
}

// ---------------------------------------------------------------- Woodpecker

export const WOODPECKER_SIZE = 20;
/** Un patrón está "automatizado" si se resuelve bien en menos de 10 s en dos ciclos seguidos. */
export const AUTOMATED_MS = 10000;

export const newWoodpecker = (theme, now) => ({ theme, ids: [], puzzles: {}, cycles: [{ startedAt: now, results: {} }], createdAt: now });

export const currentCycle = (wp) => wp.cycles.at(-1);
export const cycleNumber = (wp) => wp.cycles.length;

/** Modo de cada ciclo: el primero con el proceso completo; los siguientes, sin tiempo. */
export const cycleMode = (n) => (n <= 1 ? 'tiempo' : 'apuro');

/** Tiempo total del ciclo (ms) según los resultados guardados. */
export const cycleTime = (cycle) => Object.values(cycle.results).reduce((a, r) => a + (r.ms ?? 0), 0);

/** Tiempo objetivo del ciclo n: la mitad que el anterior (el primero no tiene límite). */
export function cycleBudget(wp, n = cycleNumber(wp)) {
  if (n <= 1) return null;
  const prev = wp.cycles[n - 2];
  return prev ? Math.round(cycleTime(prev) / 2) : null;
}

/** El siguiente ejercicio del ciclo actual (id), o null si el ciclo está completo. */
export function nextInCycle(wp) {
  const cycle = currentCycle(wp);
  if (cycleNumber(wp) === 1 && wp.ids.length < WOODPECKER_SIZE) {
    const pending = wp.ids.find((id) => !cycle.results[id]);
    return pending ?? 'nuevo';
  }
  return wp.ids.find((id) => !cycle.results[id]) ?? null;
}

/** Añade un ejercicio al conjunto (solo durante el primer ciclo). */
export function addPuzzle(wp, puzzle) {
  const next = structuredClone(wp);
  if (next.ids.includes(puzzle.id) || next.ids.length >= WOODPECKER_SIZE || cycleNumber(next) > 1) return next;
  next.ids.push(puzzle.id);
  next.puzzles[puzzle.id] = puzzle;
  return next;
}

/** Registra un resultado en el ciclo actual. */
export function recordWoodpecker(wp, id, { ok, ms }) {
  const next = structuredClone(wp);
  currentCycle(next).results[id] = { ok, ms };
  return next;
}

/** Empieza el siguiente ciclo (cuando el actual está completo). */
export function startNextCycle(wp, now) {
  const next = structuredClone(wp);
  next.cycles.push({ startedAt: now, results: {} });
  return next;
}

/** Ids automatizados: bien y en menos de 10 s en dos ciclos seguidos. */
export function automated(wp) {
  return wp.ids.filter((id) => wp.cycles.some((c, i) => {
    const next = wp.cycles[i + 1];
    const fast = (r) => r?.ok && r.ms < AUTOMATED_MS;
    return next && fast(c.results[id]) && fast(next.results[id]);
  }));
}

/** Estado para mostrar: ciclo, hechos, aciertos, tiempos y automatizados. */
export function woodpeckerStatus(wp) {
  const cycle = currentCycle(wp);
  const n = cycleNumber(wp);
  const total = n === 1 ? WOODPECKER_SIZE : wp.ids.length;
  const results = Object.values(cycle.results);
  return {
    theme: wp.theme,
    cycle: n,
    mode: cycleMode(n),
    done: results.length,
    total,
    correct: results.filter((r) => r.ok).length,
    elapsed: cycleTime(cycle),
    budget: cycleBudget(wp, n),
    complete: results.length >= total && total > 0,
    automated: automated(wp).length,
    history: wp.cycles.map((c, i) => ({ cycle: i + 1, done: Object.keys(c.results).length, correct: Object.values(c.results).filter((r) => r.ok).length, ms: cycleTime(c) })),
  };
}
