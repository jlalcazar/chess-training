// Por qué falló tu jugada: clasifica cada jugada incorrecta antes de avisar.
// Idea correcta en orden equivocado, buena pieza en mala casilla, ignorar una
// idea forzada que el rival ya tenía, dejar algo colgado u otra idea.
import { PIECE_NAMES, describeIdea, evaluateMove, findForcingIdea, load, other, pieceLabel, withTurn } from './analysis.js';

export const ERROR_INFO = {
  orden: { label: 'Orden equivocado', advice: 'entrena la «Línea a ciegas»: escribe la línea entera antes de mover' },
  casilla: { label: 'Buena pieza, mala casilla', advice: 'antes de mover, compara las casillas de destino de la pieza' },
  profilaxis: { label: 'Fallo de profilaxis', advice: 'pregúntate siempre «¿qué quiere mi rival?» antes de tu idea' },
  colgada: { label: 'Deja algo colgado', advice: 'usa «¿Qué permite mi jugada?» antes de jugar' },
  otra: { label: 'Otra idea', advice: 'haz el barrido de jaques, capturas y amenazas antes de decidir' },
};

const toMove = (uci) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });

function sanOf(fen, uci) {
  try {
    return load(fen).move(toMove(uci)).san;
  } catch {
    return uci;
  }
}

/**
 * Clasifica la jugada `uci` jugada en `fen` cuando la solución esperaba
 * `solution[ply]`. Devuelve { kind, text } (ver ERROR_INFO).
 */
export function classifyMistake(fen, uci, solution, ply, { maxMs = 250 } = {}) {
  const chess = load(fen);
  const expected = solution[ply];
  const expectedSan = sanOf(fen, expected);
  let played;
  try {
    played = chess.move(toMove(uci));
  } catch {
    return { kind: 'otra', text: '' };
  }
  const after = chess.fen();
  const hero = played.color;
  const rivalIdeaAfter = () => findForcingIdea(after, { maxMs });

  // 1. Orden equivocado: es una de tus jugadas posteriores de la solución.
  const later = solution.findIndex((u, i) => i > ply && (i - ply) % 2 === 0 && u === uci);
  if (later >= 0) {
    const idea = rivalIdeaAfter();
    const replies = chess.moves({ verbose: true });
    const checks = replies.filter((m) => m.san.includes('+'));
    const resource = idea
      ? `jugada ahora, el rival tiene una idea forzada: ${describeIdea(idea, { moves: true })}`
      : checks.length
        ? `jugada ahora, el rival tiene ${checks.length} jaque(s) (${checks.slice(0, 3).map((m) => m.san).join(', ')}) y libertad para defenderse`
        : 'jugada ahora, el rival tiene tiempo para defenderse: la jugada que va antes le quita opciones';
    return { kind: 'orden', text: `${played.san} es buena idea, pero va después: primero ${expectedSan}. ${resource[0].toUpperCase()}${resource.slice(1)}.` };
  }

  // 2. Buena pieza, mala casilla.
  if (expected && uci.slice(0, 2) === expected.slice(0, 2)) {
    const piece = load(fen).get(uci.slice(0, 2));
    return { kind: 'casilla', text: `Moviste la pieza buena (${pieceLabel({ ...piece, square: uci.slice(0, 2) })}) pero a otra casilla: ${expectedSan}, no ${played.san}.` };
  }

  // 3. El rival ya tenía una idea forzada y tu jugada no la impide.
  const before = findForcingIdea(withTurn(fen, other(hero)), { maxMs });
  if (before) {
    const still = rivalIdeaAfter();
    if (still) return { kind: 'profilaxis', text: `El rival ya tenía una idea forzada (${describeIdea(before, { moves: false })}) y ${played.san} no la impide: ${describeIdea(still, { moves: true })}.` };
  }

  // 4. Deja algo colgado.
  const ev = evaluateMove(fen, toMove(uci));
  if (ev?.warnings.length) return { kind: 'colgada', text: `${played.san} ${ev.warnings[0]}.` };

  // 5. Otra idea distinta.
  const piece = PIECE_NAMES[played.piece];
  return { kind: 'otra', text: `${played.san} sigue otra idea (mueves ${['dama', 'torre'].includes(piece) ? 'la' : 'el'} ${piece}); la del ejercicio es más fuerte.` };
}

/** Frase para Estadísticas: "el 40 % de tus fallos son de orden: entrena la Línea a ciegas". */
export function errorAdvice(errors) {
  const top = errors?.[0];
  if (!top) return null;
  return `El ${Math.round(top.rate * 100)} % de tus fallos son «${ERROR_INFO[top.kind].label.toLowerCase()}»: ${ERROR_INFO[top.kind].advice}.`;
}
