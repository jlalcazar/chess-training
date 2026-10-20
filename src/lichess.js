// Cliente mínimo de la API pública de puzzles de Lichess (no requiere token).
// Docs: https://lichess.org/api#tag/Puzzles
import { Chess } from 'chess.js';

const API = 'https://lichess.org/api';

export const THEMES = {
  mix: 'Mezcla (cualquier tema)',
  mateIn1: 'Mate en 1',
  mateIn2: 'Mate en 2',
  mateIn3: 'Mate en 3',
  fork: 'Ataque doble',
  pin: 'Clavada',
  skewer: 'Enfilada',
  hangingPiece: 'Pieza colgada',
  discoveredAttack: 'Ataque a la descubierta',
  doubleCheck: 'Jaque doble',
  deflection: 'Desviación',
  attraction: 'Atracción',
  sacrifice: 'Sacrificio',
  trappedPiece: 'Pieza atrapada',
  kingsideAttack: 'Ataque en el flanco de rey',
  promotion: 'Coronación',
  advancedPawn: 'Peón avanzado',
  quietMove: 'Jugada tranquila',
  defensiveMove: 'Jugada defensiva',
  opening: 'Apertura',
  middlegame: 'Medio juego',
  endgame: 'Final',
  rookEndgame: 'Final de torres',
  pawnEndgame: 'Final de peones',
};

const EXTRA_THEME_NAMES = {
  short: 'Corto (2 jugadas)',
  long: 'Largo (3 jugadas)',
  veryLong: 'Muy largo',
  oneMove: 'Una jugada',
  crushing: 'Aplastante',
  advantage: 'Ventaja',
  equality: 'Igualdad',
  mate: 'Mate',
  mateIn4: 'Mate en 4',
  mateIn5: 'Mate en 5 o más',
  backRankMate: 'Mate del pasillo',
  smotheredMate: 'Mate de la coz',
  xRayAttack: 'Rayos X',
  interference: 'Interferencia',
  intermezzo: 'Jugada intermedia',
  capturingDefender: 'Eliminar al defensor',
  exposedKing: 'Rey expuesto',
  queensideAttack: 'Ataque en el flanco de dama',
  master: 'Partida de maestro',
  queenEndgame: 'Final de damas',
  bishopEndgame: 'Final de alfiles',
  knightEndgame: 'Final de caballos',
  queenRookEndgame: 'Final de dama y torre',
  zugzwang: 'Zugzwang',
  enPassant: 'Captura al paso',
  castling: 'Enroque',
  underPromotion: 'Subpromoción',
  clearance: 'Despeje',
  anastasiaMate: 'Mate de Anastasia',
  arabianMate: 'Mate árabe',
  bodenMate: 'Mate de Boden',
  hookMate: 'Mate del gancho',
  dovetailMate: 'Mate de la cola de milano',
  operaMate: 'Mate de la ópera',
  doubleBishopMate: 'Mate de los dos alfiles',
  killBoxMate: 'Mate de la caja',
  vukovicMate: 'Mate de Vukovic',
  balestraMate: 'Mate de Balestra',
  blindSwineMate: 'Mate de los cerdos ciegos',
  cornerMate: 'Mate en la esquina',
  triangleMate: 'Mate del triángulo',
  attackingF2F7: 'Ataque a f2/f7',
  collinearMove: 'Jugada colineal',
};

export const themeName = (t) => THEMES[t] ?? EXTRA_THEME_NAMES[t] ?? t;

export const DIFFICULTIES = {
  easiest: 'Muy fácil',
  easier: 'Fácil',
  normal: 'Normal',
  harder: 'Difícil',
  hardest: 'Muy difícil',
};

export class LichessError extends Error {}

async function getJson(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  if (res.status === 429) throw new LichessError('Lichess pide esperar un minuto antes de pedir más ejercicios (429).');
  if (!res.ok) throw new LichessError(`Lichess respondió ${res.status} ${res.statusText}`);
  return res.json();
}

/** Siguiente puzzle anónimo. `angle` es un tema de Lichess ("fork", "mateIn2"...). */
export async function fetchNextPuzzle({ angle, difficulty } = {}, fetchImpl = fetch) {
  const params = new URLSearchParams();
  if (angle && angle !== 'mix') params.set('angle', angle);
  if (difficulty) params.set('difficulty', difficulty);
  const query = params.toString();
  return parsePuzzle(await getJson(`${API}/puzzle/next${query ? `?${query}` : ''}`, fetchImpl));
}

export async function fetchPuzzleById(id, fetchImpl = fetch) {
  return parsePuzzle(await getJson(`${API}/puzzle/${encodeURIComponent(id)}`, fetchImpl));
}

export async function fetchDailyPuzzle(fetchImpl = fetch) {
  return parsePuzzle(await getJson(`${API}/puzzle/daily`, fetchImpl));
}

/**
 * Convierte la respuesta de Lichess en la posición del ejercicio. La partida (pgn)
 * acaba con la jugada del rival; desde ahí juega quien resuelve.
 */
export function parsePuzzle(data) {
  const { game, puzzle } = data;
  const chess = new Chess();
  const sans = game.pgn.trim().split(/\s+/).filter((t) => !/^\d+\.+$/.test(t));
  let last = null;
  let fenBefore = chess.fen();
  for (const san of sans) {
    fenBefore = chess.fen();
    last = chess.move(san);
  }
  const fen = chess.fen();
  if (puzzle.fen && puzzle.fen.split(' ').slice(0, 2).join(' ') !== fen.split(' ').slice(0, 2).join(' ')) {
    console.warn('[lichess] El FEN reconstruido no coincide con el de Lichess', { fen, lichess: puzzle.fen });
  }
  const first = puzzle.solution[0];
  const check = new Chess(fen);
  try {
    check.move({ from: first.slice(0, 2), to: first.slice(2, 4), promotion: first[4] });
  } catch {
    throw new LichessError(`La solución ${first} no es legal en la posición reconstruida (${fen}).`);
  }
  const white = game.players.find((p) => p.color === 'white');
  const black = game.players.find((p) => p.color === 'black');
  return {
    id: puzzle.id,
    rating: puzzle.rating,
    plays: puzzle.plays,
    themes: puzzle.themes,
    solution: puzzle.solution,
    fen,
    fenBefore,
    lastMove: last && { from: last.from, to: last.to, san: last.san },
    heroColor: chess.turn(),
    players: { white: white && `${white.name} (${white.rating})`, black: black && `${black.name} (${black.rating})` },
    puzzleUrl: `https://lichess.org/training/${puzzle.id}`,
    gameUrl: `https://lichess.org/${game.id}`,
  };
}
