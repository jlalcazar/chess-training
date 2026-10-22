// Análisis heurístico de posiciones (sin motor): responde a las preguntas
// tácticas y estratégicas del método de pensamiento.
import { Chess } from 'chess.js';

export const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
export const PIECE_NAMES = { p: 'peón', n: 'caballo', b: 'alfil', r: 'torre', q: 'dama', k: 'rey' };
export const COLOR_NAMES = { w: 'blancas', b: 'negras' };

const FILES = 'abcdefgh';
const KNIGHT_JUMPS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const ORTHOGONAL = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAGONAL = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
// Máxima movilidad teórica de cada pieza, para normalizar "peor pieza".
const MAX_MOBILITY = { n: 8, b: 13, r: 14, q: 27 };
// Orden decreciente del documento: Caballo-Alfil-Torre-Dama.
const ACTIVATION_PRIORITY = { n: 0, b: 1, r: 2, q: 3 };

export const other = (color) => (color === 'w' ? 'b' : 'w');
export const coords = (sq) => [FILES.indexOf(sq[0]), Number(sq[1]) - 1];
export const toSquare = (f, r) => (f >= 0 && f < 8 && r >= 0 && r < 8 ? FILES[f] + (r + 1) : null);
export const pieceLabel = (p) => `${PIECE_NAMES[p.type]} de ${p.square}`;

/** Devuelve el mismo FEN con el turno cambiado (como si se pasara turno). */
export function withTurn(fen, color) {
  const parts = fen.split(' ');
  parts[1] = color;
  parts[3] = '-';
  return parts.join(' ');
}

/** Crea una partida desde un FEN, o null si el FEN no es válido para chess.js. */
export function load(fen) {
  try {
    return new Chess(fen);
  } catch {
    return null;
  }
}

export function allPieces(chess) {
  const out = [];
  for (const row of chess.board()) for (const p of row) if (p) out.push(p);
  return out;
}

const defenders = (chess, sq, color) => chess.attackers(sq, color);

// ------------------------------------------- SEE (Static Exchange Evaluation)

/** La pieza de menos valor de `color` que ataca `sq` (el rey, la última). */
function cheapestAttacker(chess, sq, color) {
  let best = null;
  for (const from of chess.attackers(sq, color)) {
    const p = chess.get(from);
    if (!best || VALUES[p.type] < VALUES[best.type]) best = { ...p, from };
  }
  return best;
}

/**
 * Cuenta el cambio en `square` si `color` empieza a capturar (algoritmo "swap"):
 * cada bando captura siempre con su pieza de menos valor, las piezas largas que
 * quedan detrás entran en juego (rayos X) y cada bando puede pararse cuando ya
 * no le conviene seguir. `from` fuerza la primera pieza que captura.
 * Devuelve el material que gana `color` (0 si no le conviene capturar).
 * No tiene en cuenta clavadas ni jaques: es un recuento estático.
 */
export function see(chess, square, color, { from } = {}) {
  const target = chess.get(square);
  if (!target || target.color === color) return 0;
  const board = new Chess(chess.fen(), { skipValidation: true });
  const gain = [];
  let depth = 0;
  let side = color;
  let attacker = from ? { ...board.get(from), from } : cheapestAttacker(board, square, side);
  if (!attacker?.type) return 0;
  gain[0] = VALUES[target.type];
  for (;;) {
    // El rey solo puede capturar si la casilla no queda atacada.
    if (attacker.type === 'k' && board.attackers(square, other(side)).filter((s) => s !== attacker.from).length) {
      if (depth === 0) return 0;
      break;
    }
    board.remove(attacker.from);
    board.remove(square);
    board.put({ type: attacker.type, color: side }, square);
    depth++;
    gain[depth] = VALUES[attacker.type] - gain[depth - 1];
    side = other(side);
    attacker = cheapestAttacker(board, square, side);
    // Poda: ni continuando ni parando puede mejorar el resultado.
    if (!attacker || Math.max(-gain[depth - 1], gain[depth]) < 0) break;
  }
  while (--depth > 0) gain[depth - 1] = -Math.max(-gain[depth - 1], gain[depth]);
  // Con la primera captura forzada (`from`) el resultado puede ser negativo.
  return from ? gain[0] : Math.max(0, gain[0]);
}

/** SEE de una captura concreta (puede ser negativa: la captura pierde material). */
export const seeMove = (chess, move) => see(chess, move.to, chess.get(move.from).color, { from: move.from });

/** Piezas que el rival gana en el cambio (SEE > 0), o el rey en jaque. */
export function threatenedPieces(chess, color) {
  const out = [];
  for (const p of allPieces(chess)) {
    if (p.color !== color) continue;
    const attackers = chess.attackers(p.square, other(color));
    if (!attackers.length) continue;
    if (p.type === 'k') {
      out.push({ ...p, attackers, reason: 'está en jaque' });
      continue;
    }
    const loss = see(chess, p.square, other(color));
    if (loss <= 0) continue;
    const defs = defenders(chess, p.square, color);
    const minAttacker = Math.min(...attackers.map((s) => VALUES[chess.get(s).type]));
    const reason = !defs.length
      ? 'atacada y sin defensa'
      : minAttacker < VALUES[p.type]
        ? 'atacada por una pieza de menos valor'
        : 'pierde material en el cambio';
    out.push({ ...p, attackers, reason, see: loss });
  }
  return out;
}

/** Piezas sin ningún defensor (los peones solo si además están atacados). */
export function unprotectedPieces(chess, color) {
  const out = [];
  for (const p of allPieces(chess)) {
    if (p.color !== color || p.type === 'k') continue;
    if (defenders(chess, p.square, color).length) continue;
    const attacked = chess.attackers(p.square, other(color)).length > 0;
    if (p.type === 'p' && !attacked) continue;
    out.push({ ...p, attacked });
  }
  return out;
}

