// «Tu hilo»: el camino de la jugada clave por el método, en tres eslabones.
// Ver (una pregunta la señalaba y la respondiste bien), apuntar (estaba entre
// tus candidatas) y elegir (fue la que jugaste). Dice dónde se rompió.
// Funciones puras; se guarda en stats.thread.

export const THREAD_STAGES = { ver: 'Ver', apuntar: 'Apuntar', elegir: 'Elegir' };
const WEIGHTS = { ver: 30, apuntar: 40, elegir: 30 };

/**
 * `pointing`: preguntas que señalaban la clave (el análisis respondía SÍ);
 * `seen`: las que tú viste; `noneAt`: las que cerraste con «Ninguna»;
 * `noted`: la clave estaba entre tus candidatas; `chosen`: fue tu jugada.
 * Devuelve cada eslabón (true, false o null si no aplica), dónde se rompió
 * el hilo (`brokeAt`, null si está completo) y una nota de 0 a 100.
 */
export function threadReport({ pointing = [], seen = [], noneAt = [], noted = false, chosen = false }) {
  const stages = { ver: pointing.length ? seen.length > 0 : null, apuntar: Boolean(noted), elegir: Boolean(chosen) };
  let brokeAt = null;
  if (!stages.apuntar) brokeAt = stages.ver === false ? 'ver' : 'apuntar';
  else if (!stages.elegir) brokeAt = 'elegir';
  const used = Object.keys(WEIGHTS).filter((k) => stages[k] !== null);
  const total = used.reduce((a, k) => a + WEIGHTS[k], 0);
  const got = used.reduce((a, k) => a + (stages[k] ? WEIGHTS[k] : 0), 0);
  return { stages, brokeAt, score: Math.round((got / total) * 100), pointing, seen, noneAt };
}

export const emptyThread = () => ({ n: 0, scoreSum: 0, complete: 0, broke: { ver: 0, apuntar: 0, elegir: 0 }, recent: [] });

/** Suma el hilo de un ejercicio (sin modificar `block`). */
export function recordThread(block, report) {
  const next = { ...emptyThread(), ...structuredClone(block ?? {}) };
  next.n++;
  next.scoreSum += report.score;
  if (report.brokeAt) next.broke[report.brokeAt]++;
  else next.complete++;
  next.recent = [...next.recent, report.score].slice(-20);
  return next;
}

/** Resumen para Estadísticas: nota media, las 20 últimas y dónde se rompe más. */
export function threadSummary(block) {
  if (!block?.n) return null;
  const worst = Object.entries(block.broke).sort((a, b) => b[1] - a[1])[0];
  return {
    n: block.n,
    avg: block.scoreSum / block.n,
    last: block.recent.reduce((a, b) => a + b, 0) / block.recent.length,
    lastN: block.recent.length,
    complete: block.complete,
    broke: block.broke,
    worst: worst[1] > 0 ? worst[0] : null,
  };
}
