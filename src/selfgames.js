// Tus propias partidas de Lichess: las imprecisiones, errores y errores
// graves (del análisis de Lichess) se convierten en ejercicios que entran en
// Temas y Repaso. Cada error se clasifica con las 5 preguntas de
// autoevaluación del método. Funciones puras salvo fetchUserGames.
import { Chess } from 'chess.js';
import { VALUES, findForcingIdea, load, other, threatenedPieces, toUci, uciToMove, withTurn, worstPieces } from './analysis.js';

const API = 'https://lichess.org/api';

/** Las 5 preguntas de autoevaluación del documento, con su tema propio. */
export const SELF_QUESTIONS = {
  propiaPeones: { label: 'Juego de peones', question: '¿Moví bien los peones (o debí moverlos)?' },
  propiaDamas: { label: 'Transición al final por el cambio de damas', question: '¿Me convenía cambiar (o evitar cambiar) las damas?' },
  propiaCambios: { label: 'Cambios de piezas', question: '¿Hice los cambios de piezas que me convenían?' },
  propiaProfilaxis: { label: 'Pensamiento profiláctico', question: '¿Miré qué quería hacer mi rival?' },
  propiaActivacion: { label: 'Activación de piezas', question: '¿Activé mi peor pieza?' },
};

export const JUDGMENTS = {
  Inaccuracy: { theme: 'propiaImprecision', label: 'Imprecisión' },
  Mistake: { theme: 'propiaError', label: 'Error' },
  Blunder: { theme: 'propiaGrave', label: 'Error grave' },
};

/** Las partidas analizadas del usuario (ndjson). */
export async function fetchUserGames(username, { max = 20 } = {}, fetchImpl = fetch) {
  const url = `${API}/games/user/${encodeURIComponent(username)}?max=${max}&analysed=true&evals=true&pgnInJson=true`;
  const res = await fetchImpl(url, { headers: { Accept: 'application/x-ndjson' } });
  if (res.status === 404) throw new Error(`Lichess no encuentra partidas de «${username}».`);
  if (res.status === 429) throw new Error('Lichess pide esperar un minuto (429).');
  if (!res.ok) throw new Error(`Lichess respondió ${res.status}`);
  return parseNdjson(await res.text());
}

export function parseNdjson(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });
}


/** El color del usuario en la partida, o null si no juega en ella. */
export function userColor(game, username) {
  const id = username.toLowerCase();
  const is = (p) => p?.user?.id === id || p?.user?.name?.toLowerCase() === id;
  if (is(game.players?.white)) return 'w';
  if (is(game.players?.black)) return 'b';
  return null;
}

/** Línea SAN a UCI desde `fen` (se para en la primera jugada que no entiende). */
function sanLineToUci(fen, sans) {
  const chess = load(fen);
  const out = [];
  for (const san of sans) {
    try {
      out.push(toUci(chess.move(san)));
    } catch {
      break;
    }
  }
  return out;
}

/**
 * Clasifica tu error con las 5 preguntas de autoevaluación: juego de peones,
 * transición al final por el cambio de damas, cambios de piezas, profilaxis
 * y activación de piezas. Devuelve los temas (el principal, primero).
 */