/** Jugadas de mate en 1 para `color` (si no le toca, se analiza "pasando turno"). */
export function mateInOne(fen, color) {
  const chess = load(withTurn(fen, color));
  if (!chess) return [];
  return chess.moves({ verbose: true }).filter((m) => m.san.endsWith('#'));
}

function squaresAttackedByKnight(sq) {
  const [f, r] = coords(sq);
  return KNIGHT_JUMPS.map(([df, dr]) => toSquare(f + df, r + dr)).filter(Boolean);
}

function squaresAttackedByPawn(sq, color) {
  const [f, r] = coords(sq);
  const dir = color === 'w' ? 1 : -1;
  return [toSquare(f - 1, r + dir), toSquare(f + 1, r + dir)].filter(Boolean);
}

/** ¿Merece la pena atacar esta pieza? Rey, dama, torre o cualquier pieza indefensa. */
function isJuicyTarget(chess, p) {
  if (!p || p.type === 'p') return false;
  if (['k', 'q', 'r'].includes(p.type)) return true;
  return defenders(chess, p.square, p.color).length === 0;
}

/** Saltos de caballo y avances de peón que atacan dos piezas valiosas a la vez. */
export function forks(fen, color) {
  const chess = load(withTurn(fen, color));
  if (!chess) return [];
  const out = [];
  for (const m of chess.moves({ verbose: true })) {
    let attacked;
    if (m.piece === 'n') attacked = squaresAttackedByKnight(m.to);
    else if (m.piece === 'p') attacked = squaresAttackedByPawn(m.to, color);
    else continue;
    const targets = attacked
      .map((sq) => ({ ...chess.get(sq), square: sq }))
      .filter((p) => p.type && p.color !== color && isJuicyTarget(chess, p));
    if (targets.length < 2) continue;
    const safe = chess.attackers(m.to, other(color)).length === 0 || defenders(chess, m.to, color).length > 0;
    out.push({ kind: m.piece === 'n' ? 'caballo' : 'peón', move: m, targets, safe });
  }
  return out;
}

function walk(chess, sq, [df, dr]) {
  const [f, r] = coords(sq);
  const seen = [];
  for (let i = 1; ; i++) {
    const s = toSquare(f + df * i, r + dr * i);
    if (!s) return seen;
    const p = chess.get(s);
    if (p) seen.push({ ...p, square: s });
    if (seen.length === 2) return seen;
  }
}

/**
 * Piezas alineadas: clavadas y enfiladas que ya existen (pieza larga de `color`
 * apuntando a dos piezas rivales en línea) y parejas rivales alineadas que una
 * pieza de `color` del tipo adecuado podría explotar.
 */
export function alignments(chess, color) {
  const pins = [];
  for (const p of allPieces(chess)) {
    if (p.color !== color || !['b', 'r', 'q'].includes(p.type)) continue;
    const dirs = p.type === 'b' ? DIAGONAL : p.type === 'r' ? ORTHOGONAL : [...DIAGONAL, ...ORTHOGONAL];
    for (const dir of dirs) {
      const [first, second] = walk(chess, p.square, dir);
      if (!first || !second || first.color === color || second.color === color) continue;
      if (second.type === 'k' || VALUES[second.type] > VALUES[first.type]) {
        pins.push({ kind: 'clavada', attacker: p, front: first, back: second });
      } else if ((['k', 'q'].includes(first.type) || first.type === 'r') && isJuicyTarget(chess, second)) {
        pins.push({ kind: 'enfilada', attacker: p, front: first, back: second });
      }
    }
  }

  const lines = [];
  const enemy = other(color);
  const mySliders = new Set(allPieces(chess).filter((p) => p.color === color).map((p) => p.type));
  for (const p of allPieces(chess)) {
    if (p.color !== enemy || !isJuicyTarget(chess, p)) continue;
    const dirs = [];
    if (mySliders.has('b') || mySliders.has('q')) dirs.push(...DIAGONAL);
    if (mySliders.has('r') || mySliders.has('q')) dirs.push(...ORTHOGONAL);
    for (const dir of dirs) {
      const [first] = walk(chess, p.square, dir);
      // Solo una dirección de cada par para no duplicar la pareja.
      if (!first || first.color !== enemy || first.type === 'p') continue;
      if (dir[0] < 0 || (dir[0] === 0 && dir[1] < 0)) continue;
      const already = pins.some((x) => [x.front.square, x.back.square].includes(p.square) && [x.front.square, x.back.square].includes(first.square));
      if (!already) lines.push({ a: p, b: first, diagonal: dir[0] !== 0 && dir[1] !== 0 });
    }
  }
  return { pins, lines };
}

