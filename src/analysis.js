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

/** Piezas atacadas por el rival que están indefensas o atacadas por algo de menor valor. */
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
    const defs = defenders(chess, p.square, color);
    const minAttacker = Math.min(...attackers.map((s) => VALUES[chess.get(s).type]));
    if (!defs.length) out.push({ ...p, attackers, reason: 'atacada y sin defensa' });
    else if (minAttacker < VALUES[p.type]) out.push({ ...p, attackers, reason: 'atacada por una pieza de menos valor' });
    else if (attackers.length > defs.length) out.push({ ...p, attackers, reason: 'más atacantes que defensores' });
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
  if (m.captured) {
    const before = load(fen);
    const wasDefended = defenders(before, m.to, enemy).length > 0;
    const fem = ['r', 'q'].includes(m.captured);
    if (!wasDefended) tags.push({ q: 'desprotegidas', text: `captura ${fem ? 'la' : 'el'} ${PIECE_NAMES[m.captured]} ${fem ? 'indefensa' : 'indefenso'}` });
    else if (VALUES[m.captured] > VALUES[m.piece]) tags.push({ q: 'amenazadas', text: `gana material: ${PIECE_NAMES[m.piece]} por ${PIECE_NAMES[m.captured]}` });
    else tags.push({ q: 'amenazadas', text: `captura ${PIECE_NAMES[m.captured]}` });
  }
  if (m.promotion) tags.push({ q: 'coronar', text: `corona ${PIECE_NAMES[m.promotion]}` });

  // Lo que ataca ahora la pieza movida (como si volviera a mover el mismo bando).
  const mine = load(withTurn(after, color));
  if (mine && !m.san.endsWith('#')) {
    const targets = mine
      .moves({ verbose: true, square: m.to })
      .filter((x) => x.captured)
      .map((x) => ({ ...mine.get(x.to), square: x.to }))
      .filter((p) => p.type !== 'k' && (defenders(mine, p.square, enemy).length === 0 || VALUES[p.type] > VALUES[m.piece]));
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
  return { move: m, san: m.san, uci: m.from + m.to + (m.promotion ?? ''), tags, warnings, yesCount: yes.size, mate: m.san.endsWith('#') };
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
