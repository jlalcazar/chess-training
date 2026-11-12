// Modo «Elegir jugada»: la mejor jugada entre dos o tres opciones. Las otras
// son jugadas tentadoras (jaques, capturas, amenazas…) que el motor ha
// comprobado que pierden. Funciones puras; se guarda en stats.choices.
import { forcingSweep, load, toUci } from './analysis.js';

/** Una opción solo vale como distractor si pierde al menos esto (puntos de probabilidad de ganar). */
export const MIN_DISTRACTOR_LOSS = 8;

/**
 * Jugadas que podrían servir de distractor: [{ uci, forcing }]. Primero tres
 * forzantes (jaques, capturas, amenazas: las más tentadoras), después `first`
 * (por ejemplo, las siguientes mejores del motor), el resto de forzantes y,
 * al final, jugadas tranquilas de piezas distintas. Sin `exclude`.
 */
export function distractorPool(fen, exclude = [], { first = [], max = 6 } = {}) {
  const chess = load(fen);
  const skip = new Set(exclude);
  const sweep = forcingSweep(fen);
  const forcing = [...new Set([...sweep.checks, ...sweep.captures, ...sweep.threats].map(toUci))].filter((u) => !skip.has(u));
  const quiet = [];
  const seen = new Set();
  for (const m of chess.moves({ verbose: true })) {
    if (seen.has(m.from)) continue;
    seen.add(m.from);
    quiet.push(toUci(m));
  }
  const out = [];
  for (const uci of [...forcing.slice(0, 3), ...first, ...forcing.slice(3), ...quiet]) {
    if (uci && !skip.has(uci) && !out.some((x) => x.uci === uci)) out.push({ uci, forcing: forcing.includes(uci) });
  }
  return out.slice(0, max);
}

/**
 * Las opciones del ejercicio: la mejor y hasta `n` distractores que pierden
 * de verdad, barajadas. Se prefiere una jugada forzante (la combinación que
 * no funciona) y la que menos pierde (la más difícil de descartar). Null si
 * no hay ningún distractor válido.
 */
export function pickOptions(best, graded, { n = 2, minLoss = MIN_DISTRACTOR_LOSS, random = Math.random } = {}) {
  const valid = graded.filter((g) => g.loss >= minLoss).sort((a, b) => a.loss - b.loss);
  if (!valid.length) return null;
  const tempting = valid.find((g) => g.forcing);
  const wrong = [...new Set([tempting, ...valid].filter(Boolean))].slice(0, n);
  const options = [{ ...best, loss: 0, best: true }, ...wrong.map((g) => ({ ...g, best: false }))];
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return options;
}

export const emptyChoices = () => ({ n: 0, ok: 0, tactic: { n: 0, ok: 0 }, quiet: { n: 0, ok: 0 }, recent: [] });

/** Suma una elección (sin modificar `block`). `kind`: 'tactic' o 'quiet'. */
export function recordChoice(block, { ok, kind }) {
  const next = { ...emptyChoices(), ...structuredClone(block ?? {}) };
  next.n++;
  if (ok) next.ok++;
  next[kind].n++;
  if (ok) next[kind].ok++;
  next.recent = [...next.recent, ok ? 1 : 0].slice(-20);
  return next;
}

/** Resumen para Estadísticas: acierto total, por tipo de posición y en las 20 últimas. */
export function choiceSummary(block) {
  if (!block?.n) return null;
  const rate = (x) => (x.n ? x.ok / x.n : null);
  return { n: block.n, rate: rate(block), tactic: { ...block.tactic, rate: rate(block.tactic) }, quiet: { ...block.quiet, rate: rate(block.quiet) }, last: block.recent.reduce((a, b) => a + b, 0) / block.recent.length, lastN: block.recent.length };
}