/** Evalúa una jugada con las preguntas del método: qué "síes" consigue y qué deja colgado. */
export function evaluateMove(fen, move) {
  const chess = load(fen);
  if (!chess) return null;
  const color = chess.turn();
  const enemy = other(color);
  let m;
  try {
    m = chess.move(move);
  } catch {
    return null;
  }
  const after = chess.fen();
  const tags = [];
  const warnings = [];

  if (m.san.endsWith('#')) tags.push({ q: 'mate', text: 'da jaque mate' });
  else if (m.san.includes('+')) tags.push({ q: 'mate', text: 'da jaque' });
  let exchange = null;
  if (m.captured) {
    const before = load(fen);
    const wasDefended = defenders(before, m.to, enemy).length > 0;
    const fem = ['r', 'q'].includes(m.captured);
    // Al paso la casilla de destino está vacía: el recuento no aplica.
    exchange = m.isEnPassant?.() ? VALUES.p : seeMove(before, m);
    if (!wasDefended) tags.push({ q: 'desprotegidas', text: `captura ${fem ? 'la' : 'el'} ${PIECE_NAMES[m.captured]} ${fem ? 'indefensa' : 'indefenso'}` });
    else if (exchange > 0) tags.push({ q: 'amenazadas', text: VALUES[m.captured] > VALUES[m.piece] ? `gana material: ${PIECE_NAMES[m.piece]} por ${PIECE_NAMES[m.captured]}` : `gana material en el cambio (+${exchange})` });
    else if (exchange === 0) tags.push({ q: 'amenazadas', text: `cambia: ${PIECE_NAMES[m.piece]} por ${PIECE_NAMES[m.captured]}` });
    else warnings.push(`la captura pierde material en el cambio (${exchange})`);
  }
  if (m.promotion) tags.push({ q: 'coronar', text: `corona ${PIECE_NAMES[m.promotion]}` });

  // Lo que ataca ahora la pieza movida (como si volviera a mover el mismo bando).
  const mine = load(withTurn(after, color));
  if (mine && !m.san.endsWith('#')) {
    // Amenaza de verdad: capturar con la pieza movida gana material en el cambio.
    const targets = mine
      .moves({ verbose: true, square: m.to })
      .filter((x) => x.captured && x.captured !== 'k')
      .filter((x) => see(mine, x.to, color, { from: m.to }) > 0)
      .map((x) => ({ ...mine.get(x.to), square: x.to }));
    const checks = m.san.includes('+');
    if (targets.length + (checks ? 1 : 0) >= 2) tags.push({ q: 'geometria', text: `ataque doble (${targets.map(pieceLabel).join(', ')}${checks ? ', rey' : ''})` });
    else if (targets.length) tags.push({ q: 'amenazadas', text: `amenaza ${pieceLabel(targets[0])}` });
    const pinsAfter = alignments(mine, color).pins.filter((x) => x.attacker.square === m.to);
    for (const pin of pinsAfter) tags.push({ q: 'geometria', text: `${pin.kind} de ${pieceLabel(pin.front)} contra ${pieceLabel(pin.back)}` });
    const mateThreat = mateInOne(after, color);
    if (mateThreat.length && !m.san.includes('+')) tags.push({ q: 'mate', text: `amenaza mate (${mateThreat[0].san})` });
  }

  // Comprobación de seguridad: ¿qué puede hacer el rival tras la jugada?
  if (!chess.isGameOver()) {
    const enemyMates = chess.moves({ verbose: true }).filter((x) => x.san.endsWith('#'));
    if (enemyMates.length) warnings.push(`permite mate: ${enemyMates[0].san}`);
    // Solo lo que la jugada deja colgado: los peligros que ya existían no cuentan.
    const before = new Set(threatenedPieces(load(fen), color).map((p) => p.square));
    for (const p of threatenedPieces(chess, color)) {
      if (p.type === 'k' || (before.has(p.square) && p.square !== m.to)) continue;
      warnings.push(`deja ${pieceLabel(p)} ${p.reason}`);
    }
  }

  const yes = new Set(tags.map((t) => t.q));
  return { move: m, san: m.san, uci: m.from + m.to + (m.promotion ?? ''), tags, warnings, yesCount: yes.size, mate: m.san.endsWith('#'), exchange };
}

// ----------------------------- Estrategia -----------------------------

export function pawnStructure(chess, color) {
  const pawns = allPieces(chess).filter((p) => p.type === 'p');
  const own = pawns.filter((p) => p.color === color);
  const theirs = pawns.filter((p) => p.color !== color);
  const fileCount = new Map();
  for (const p of own) fileCount.set(p.square[0], (fileCount.get(p.square[0]) ?? 0) + 1);
  const isolated = [];
  const doubled = [];
  const passed = [];
  const dir = color === 'w' ? 1 : -1;
  for (const p of own) {
    const [f, r] = coords(p.square);
    const neighbours = [FILES[f - 1], FILES[f + 1]].filter(Boolean);
    if (!neighbours.some((file) => fileCount.has(file))) isolated.push(p);
    if (fileCount.get(p.square[0]) > 1) doubled.push(p);
    const blocked = theirs.some((t) => {
      const [tf, tr] = coords(t.square);
      return Math.abs(tf - f) <= 1 && (tr - r) * dir > 0;
    });
    if (!blocked) passed.push(p);
  }
  return { isolated, doubled, passed };
}

/** Escudo de peones delante del rey (0-3) y si el rey sigue en el centro. */
export function kingSafety(chess, color) {
  const king = allPieces(chess).find((p) => p.type === 'k' && p.color === color);
  if (!king) return null;
  const [f, r] = coords(king.square);
  const dir = color === 'w' ? 1 : -1;
  let shield = 0;
  for (const df of [-1, 0, 1]) {
    const hasPawn = [1, 2].some((dr) => {
      const sq = toSquare(f + df, r + dr * dir);
      const p = sq && chess.get(sq);
      return p && p.type === 'p' && p.color === color;
    });
    if (hasPawn) shield++;
  }
  return { square: king.square, shield, central: f >= 3 && f <= 4 };
}

/** Piezas ordenadas de peor a mejor según movilidad, con prioridad C-A-T-D. */
export function worstPieces(fen, color) {
  const chess = load(withTurn(fen, color));
  if (!chess) return [];
  return allPieces(chess)
    .filter((p) => p.color === color && MAX_MOBILITY[p.type])
    .map((p) => {
      const mobility = chess.moves({ square: p.square }).length;
      return { ...p, mobility, ratio: mobility / MAX_MOBILITY[p.type] };
    })
    .sort((a, b) => a.ratio - b.ratio || ACTIVATION_PRIORITY[a.type] - ACTIVATION_PRIORITY[b.type]);
}

export function material(chess) {
  const sum = { w: 0, b: 0 };
  const nonPawn = { w: 0, b: 0 };
  let queens = 0;
  for (const p of allPieces(chess)) {
    if (p.type === 'k') continue;
    sum[p.color] += VALUES[p.type];
    if (p.type !== 'p') nonPawn[p.color] += VALUES[p.type];
    if (p.type === 'q') queens++;
  }
  return { ...sum, nonPawn, queens };
}

export function isEndgame(chess) {
  const m = material(chess);
  return m.queens === 0 || (m.nonPawn.w <= 13 && m.nonPawn.b <= 13);
}

// --------------------------------------- ¿Qué ha cambiado con la jugada?

