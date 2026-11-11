// Calidad de tus decisiones: cada jugada que juegas se puntúa por la
// probabilidad de ganar que pierde frente a la mejor del motor (en puntos
// porcentuales; 0 si es la mejor). Funciones puras; se guarda en stats.decisions.
import { winChance } from './engine.js';

/** Hasta esta pérdida la jugada vale como buena (igual que «Buena» en la clasificación). */
export const GOOD_LOSS = 5;
const RECENT = 40;

/** Puntos de probabilidad de ganar que pierde la jugada (puntuaciones desde tu lado). */
export function decisionLoss(bestScore, playedScore) {
  const loss = (winChance(bestScore) - winChance(playedScore)) * 100;
  return Math.max(0, Math.round(loss * 10) / 10);
}

export const emptyDecisions = () => ({ n: 0, lossSum: 0, good: 0, recent: [] });

/** Suma una decisión (sin modificar `block`). */
export function recordDecision(block, loss) {
  const next = structuredClone(block ?? emptyDecisions());
  next.n++;
  next.lossSum += loss;
  if (loss <= GOOD_LOSS) next.good++;
  next.recent = [...next.recent, loss].slice(-RECENT);
  return next;
}

const avg = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);

/**
 * Resumen para Estadísticas: pérdida media total, la de las 20 últimas
 * decisiones y la de las 20 anteriores (para ver la tendencia).
 */
export function decisionSummary(block) {
  if (!block?.n) return null;
  const last = block.recent.slice(-20);
  const before = block.recent.slice(-40, -20);
  return {
    n: block.n,
    avg: block.lossSum / block.n,
    goodRate: block.good / block.n,
    last: avg(last),
    lastN: last.length,
    before: before.length >= 10 ? avg(before) : null,
  };
}