export function classifyOwnMistake(fen, playedUci, solution) {
  const chess = load(fen);
  const hero = chess.turn();
  const best = solution[0];
  const tags = [];
  const moveOf = (uci) => {
    const c = load(fen);
    try {
      return c.move(uciToMove(uci));
    } catch {
      return null;
    }
  };
  const played = moveOf(playedUci);
  const bestMove = moveOf(best);
  // Profilaxis: el rival ya tenía algo (idea forzada o pieza tuya que se pierde) y tu jugada no lo atendía.
  const rivalIdea = findForcingIdea(withTurn(fen, other(hero)), { maxMs: 200 });
  const threatened = threatenedPieces(chess, hero).filter((p) => p.type !== 'k');
  if (played && (rivalIdea || threatened.length)) {
    const after = load(fen);
    after.move(uciToMove(playedUci));
    const stillThreat = !after.isGameOver() && (findForcingIdea(after.fen(), { maxMs: 200 }) || threatenedPieces(after, hero).some((p) => p.type !== 'k' && threatened.some((t) => t.type === p.type)));
    if (stillThreat) tags.push('propiaProfilaxis');
  }
  // Cambio de damas: la jugada o la línea buena cambian (o capturan) damas.
  const line = load(fen);
  const queenTrade = solution.some((uci) => {
    try {
      return line.move(uciToMove(uci)).captured === 'q';
    } catch {
      return false;
    }
  }) || played?.captured === 'q';
  if (queenTrade) tags.push('propiaDamas');
  // Cambios de piezas: capturas de piezas de igual valor (no peones).
  const isTrade = (m) => m?.captured && m.captured !== 'p' && VALUES[m.captured] === VALUES[m.piece];
  if (isTrade(played) || isTrade(bestMove)) tags.push('propiaCambios');
  // Juego de peones.
  if (played?.piece === 'p' || bestMove?.piece === 'p') tags.push('propiaPeones');
  // Activación: la buena movía una de tus dos peores piezas.
  const worst = worstPieces(fen, hero).slice(0, 2).map((p) => p.square);
  if (bestMove && worst.includes(bestMove.from)) tags.push('propiaActivacion');
  if (!tags.length) tags.push(bestMove && bestMove.piece !== 'p' && bestMove.piece !== 'k' ? 'propiaActivacion' : 'propiaPeones');
  return [...new Set(tags)];
}

/**
 * Convierte una partida analizada en ejercicios: uno por cada imprecisión,
 * error o error grave tuyo. La solución es la línea que propone Lichess
 * (tu jugada, la respuesta y tu siguiente jugada, como mucho).
 */
export function gameExercises(game, username) {
  const color = userColor(game, username);
  if (!color || !game.analysis?.length || !game.moves) return [];
  const sans = game.moves.trim().split(/\s+/);
  const me = color === 'w' ? game.players.white : game.players.black;
  const out = [];
  const chess = new Chess();
  const fens = [chess.fen()];
  const played = [];
  for (const san of sans) {
    try {
      const m = chess.move(san);
      played.push(m);
      fens.push(chess.fen());
    } catch {
      break;
    }
  }
  for (let i = 1; i < played.length; i++) {
    const a = game.analysis[i];
    const judgment = JUDGMENTS[a?.judgment?.name];
    const mine = (i % 2 === 0) === (color === 'w');
    if (!judgment || !mine) continue;
    const fen = fens[i];
    const variation = a.variation ? sanLineToUci(fen, a.variation.split(/\s+/)) : [];
    let solution = variation.length ? variation : a.best ? [a.best] : [];
    if (!solution.length || solution[0] === toUci(played[i])) continue;
    solution = solution.slice(0, Math.min(3, solution.length % 2 ? solution.length : solution.length - 1));
    const prev = played[i - 1];
    const themes = ['misPartidas', judgment.theme, ...classifyOwnMistake(fen, toUci(played[i]), solution)];
    out.push({
      id: `${game.id}-${i}`,
      rating: me?.rating ?? 1500,
      plays: 0,
      themes,
      solution,
      fen,
      fenBefore: fens[i - 1],
      lastMove: { from: prev.from, to: prev.to, san: prev.san },
      heroColor: color,
      gameMoves: sans.slice(0, i),
      players: { white: game.players.white?.user?.name, black: game.players.black?.user?.name },
      puzzleUrl: `https://lichess.org/${game.id}#${i}`,
      gameUrl: `https://lichess.org/${game.id}`,
      own: { played: played[i].san, judgment: judgment.label, comment: a.judgment.comment ?? '', moveNumber: Math.floor(i / 2) + 1 },
    });
  }
  return out;
}

/** Resumen por pregunta de autoevaluación: en qué fallas más en tus partidas. */
export function selfSummary(exercises) {
  const counts = Object.fromEntries(Object.keys(SELF_QUESTIONS).map((k) => [k, 0]));
  for (const ex of exercises) {
    const main = ex.themes.find((t) => SELF_QUESTIONS[t]);
    if (main) counts[main]++;
  }
  return Object.entries(counts).map(([id, n]) => ({ id, n, ...SELF_QUESTIONS[id] })).sort((a, b) => b.n - a.n);
}

export const describeOwn = (ex) => `En tu partida jugaste ${ex.own.moveNumber}${ex.heroColor === 'w' ? '.' : '...'} ${ex.own.played} (${ex.own.judgment.toLowerCase()})`;