/** Casillas con pieza que ataca la pieza de `sq` (según chess.attackers). */
function attackedBy(chess, sq) {
  const p = chess.get(sq);
  if (!p) return [];
  return allPieces(chess).filter((x) => x.square !== sq && chess.attackers(x.square, p.color).includes(sq)).map((x) => x.square);
}

/**
 * Qué cambió con la última jugada (la del rival): qué ataca ahora la pieza
 * que se movió, qué dejó de defender, qué líneas abrió al irse (ataques a la
 * descubierta, de cualquiera de los dos bandos) y qué líneas cortó al llegar.
 */
export function lastMoveDiff(fenBefore, fen, lastMove) {
  const before = load(fenBefore);
  const after = load(fen);
  if (!before || !after || !lastMove) return null;
  const { from, to } = lastMove;
  const moved = after.get(to);
  if (!moved) return null;
  const mover = moved.color;
  const victim = other(mover);
  const piece = (chess, sq) => ({ ...chess.get(sq), square: sq });
  const captured = before.get(to) && before.get(to).color !== mover ? piece(before, to) : null;

  // Ataca ahora (piezas del otro bando que antes no atacaba desde `from`).
  const nowAttacked = attackedBy(after, to).filter((sq) => after.get(sq).color === victim);
  const wasAttacked = new Set(attackedBy(before, from));
  // `wins`: capturarla ganaría material en el cambio (si no, es un ataque sin peligro inmediato).
  const attacks = nowAttacked.filter((sq) => !wasAttacked.has(sq)).map((sq) => ({ ...piece(after, sq), wins: after.get(sq).type === 'k' || see(after, sq, mover) > 0 }));

  // Dejó de defender: piezas propias que defendía desde `from` y ya no desde `to`.
  const defendedBefore = attackedBy(before, from).filter((sq) => before.get(sq).color === mover);
  const defendsNow = new Set(attackedBy(after, to));
  const undefended = defendedBefore
    .filter((sq) => !defendsNow.has(sq) && after.get(sq)?.color === mover)
    .map((sq) => ({ ...piece(after, sq), stillDefended: after.attackers(sq, mover).length > 0 }));

  // Líneas abiertas y cortadas: piezas largas (de los dos bandos) que no se han movido.
  const opened = [];
  const blocked = [];
  for (const s of allPieces(after)) {
    if (!['b', 'r', 'q'].includes(s.type) || s.square === to) continue;
    const prev = before.get(s.square);
    if (!prev || prev.type !== s.type || prev.color !== s.color) continue;
    const nowT = new Set(attackedBy(after, s.square).filter((sq) => after.get(sq).color !== s.color));
    const prevT = new Set(attackedBy(before, s.square).filter((sq) => before.get(sq)?.color !== s.color && sq !== to));
    for (const sq of nowT) if (!prevT.has(sq) && sq !== to && between(s.square, sq).includes(from)) opened.push({ by: piece(after, s.square), target: piece(after, sq) });
    for (const sq of prevT) if (!nowT.has(sq) && after.get(sq) && between(s.square, sq).includes(to)) blocked.push({ by: piece(after, s.square), target: piece(after, sq) });
  }
  return { piece: { ...moved, square: to }, from, to, captured, check: after.inCheck(), attacks, undefended, opened, blocked };
}

/** Casillas estrictamente entre dos casillas en línea recta (vacío si no están alineadas). */
export function between(a, b) {
  const [fa, ra] = coords(a);
  const [fb, rb] = coords(b);
  const df = Math.sign(fb - fa);
  const dr = Math.sign(rb - ra);
  if (!(fa === fb || ra === rb || Math.abs(fb - fa) === Math.abs(rb - ra))) return [];
  const out = [];
  for (let f = fa + df, r = ra + dr; f !== fb || r !== rb; f += df, r += dr) out.push(toSquare(f, r));
  return out;
}

// ------------------------------------------ Mapa de casillas y rutas

const relRank = (sq, color) => (color === 'w' ? Number(sq[1]) : 9 - Number(sq[1]));
const ALL_SQUARES = [...FILES].flatMap((f) => [1, 2, 3, 4, 5, 6, 7, 8].map((r) => f + r));

/**
 * Quién controla cada casilla: número de atacantes de cada bando y el dueño
 * ('w', 'b', 'contested' o null). Con empate de atacantes manda quien ataca
 * con la pieza de menos valor (un peón controla aunque le ataquen dos piezas).
 */
export function squareControl(chess) {
  const out = {};
  for (const sq of ALL_SQUARES) {
    const w = chess.attackers(sq, 'w');
    const b = chess.attackers(sq, 'b');
    const cheapest = (list) => Math.min(...list.map((s) => VALUES[chess.get(s).type]));
    let owner = null;
    if (w.length || b.length) {
      if (!b.length) owner = 'w';
      else if (!w.length) owner = 'b';
      else if (cheapest(w) < cheapest(b)) owner = 'w';
      else if (cheapest(b) < cheapest(w)) owner = 'b';
      else owner = w.length > b.length ? 'w' : b.length > w.length ? 'b' : 'contested';
    }
    out[sq] = { w: w.length, b: b.length, owner };
  }
  return out;
}

/** ¿Puede algún peón de `color` llegar a defender `sq` (está en una columna vecina y por detrás)? */
function pawnCanCover(chess, sq, color) {
  const [f] = coords(sq);
  const r = relRank(sq, color);
  return allPieces(chess).some((p) => p.type === 'p' && p.color === color && Math.abs(coords(p.square)[0] - f) === 1 && relRank(p.square, color) < r);
}

/**
 * Agujeros de `color`: casillas de su campo y del centro (filas 3 a 5 vistas
 * desde su lado) que ningún peón propio puede ya defender. Primero las
 * centrales y las cercanas al rey.
 */
