// Mapa de tu proceso: la línea de tiempo del ejercicio (fases, candidatas,
// respuestas, pistas y jugadas), registrada en silencio, y lo que se deduce
// de ella. Funciones puras: los eventos son { t (ms desde el inicio), type, ... }.

export const PHASE_NAMES = {
  calma: 'Calma',
  cambios: '¿Qué cambió?',
  vistazo: 'Golpe de vista',
  candidatas: 'Candidatas',
  tactica: 'Táctica',
  estrategia: 'Estrategia',
  calculo: 'Calcular',
  decision: 'Decisión',
  permite: '¿Qué permite?',
  resolver: 'Jugar',
  intuicion: 'Intuición',
  comprobacion: 'Comprobar',
};

/** Segundos en cada fase, en el orden en que se recorrieron (sumando repeticiones). */
export function phaseDurations(timeline, end) {
  const phases = timeline.filter((e) => e.type === 'phase');
  const out = [];
  for (let i = 0; i < phases.length; i++) {
    const p = phases[i];
    if (p.step === 'resumen' || p.step === 'remate') continue;
    const until = phases[i + 1]?.t ?? end;
    let row = out.find((r) => r.step === p.step);
    if (!row) out.push((row = { step: p.step, name: PHASE_NAMES[p.step] ?? p.step, ms: 0 }));
    row.ms += Math.max(0, until - p.t);
  }
  return out.map((r) => ({ ...r, seconds: Math.round(r.ms / 1000) }));
}

/** La fase en la que estaba el jugador en el instante `t`. */
export function phaseAt(timeline, t) {
  let step = null;
  for (const e of timeline) {
    if (e.t > t) break;
    if (e.type === 'phase') step = e.step;
  }
  return step;
}

/**
 * Dónde apareció la jugada clave por primera vez: en el golpe de vista o la
 * intuición, al apuntar candidatas (en qué segundo), después de qué pregunta,
 * o nunca. `where`: 'intuicion' | 'candidatas' | 'preguntas' | 'nunca'.
 */
export function keyFirstSeen(timeline, keyUci) {
  const first = timeline.find((e) => (e.type === 'candidate' || (e.type === 'move' && e.ply === 0)) && e.uci === keyUci);
  if (!first) return { where: 'nunca' };
  const seconds = Math.round(first.t / 1000);
  const phase = phaseAt(timeline, first.t);
  if (first.source === 'intuicion' || phase === 'vistazo' || phase === 'intuicion') return { where: 'intuicion', seconds, phase };
  if (phase === 'candidatas' || phase === 'calma' || phase === 'cambios') return { where: 'candidatas', seconds, phase };
  const lastAnswer = [...timeline].reverse().find((e) => e.type === 'answer' && e.t <= first.t);
  return { where: 'preguntas', seconds, phase, after: lastAnswer?.q ?? null };
}

/**
 * Aviso de fijación: una sola candidata apuntada muy pronto (y ninguna más).
 * Devuelve { seconds, uci } o null.
 */
export function fixation(timeline, { maxSeconds = 10 } = {}) {
  const added = timeline.filter((e) => e.type === 'candidate');
  if (added.length !== 1) return null;
  const start = timeline.find((e) => e.type === 'phase' && (e.step === 'vistazo' || e.step === 'candidatas'))?.t ?? 0;
  const seconds = Math.round((added[0].t - start) / 1000);
  return seconds <= maxSeconds ? { seconds, uci: added[0].uci } : null;
}

/** Recuento de eventos para el panel (candidatas añadidas y quitadas, pistas, respuestas). */
export function countEvents(timeline) {
  const count = (type) => timeline.filter((e) => e.type === type).length;
  return { candidates: count('candidate'), removed: count('removeCandidate'), hints: count('hint'), answers: count('answer'), moves: count('move') };
}
