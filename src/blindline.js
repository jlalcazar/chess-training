// Cálculo a ciegas: introducir una línea entera sin mover el tablero,
// preguntas sobre la posición final (que solo está en la cabeza) y
// comparación con la solución. También la valoración de posiciones finales
// del paso "Calcular". Funciones puras.
import { Chess } from 'chess.js';
import { PIECE_NAMES, forcingSweep, load, material, other, pieceLabel, unprotectedPieces, withTurn } from './analysis.js';

const toMove = (uci) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });

/**
 * Recorre una línea (UCI) desde `startFen`. Devuelve las jugadas con su SAN,
 * quién las juega y la posición final; se para en la primera ilegal.
 */
export function playLine(startFen, ucis) {
  const chess = load(startFen);
  const hero = chess.turn();
  const moves = [];
  for (const uci of ucis) {
    let m;
    try {
      m = chess.move(toMove(uci));
    } catch {
      break;
    }
    moves.push({ uci, san: m.san, by: m.color === hero ? 'you' : 'rival', from: m.from, to: m.to, piece: m.piece });
  }
  return { moves, fen: chess.fen(), mate: chess.isCheckmate(), over: chess.isGameOver() };
}

/**
 * Primera jugada de la línea que se aparta de la solución (índice), o -1 si
 * coincide en todo lo introducido. Un mate en una jugada tuya también vale.
 */
export function firstDeviation(startFen, ucis, solution) {
  const chess = load(startFen);
  for (let i = 0; i < ucis.length; i++) {
    let m;
    try {
      m = chess.move(toMove(ucis[i]));
    } catch {
      return i;
    }
    if (ucis[i] === solution[i]) continue;
    if (i % 2 === 0 && chess.isCheckmate()) return -1;
    return i;
  }
  return -1;
}

/** Puntuación de material de `color` menos la del rival. */
const balance = (chess, color) => {
  const m = material(chess);
  return m[color] - m[other(color)];
};

/**
 * Preguntas sobre la posición final de la línea (2 o 3): dónde está una
 * pieza tuya que se movió, qué pieza rival queda indefensa, cómo va el
 * material y si al rival le queda algún jaque o captura.
 */
export function blindQuestions(startFen, ucis) {
  const start = load(startFen);
  const hero = start.turn();
  const enemy = other(hero);
  const line = playLine(startFen, ucis);
  const final = load(line.fen);
  const out = [];
  // ¿Dónde está la última pieza tuya que se movió?
  const lastMine = [...line.moves].reverse().find((m) => m.by === 'you');
  if (lastMine) {
    const firstFrom = line.moves.find((m) => m.by === 'you' && m.piece === lastMine.piece)?.from ?? lastMine.from;
    out.push({ id: 'donde', kind: 'square', text: `¿Dónde está ahora tu ${PIECE_NAMES[lastMine.piece]} (la que empezó en ${firstFrom})?`, answer: [lastMine.to] });
  }
  // ¿Qué pieza rival queda indefensa? (sin rey; los peones solo si están atacados)
  const loose = unprotectedPieces(final, enemy).map((p) => p.square);
  if (line.moves.length >= 2) out.push({ id: 'indefensa', kind: 'squares', text: '¿Qué pieza rival queda indefensa? (toca la casilla o pulsa «Ninguna»)', answer: loose });
  // Material respecto al inicio.
  const diff = balance(final, hero) - balance(start, hero);
  out.push({ id: 'material', kind: 'choice', text: '¿Cómo va el material respecto a ahora?', options: { ganas: 'Ganas material', igual: 'Igual', pierdes: 'Pierdes material' }, answer: diff > 0 ? 'ganas' : diff < 0 ? 'pierdes' : 'igual', detail: diff });
  // ¿Queda algún jaque o captura para el rival?
  const rivalFen = final.turn() === enemy ? line.fen : withTurn(line.fen, enemy);
  const sweep = line.over ? { checks: [], captures: [] } : forcingSweep(rivalFen);
  out.push({ id: 'pendiente', kind: 'yesno', text: '¿Le queda al rival algún jaque o captura?', answer: sweep.checks.length + sweep.captures.length > 0, detail: `${sweep.checks.length} jaque(s) y ${sweep.captures.length} captura(s)` });
  // Como mucho 3: dónde está la pieza, el material y, alternando, la pieza indefensa o lo pendiente.
  if (out.length <= 3) return out;
  const pick = (id) => out.find((q) => q.id === id);
  return [pick('donde'), pick('material'), ucis.length % 2 ? pick('indefensa') : pick('pendiente')];
}

/** ¿Es correcta la respuesta? Para 'squares', [] significa "ninguna". */
export function gradeBlind(q, answer) {
  if (q.kind === 'square') return q.answer.includes(answer);
  if (q.kind === 'squares') {
    const picked = [...new Set(answer ?? [])];
    if (!q.answer.length) return picked.length === 0;
    return picked.length > 0 && picked.every((sq) => q.answer.includes(sq));
  }
  return q.answer === answer;
}

/**
 * Lo que tiene el rival en un nodo de la línea (le toca mover en `fen`):
 * jaques y capturas, y cuántos de ellos has mirado (`considered`, UCI).
 * Sirve para avisar sin desvelar: "el rival tiene 2 jaques y 1 captura; has mirado 1 de 3".
 */
export function rivalNode(fen, considered = []) {
  const chess = new Chess(fen);
  const moves = chess.moves({ verbose: true });
  const checks = moves.filter((m) => m.san.includes('+') || m.san.includes('#'));
  const captures = moves.filter((m) => m.captured && !checks.includes(m));
  const forcing = new Set([...checks, ...captures].map((m) => m.from + m.to + (m.promotion ?? '')));
  const seen = new Set(considered.filter((u) => forcing.has(u)));
  return { checks: checks.length, captures: captures.length, total: forcing.size, seen: seen.size };
}

/** Valoraciones de una posición final, desde tu punto de vista. */
export const EVAL_SYMBOLS = [
  { id: 2, symbol: '+−', text: 'ganas' },
  { id: 1, symbol: '±', text: 'mejor para ti' },
  { id: 0, symbol: '=', text: 'igualado' },
  { id: -1, symbol: '∓', text: 'mejor para el rival' },
  { id: -2, symbol: '−+', text: 'pierdes' },
];

/** Centipeones (desde tu lado) a la escala de símbolos. */
export function cpToSymbol(cp) {
  if (cp >= 300) return 2;
  if (cp >= 100) return 1;
  if (cp > -100) return 0;
  if (cp > -300) return -1;
  return -2;
}

export const symbolOf = (id) => EVAL_SYMBOLS.find((s) => s.id === id);