export function holes(chess, color) {
  if (!allPieces(chess).some((p) => p.type === 'p' && p.color === color)) return [];
  const king = allPieces(chess).find((p) => p.type === 'k' && p.color === color);
  const [kf] = king ? coords(king.square) : [4];
  const weight = (sq) => {
    const [f] = coords(sq);
    return Math.abs(f - 3.5) + Math.min(Math.abs(f - kf), 3) - (chess.get(sq)?.color === other(color) ? 2 : 0);
  };
  return ALL_SQUARES.filter((sq) => {
    const r = relRank(sq, color);
    if (r < 3 || r > 5) return false;
    const p = chess.get(sq);
    if (p?.type === 'p' && p.color === color) return false;
    return !pawnCanCover(chess, sq, color);
  }).sort((a, b) => weight(a) - weight(b));
}

/**
 * Puestos avanzados de `color`: casillas en las filas 4 a 6 (desde su lado)
 * defendidas por un peón propio que ningún peón rival puede atacar.
 */
export function outposts(chess, color) {
  return ALL_SQUARES.filter((sq) => {
    const r = relRank(sq, color);
    if (r < 4 || r > 6) return false;
    const p = chess.get(sq);
    if (p && (p.type === 'p' || p.color !== color)) return false;
    const pawnDefended = chess.attackers(sq, color).some((s) => chess.get(s).type === 'p');
    return pawnDefended && !pawnCanCover(chess, sq, other(color));
  });
}

const STEPS = { n: KNIGHT_JUMPS, b: DIAGONAL, r: ORTHOGONAL, q: [...DIAGONAL, ...ORTHOGONAL], k: [...DIAGONAL, ...ORTHOGONAL] };

/** Casillas a las que iría una pieza desde `from` sin mover nada más (pseudolegal). */
function pieceSteps(chess, from, piece) {
  const [f, r] = coords(from);
  const out = [];
  const slides = ['b', 'r', 'q'].includes(piece.type);
  for (const [df, dr] of STEPS[piece.type] ?? []) {
    for (let i = 1; ; i++) {
      const sq = toSquare(f + df * i, r + dr * i);
      if (!sq) break;
      const p = chess.get(sq);
      if (p && p.color === piece.color) break;
      out.push({ sq, capture: Boolean(p) });
      if (p || !slides) break;
    }
  }
  return out;
}

/** ¿Es peligrosa la casilla para esta pieza? Atacada por un peón, por algo de menos valor o sin defensa. */
function dangerousFor(chess, sq, piece) {
  const enemy = other(piece.color);
  const attackers = chess.attackers(sq, enemy);
  if (!attackers.length) return null;
  const cheapest = Math.min(...attackers.map((s) => VALUES[chess.get(s).type]));
  if (cheapest < VALUES[piece.type]) return cheapest === 1 ? 'la ataca un peón' : 'la ataca una pieza de menos valor';
  if (!chess.attackers(sq, piece.color).length) return 'está atacada y sin defensa';
  return null;
}

/**
 * Rutas de una pieza moviendo solo esa pieza (búsqueda en anchura hasta
 * `maxMoves` jugadas). Para cada casilla alcanzable: el camino, el número de
 * tiempos y las casillas peligrosas por las que pasa. `best` son las 3 mejores
 * casillas (actividad desde allí, centralización, puestos avanzados y
 * ataques a piezas rivales, menos el peligro).
 */
