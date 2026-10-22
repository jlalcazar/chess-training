// Modo «¿hay táctica o toca mejorar?»: mezcla puzzles con posiciones sin
// táctica de la misma partida (de 2 a 8 medias jugadas antes del error del
// rival). En un puzzle siempre hay táctica y el jugador lo sabe; aquí tiene
// que decidirlo él. Funciones puras.
import { Chess } from 'chess.js';
import { findForcingIdea, load } from './analysis.js';

const toMove = (uci) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });

/**
 * Posiciones candidatas a "tranquilas" de la partida del puzzle: tras
 * `len - 8` … `len - 2` medias jugadas (el error del rival es la última).
 */
export function quietCandidates(puzzle, { min = 2, max = 8 } = {}) {
  const moves = puzzle.gameMoves ?? [];
  const out = [];
  for (let k = min; k <= max; k++) {
    const plies = moves.length - k;
    if (plies < 2) continue;
    const chess = new Chess();
    let last = null;
    let fenBefore = chess.fen();
    for (const san of moves.slice(0, plies)) {
      fenBefore = chess.fen();
      last = chess.move(san);
    }
    if (chess.isGameOver()) continue;
    out.push({ plies, fen: chess.fen(), fenBefore, lastMove: last && { from: last.from, to: last.to, san: last.san }, heroColor: chess.turn(), gameMoves: moves.slice(0, plies) });
  }
  return out;
}

/** ¿Es una jugada tranquila (sin captura, jaque ni coronación)? */
export function isQuietMove(fen, uci) {
  const chess = load(fen);
  try {
    const m = chess.move(toMove(uci));
    return !m.captured && !m.promotion && !m.san.includes('+') && !m.san.includes('#');
  } catch {
    return false;
  }
}

/**
 * ¿La posición es "de mejorar"? La mejor jugada del motor es tranquila, no
 * hay una ganancia forzada (búsqueda de jaques y capturas), la segunda mejor
 * no está muy lejos y la evaluación no está desequilibrada. `top`: las mejores líneas del motor [{ score, pv }],
 * con la puntuación para quien mueve.
 */
export function isQuietPosition(fen, top, opts) {
  return quietReason(fen, top, opts) === null;
}

/** Por qué una posición no sirve como "tranquila" (null si sirve). */
export function quietReason(fen, top, { maxCp = 300, maxGap = 150 } = {}) {
  const best = top?.[0];
  if (!best?.pv?.length) return 'sin evaluación';
  if (best.score.mate != null) return 'hay mate';
  if (Math.abs(best.score.cp) > maxCp) return 'posición desequilibrada';
  if (!isQuietMove(fen, best.pv[0])) return 'la mejor jugada es forzante';
  // Una única jugada muy superior a las demás suele esconder una táctica (aunque sea tranquila).
  const second = top[1];
  if (second && (second.score.mate != null || best.score.cp - second.score.cp > maxGap)) return 'solo hay una jugada buena';
  if (findForcingIdea(fen, { maxMs: 300 })) return 'hay una ganancia forzada';
  return null;
}

export const emptyMixed = () => ({ tactic: { n: 0, said: 0 }, quiet: { n: 0, said: 0 }, invented: 0, missed: 0, quietMoves: { n: 0, good: 0 } });

/**
 * Registra una posición del modo mezcla: `kind` lo que era ('tactic' o
 * 'quiet'), `declared` lo que dijo el jugador y, en las tranquilas, si su
 * jugada fue buena según el motor.
 */
export function recordMixed(block, { kind, declared, goodMove = null }) {
  const next = structuredClone(block ?? emptyMixed());
  const k = next[kind];
  k.n++;
  if (declared === kind) k.said++;
  if (kind === 'quiet' && declared === 'tactic') next.invented++;
  if (kind === 'tactic' && declared === 'quiet') next.missed++;
  if (kind === 'quiet' && goodMove !== null) {
    next.quietMoves.n++;
    if (goodMove) next.quietMoves.good++;
  }
  return next;
}