export function pieceRoutes(fen, from, { maxMoves = 3, to } = {}) {
  const chess = load(fen);
  const piece = chess?.get(from);
  if (!piece || !STEPS[piece.type]) return { routes: {}, best: [], to: null };
  // Sin la pieza en su casilla, para que no se bloquee a sí misma.
  const board = new Chess(fen, { skipValidation: true });
  board.remove(from);
  const routes = { [from]: { path: [from], moves: 0, dangers: [] } };
  let frontier = [from];
  for (let d = 1; d <= maxMoves && frontier.length; d++) {
    const next = [];
    for (const sq of frontier) {
      for (const step of pieceSteps(board, sq, piece)) {
        if (routes[step.sq]) continue;
        const danger = dangerousFor(board, step.sq, piece);
        const prev = routes[sq];
        routes[step.sq] = { path: [...prev.path, step.sq], moves: d, dangers: danger ? [...prev.dangers, { sq: step.sq, why: danger }] : prev.dangers, capture: step.capture };
        // Una captura termina la ruta: más allá el tablero ya no es el mismo.
        if (!step.capture) next.push(step.sq);
      }
    }
    frontier = next;
  }
  const outs = new Set(outposts(chess, piece.color));
  const score = (sq) => {
    const r = routes[sq];
    const [f, rk] = coords(sq);
    const mobility = pieceSteps(board, sq, piece).length;
    const center = 3.5 - Math.max(Math.abs(f - 3.5), Math.abs(rk - 3.5));
    const hits = pieceSteps(board, sq, piece).filter((s) => s.capture && board.get(s.sq).color !== piece.color).length;
    const ownDanger = dangerousFor(board, sq, piece) ? 4 : 0;
    return mobility + center + (outs.has(sq) ? 3 : 0) + hits * 1.5 - ownDanger - r.moves * 0.5 - r.dangers.length;
  };
  const best = Object.keys(routes)
    .filter((sq) => sq !== from && !routes[sq].capture)
    .map((sq) => ({ sq, ...routes[sq], score: score(sq), outpost: outs.has(sq) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  return { routes, best, to: to ? routes[to] ?? null : null, piece: { ...piece, square: from } };
}

/** Las jugadas más peligrosas del rival si le tocara mover ahora. */
export function rivalIdeas(fen, color, limit = 4) {
  const enemy = other(color);
  const chess = load(withTurn(fen, enemy));
  if (!chess) return [];
  return chess
    .moves({ verbose: true })
    .map((m) => evaluateMove(chess.fen(), m))
    .filter((e) => e && e.tags.length)
    .sort((a, b) => Number(b.mate) - Number(a.mate) || b.yesCount - a.yesCount || b.tags.length - a.tags.length)
    .slice(0, limit);
}

/** Torres en columnas abiertas/semiabiertas y columnas abiertas libres. */
export function rookActivity(chess, color) {
  const pawns = allPieces(chess).filter((p) => p.type === 'p');
  const openFiles = [...FILES].filter((f) => !pawns.some((p) => p.square[0] === f));
  const halfOpen = [...FILES].filter((f) => !openFiles.includes(f) && !pawns.some((p) => p.square[0] === f && p.color === color));
  const rooks = allPieces(chess).filter((p) => p.type === 'r' && p.color === color);
  return {
    openFiles,
    halfOpen,
    rooks: rooks.map((r) => ({ ...r, onOpen: openFiles.includes(r.square[0]), onHalfOpen: halfOpen.includes(r.square[0]) })),
  };
}

/** Capturas que cambian una pieza por otra del mismo valor (no peones). */
export function availableTrades(fen) {
  const chess = load(fen);
  if (!chess) return [];
  return chess
    .moves({ verbose: true })
    .filter((m) => m.captured && m.piece !== 'p' && m.piece !== 'k' && VALUES[m.captured] === VALUES[m.piece]);
}

/** Rupturas de peón: avances que atacan un peón rival. */
export function pawnBreaks(fen, color) {
  const chess = load(withTurn(fen, color));
  if (!chess) return [];
  return chess
    .moves({ verbose: true })
    .filter((m) => m.piece === 'p' && !m.captured)
    .filter((m) => squaresAttackedByPawn(m.to, color).some((s) => {
      const p = chess.get(s);
      return p && p.type === 'p' && p.color !== color;
    }));
}

// --------------------------------------------- Ideas de varias jugadas

const MATE_SCORE = 1000;
const CHECK_EXTENSION = 4;

function materialFor(chess, color) {
  let score = 0;
  for (const row of chess.board()) {
    for (const p of row) {
      if (!p || p.type === 'k') continue;
      score += p.color === color ? VALUES[p.type] : -VALUES[p.type];
    }
  }
  return score;
}

/**
 * Búsqueda táctica de jugadas forzadas: el atacante solo juega jaques, capturas
 * y coronaciones; el defensor responde a todo si está en jaque y, si no, puede
 * capturar o "plantarse" (quiescencia). Puntuación en material para quien mueve.
 */
function forcingSearch(chess, attacker, ply, maxPly, alpha, beta, budget) {
  budget.nodes++;
  if ((budget.nodes & 127) === 0 && Date.now() > budget.deadline) budget.nodes = Infinity;
  const moves = chess.moves({ verbose: true });
  const toMove = chess.turn();
  if (!moves.length) return { score: chess.inCheck() ? -MATE_SCORE + ply : 0, pv: [] };
  const inCheck = chess.inCheck();
  const stand = materialFor(chess, toMove);
  const isAttacker = toMove === attacker;
  // Extensión de jaques: pasada la profundidad, el atacante aún puede seguir dando jaque.
  const extended = ply >= maxPly;
  if (!inCheck) {
    if (stand >= beta || budget.nodes > budget.max || ply >= maxPly + CHECK_EXTENSION || (extended && !isAttacker)) return { score: stand, pv: [] };
    alpha = Math.max(alpha, stand);
  } else if (ply >= maxPly + CHECK_EXTENSION + 1 || budget.nodes > budget.max) {
    return { score: stand, pv: [] };
  }
  const candidates = inCheck
    ? moves
    : moves.filter((m) => (!extended && (m.captured || m.promotion)) || (isAttacker && m.san.includes('+')));
  candidates.sort((a, b) => order(b) - order(a));
  let best = { score: inCheck ? -Infinity : stand, pv: [] };
  for (const m of candidates) {
    chess.move(m);
    const child = forcingSearch(chess, attacker, ply + 1, maxPly, -beta, -alpha, budget);
    chess.undo();
    const score = -child.score;
    if (score > best.score) best = { score, pv: [m, ...child.pv] };
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  return best;
}

function order(m) {
  return (m.san.includes('#') ? 1000 : 0) + (m.san.includes('+') ? 50 : 0) + (m.captured ? 10 * VALUES[m.captured] - VALUES[m.piece] : 0) + (m.promotion ? 80 : 0);
}

/** Qué se consigue en cada paso de la línea (para explicar la idea). */
function describeStep(fen, move) {
  const ev = evaluateMove(fen, move);
  if (!ev) return [];
  const notes = ev.tags.filter((t) => t.text !== 'da jaque').map((t) => t.text);
  // Sacrificio: la pieza queda donde el rival la puede capturar con ventaja.
  if (!ev.move.captured && ev.warnings.some((w) => w.includes(`de ${ev.move.to} `))) notes.unshift('sacrificio');
  if (ev.san.includes('+') && !ev.mate) notes.push('da jaque');
  return notes;
}

/**
 * Busca una idea forzada que empiece con `firstMove` (o con cualquier jaque o
 * captura si no se indica) y gane material o dé mate en varias jugadas.
 * Devuelve { line: [{san, uci, notes, by}], gain, mate } o null.
 */
export function findForcingIdea(fen, { firstMove, maxPly = 7, maxNodes = 40000, maxMs = 400, minGain = 2 } = {}) {
  const chess = load(fen);
  if (!chess) return null;
  const attacker = chess.turn();
  const base = materialFor(chess, attacker);
  const roots = firstMove
    ? chess.moves({ verbose: true }).filter((m) => m.from === firstMove.from && m.to === firstMove.to && (!firstMove.promotion || m.promotion === firstMove.promotion))
    : chess.moves({ verbose: true }).filter((m) => m.captured || m.promotion || m.san.includes('+'));
  roots.sort((a, b) => order(b) - order(a));
  let best = null;
  const budget = { nodes: 0, max: maxNodes, deadline: Date.now() + maxMs };
  for (const m of roots) {
    chess.move(m);
    const child = forcingSearch(chess, attacker, 1, maxPly, -Infinity, Infinity, budget);
    chess.undo();
    const score = -child.score;
    if (!best || score > best.score) best = { score, pv: [m, ...child.pv] };
  }
  if (!best) return null;
  const mate = best.score > MATE_SCORE / 2;
  const gain = mate ? Infinity : best.score - base;
  // Una idea "de varias jugadas" necesita al menos dos jugadas propias.
  if ((!mate && gain < minGain) || best.pv.length < 3) return null;
  return describeLine(fen, best.pv.map((m) => m.from + m.to + (m.promotion ?? '')));
}

/**
 * Explica una línea (UCI) desde `fen`: qué consigue cada jugada propia y el
 * resultado. Recorta las jugadas sobrantes una vez conseguida la ganancia.
 */
export function describeLine(fen, ucis) {
  const chess = load(fen);
  if (!chess) return null;
  const attacker = chess.turn();
  const base = materialFor(chess, attacker);
  const line = [];
  const gains = [];
  for (const uci of ucis) {
    const by = chess.turn() === attacker ? 'you' : 'rival';
    const before = chess.fen();
    let m;
    try {
      m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      break;
    }
    line.push({ san: m.san, uci, notes: by === 'you' ? describeStep(before, uci) : [], by });
    gains.push(materialFor(chess, attacker) - base);
  }
  const mate = chess.isCheckmate() && chess.turn() !== attacker;
  const gain = mate ? Infinity : gains.at(-1) ?? 0;
  if (!mate) {
    // Corta tras la primera jugada propia que ya alcanza la ganancia final.
    const cut = gains.findIndex((g, i) => line[i].by === 'you' && g >= gain);
    if (cut >= 0) line.splice(cut + 1);
  }
  return { line, gain, mate, moves: Math.ceil(line.length / 2) };
}

/** Texto corto de una idea: "Qf1+ (da jaque) Kh2 Rf2+ (…) … → gana 4 puntos de material". */
export function describeIdea(idea, { moves = true } = {}) {
  const result = idea.mate ? 'mate' : `ganas ${idea.gain} punto(s) de material`;
  if (!moves) {
    // Solo el patrón (sin desvelar las jugadas): "da jaque → ataque doble → …".
    const pattern = idea.line.filter((s) => s.by === 'you').map((s) => (s.notes[0] ?? 'jugada tranquila').replace(/ \(.*\)$/, ''));
    return `${pattern.join(' → ')} → ${result}`;
  }
  const steps = idea.line.map((s) => (s.notes.length ? `${s.san} (${s.notes.slice(0, 2).join(', ')})` : s.san)).join(' ');
  return `${steps} → ${result}`;
}

// ------------------------------------- Barrido de jaques, capturas y amenazas

/**
 * Las jugadas "forzantes" de quien mueve en `fen`: jaques, capturas y amenazas
 * (la pieza movida ataca algo que ganaría en el cambio). Es el barrido que
 * conviene hacer antes de cerrar la lista de candidatas.
 */
export function forcingSweep(fen) {
  const chess = load(fen);
  if (!chess) return { checks: [], captures: [], threats: [] };
  const color = chess.turn();
  const checks = [];
  const captures = [];
  const threats = [];
  for (const m of chess.moves({ verbose: true })) {
    if (m.san.includes('+') || m.san.includes('#')) checks.push(m);
    if (m.captured) captures.push(m);
    if (m.san.includes('+') || m.captured) continue;
    chess.move(m);
    const after = load(withTurn(chess.fen(), color));
    chess.undo();
    if (!after) continue;
    const hits = after
      .moves({ verbose: true, square: m.to })
      .filter((x) => x.captured && x.captured !== 'k')
      .filter((x) => see(after, x.to, color, { from: m.to }) > 0);
    if (hits.length) threats.push({ ...m, targets: hits.map((x) => x.to) });
  }
  return { checks, captures, threats };
}

// ------------------------------------------------------------ Puntos ciegos

export const BLIND_SPOTS = {
  sacrificio: 'un sacrificio (la pieza va a una casilla donde la pueden capturar)',
  atras: 'una jugada hacia atrás',
  tranquila: 'una jugada tranquila (sin jaque, captura ni amenaza directa)',
  largo: 'un movimiento largo de alfil, torre o dama (4 casillas o más)',
  caballo: 'una jugada de caballo',
  piezaOlvidada: 'una pieza que ninguna de tus candidatas movía',
};

/**
 * Por qué una jugada puede ser difícil de ver. `candidates` (UCI) permite
 * detectar si movía una pieza que no habías considerado.
 */
export function blindSpots(fen, uci, candidates = []) {
  const chess = load(fen);
  if (!chess) return [];
  const color = chess.turn();
  let m;
  try {
    m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch {
    return [];
  }
  const out = [];
  const enemyAttackers = chess.attackers(m.to, other(color));
  const ownDefenders = chess.attackers(m.to, color);
  const cheapestAttacker = Math.min(...enemyAttackers.map((s) => VALUES[chess.get(s).type]));
  const gain = m.captured ? VALUES[m.captured] : 0;
  if (m.piece !== 'k' && enemyAttackers.length && (!ownDefenders.length || cheapestAttacker < VALUES[m.piece]) && VALUES[m.piece] - gain >= 2) {
    out.push('sacrificio');
  }
  const [, fromRank] = coords(m.from);
  const [, toRank] = coords(m.to);
  if (m.piece !== 'p' && (toRank - fromRank) * (color === 'w' ? 1 : -1) < 0) out.push('atras');
  if (!m.captured && !m.san.includes('+') && !m.promotion) {
    const sweep = forcingSweep(fen);
    if (!sweep.threats.some((t) => t.from === m.from && t.to === m.to)) out.push('tranquila');
  }
  const [ff, fr] = coords(m.from);
  const [tf, tr] = coords(m.to);
  if (['b', 'r', 'q'].includes(m.piece) && Math.max(Math.abs(tf - ff), Math.abs(tr - fr)) >= 4) out.push('largo');
  if (m.piece === 'n') out.push('caballo');
  if (candidates.length && !candidates.some((c) => c.slice(0, 2) === m.from)) out.push('piezaOlvidada');
  return out;
}

// --------------------------------------- Explicación de la línea ganadora

export const MOVE_THEMES = {
  sacrificio: { name: 'Sacrificio', text: 'entregas material a cambio de algo mejor' },
  atraccion: { name: 'Atracción', text: 'obligas a una pieza rival (a menudo el rey) a ir a una casilla mala' },
  desviacion: { name: 'Desviación', text: 'apartas a un defensor de su tarea' },
  eliminarDefensor: { name: 'Eliminar al defensor', text: 'capturas la pieza que defendía otra' },
  ataqueDoble: { name: 'Ataque doble', text: 'una pieza ataca dos objetivos a la vez' },
  clavada: { name: 'Clavada', text: 'una pieza rival no puede moverse sin exponer otra más valiosa' },
  enfilada: { name: 'Enfilada', text: 'atacas una pieza valiosa que, al apartarse, deja otra detrás' },
  jaqueDoble: { name: 'Jaque doble', text: 'dos piezas dan jaque a la vez: solo vale mover el rey' },
  descubierta: { name: 'Ataque a la descubierta', text: 'al mover una pieza, otra que estaba detrás ataca' },
  tranquila: { name: 'Jugada tranquila', text: 'sin jaque ni captura, pero prepara una amenaza imparable' },
  coronacion: { name: 'Coronación', text: 'un peón llega a la última fila' },
  mate: { name: 'Mate', text: 'el rey rival no tiene escapatoria' },
};

function kingSquare(chess, color) {
  return allPieces(chess).find((p) => p.type === 'k' && p.color === color)?.square;
}

/**
 * Explica cada jugada de una línea (UCI) desde `fen`, inspirándose en el
 * etiquetador de temas de lichess-puzzler: qué tema aparece en cada jugada
 * propia y cuántas respuestas tenía el rival en cada jugada suya.
 */
export function explainLine(fen, ucis) {
  const chess = load(fen);
  if (!chess) return [];
  const hero = chess.turn();
  const enemy = other(hero);
  const base = materialFor(chess, hero);
  const plies = [];
  const moves = [];
  for (const uci of ucis) {
    const before = chess.fen();
    const legal = chess.moves().length;
    let m;
    try {
      m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      break;
    }
    moves.push({ m, before, after: chess.fen() });
    plies.push({ san: m.san, uci, by: m.color === hero ? 'you' : 'rival', fenBefore: before, fenAfter: chess.fen(), legalReplies: legal, themes: [], notes: [], material: materialFor(chess, hero) - base });
  }
  for (let i = 0; i < plies.length; i++) {
    const p = plies[i];
    const { m, before, after } = moves[i];
    if (p.by !== 'you') {
      p.forced = p.legalReplies === 1;
      continue;
    }
    const pos = load(after);
    p.notes = describeStep(before, p.uci);
    const t = new Set();
    if (pos.isCheckmate()) t.add('mate');
    if (m.promotion) t.add('coronacion');
    // Jaque doble y descubierto.
    const ks = kingSquare(pos, enemy);
    if (ks && pos.inCheck()) {
      const checkers = pos.attackers(ks, hero);
      if (checkers.length > 1) t.add('jaqueDoble');
      else if (!checkers.includes(m.to)) t.add('descubierta');
    }
    // Sacrificio: tras la respuesta del rival pierdes 2+ puntos respecto a antes de tu jugada.
    const reply = plies[i + 1];
    const materialBefore = i > 0 ? plies[i - 1].material : 0;
    if (reply && reply.material - materialBefore <= -2 && !m.promotion) t.add('sacrificio');
    // Atracción: el rival captura en tu casilla con rey/dama/torre y luego atacas esa casilla.
    if (reply && reply.uci.slice(2, 4) === m.to) {
      const attracted = moves[i + 1].m.piece;
      const next = moves[i + 2];
      if (['k', 'q', 'r'].includes(attracted) && next && load(next.after).attackers(m.to, hero).length) t.add('atraccion');
    }
    // Eliminar al defensor: capturas algo que defendía la pieza que capturas en tu siguiente jugada.
    const nextMine = moves[i + 2];
    if (m.captured && nextMine?.m.captured) {
      const prev = load(before);
      if (prev.attackers(nextMine.m.to, enemy).includes(m.to)) t.add('eliminarDefensor');
    }
    // Desviación: el rival tuvo que dejar de defender la casilla donde capturas después.
    if (i >= 2 && m.captured) {
      const theirMove = moves[i - 1].m;
      const wasDefended = load(moves[i - 2].after).attackers(m.to, enemy).includes(theirMove.from);
      if (wasDefended && theirMove.to !== m.to && theirMove.piece !== 'k') t.add('desviacion');
    }
    for (const note of p.notes) {
      if (note.startsWith('ataque doble')) t.add('ataqueDoble');
      if (note.startsWith('clavada')) t.add('clavada');
      if (note.startsWith('enfilada')) t.add('enfilada');
    }
    if (!m.captured && !pos.inCheck() && !m.promotion && !p.notes.length && i < plies.length - 1) t.add('tranquila');
    p.themes = [...t];
  }
  return plies;
}

/** Frase corta para una jugada explicada. */
export function narratePly(p) {
  if (p.by === 'rival') {
    return p.forced ? `${p.san}: el rival no tiene otra jugada.` : `${p.san}: el rival responde (tenía ${p.legalReplies} jugadas legales).`;
  }
  const themes = p.themes.map((t) => `${MOVE_THEMES[t].name.toLowerCase()}: ${MOVE_THEMES[t].text}`);
  const notes = p.notes.filter((n) => n !== 'sacrificio');
  const parts = [...themes, ...notes.filter((n) => !themes.some((t) => t.startsWith(n.split(' ')[0])))];
  return `${p.san}: ${parts.length ? parts.join('; ') : 'mejora la posición'}.`;
}
