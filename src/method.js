// El método de pensamiento (Resumen_Ajedrez.md) traducido a pasos, preguntas
// y respuestas calculadas sobre la posición.
import {
  COLOR_NAMES,
  PIECE_NAMES,
  alignments,
  allPieces,
  availableTrades,
  describeIdea,
  findForcingIdea,
  withTurn,
  forks,
  holes,
  isEndgame,
  kingSafety,
  load,
  material,
  mateInOne,
  other,
  pawnBreaks,
  pawnStructure,
  pieceLabel,
  rivalIdeas,
  rookActivity,
  threatenedPieces,
  unprotectedPieces,
  worstPieces,
  toUci,
} from './analysis.js';

export const LEVELS = {
  casual: {
    label: 'Casual',
    tacticalNote: 'Dedica la mayor parte del tiempo a las preguntas tácticas.',
    strategic: ['debilidades', 'peorPieza'],
    strategicNote: 'Solo si son estrictamente necesarias.',
  },
  intermedio: {
    label: 'Intermedio',
    tacticalNote: 'Este proceso debería empezar a automatizarse.',
    strategic: ['debilidades', 'peorPieza', 'rival'],
    strategicNote: 'Solo si son necesarias. Empieza a desarrollar "¿qué quiere mi rival?".',
  },
  avanzado: {
    label: 'Avanzado',
    tacticalNote: 'Casi automáticas, pero hazlas igualmente.',
    strategic: ['debilidades', 'peorPieza', 'rival', 'cambios', 'estructura'],
    strategicNote: 'Empieza a incluir todas las preguntas estratégicas.',
  },
  experto: {
    label: 'Experto / Maestro',
    tacticalNote: 'Un chequeo automático de 30 segundos como máximo.',
    strategic: ['debilidades', 'peorPieza', 'rival', 'cambios', 'estructura'],
    strategicNote: 'Fundamentales salvo en posiciones de cálculo muy concreto.',
  },
};

export const MODES = {
  tiempo: 'Con tiempo (proceso completo)',
  apuro: 'Sin tiempo (intuición + comprobación)',
  mixto: '¿Táctica o mejora? (con posiciones tranquilas)',
};

export const BREATHING = { inhale: 7, exhale: 5, total: 30 };
export const MAX_CANDIDATES = 5;
export const INTUITION_SECONDS = 20;

export const TACTICAL_QUESTIONS = [
  { id: 'mate', text: '¿Hay mate en esta posición?', hint: 'Mira todos los jaques, tuyos y del rival.' },
  { id: 'desprotegidas', text: '¿Hay piezas desprotegidas?', hint: 'Busca piezas sin ningún defensor, de los dos colores.' },
  { id: 'amenazadas', text: '¿Hay piezas amenazadas en la posición?', hint: '¿Qué está atacado? ¿Por algo de menos valor? ¿Con más atacantes que defensores?' },
  { id: 'geometria', text: '¿Hay piezas alineadas, a salto de caballo o a doble de peón?', hint: 'Clavadas, enfiladas, ataques dobles de caballo y de peón. Piensa también en ideas de dos o tres jugadas: un jaque que prepara un ataque doble.' },
];

export const STRATEGIC_QUESTIONS = {
  debilidades: { text: '¿Dónde están las debilidades?', hint: 'Peones aislados o doblados, casillas débiles, rey sin escudo de peones.' },
  peorPieza: { open: true, text: '¿Cuál es mi peor pieza?', hint: 'Habla con tus piezas. Prioridad al activar: Caballo, Alfil, Torre, Dama.' },
  rival: { open: true, text: '¿Qué quiere hacer mi rival?', hint: 'Si le tocara mover, ¿qué jugaría? Su idea guía tu decisión.' },
  cambios: { open: true, text: '¿Qué cambio de piezas me favorece?', hint: '¿Cambiar damas? ¿Un caballo por un alfil? Depende del material y de la seguridad del rey.' },
  estructura: { open: true, text: '¿Qué cambios de estructura me favorecen?', hint: '¿Qué jugada de peón es buena y cuál no?' },
};

export const ENDGAME_QUESTIONS = {
  coronar: { text: '¿Puedo coronar un peón?', hint: 'Peones pasados y carreras de peones.' },
  torre: { open: true, text: '¿Puedo activar mi torre?', hint: 'Columnas abiertas, séptima fila, detrás de los peones pasados.' },
  fijar: { text: '¿Puedo fijar una debilidad?', hint: 'Peones rivales aislados o doblados que no se pueden mover.' },
  cambiosFinal: { open: true, text: '¿Qué piezas debo cambiar en el final?', hint: 'Con ventaja, cambia piezas, no peones.' },
  casillas: { open: true, text: '¿Cuáles son las mejores casillas para mis piezas?', hint: 'Pensamiento esquemático: dónde quieres cada pieza en unas jugadas.' },
};

export const NO_TIME_STEPS = [
  { id: 'intuicion', text: 'Fíate de la intuición', hint: 'Elige una de las primeras jugadas que se te ocurran. No hay tiempo para buscar más.' },
  { id: 'comprobacion', text: 'Comprueba que no te dejas nada', hint: 'Revisa la posición: ¿te dejas una pieza o un mate? Si no... adelante.' },
];

const list = (items) => items.join(', ');
/**
 * Un hallazgo del análisis. `squares` es todo lo que se resalta al verlo;
 * `targets`, solo las casillas que el jugador tendría que señalar para
 * "encontrarlo" (vacío si es informativo: no cuenta como fallo). Con
 * `match: 'all'` hay que señalar todas (una jugada: origen y destino);
 * con 'any', basta una.
 */
const finding = (text, squares = [], tone = 'info', { targets = [], match = 'any', move = null } = {}) => ({ text, squares, tone, targets, match, move });

/**
 * Responde a una pregunta del método. Devuelve { yes, findings } desde el punto de vista de `hero`.
 * `maxMs` limita la búsqueda de ideas forzadas (las ráfagas usan menos tiempo).
 */
export function answerQuestion(id, fen, hero, { maxMs = 400 } = {}) {
  const chess = load(fen);
  const enemy = other(hero);
  const findings = [];
  const yours = (c) => (c === hero ? 'tuyo/a' : 'del rival');

  switch (id) {
    case 'mate': {
      const mine = mateInOne(fen, hero);
      const theirs = mateInOne(fen, enemy);
      // El objetivo es la jugada de mate: se "juega" señalando origen y destino.
      for (const m of mine) findings.push(finding(`Tienes mate en 1: ${m.san}`, [m.from, m.to], 'good', { targets: [m.from, m.to], match: 'all', move: toUci(m) }));
      const longMate = mine.length ? null : findForcingIdea(fen, { maxMs });
      if (longMate?.mate) {
        const first = longMate.line[0].uci;
        findings.push(finding(`Hay un mate forzado en ${longMate.moves} jugadas: ${describeIdea(longMate, { moves: false })}`, [], 'good', { targets: [first.slice(0, 2), first.slice(2, 4)], match: 'all', move: first }));
      }
      for (const m of theirs) findings.push(finding(`El rival amenaza mate: ${m.san}`, [m.from, m.to], 'bad', { targets: [m.from, m.to], match: 'all', move: toUci(m) }));
      const checks = load(fen).moves({ verbose: true }).filter((m) => m.san.includes('+') && !m.san.endsWith('#'));
      if (!mine.length && checks.length) {
        findings.push(finding(`No hay mate inmediato, pero tienes ${checks.length} jaque(s) para revisar: ${list(checks.map((m) => m.san))}`, checks.flatMap((m) => [m.from, m.to]), 'info'));
      }
      const ks = kingSafety(chess, enemy);
      if (ks && ks.shield <= 1) findings.push(finding(`El rey rival en ${ks.square} tiene poca protección de peones`, [ks.square], 'info'));
      return { yes: mine.length > 0 || theirs.length > 0 || Boolean(longMate?.mate), findings };
    }
    case 'desprotegidas': {
      for (const c of [hero, enemy]) {
        for (const p of unprotectedPieces(chess, c)) {
          findings.push(finding(`${pieceLabel(p)} (${yours(c)}) no tiene defensores${p.attacked ? ' y está atacado/a' : ''}`, [p.square], c === hero ? 'bad' : 'good', { targets: [p.square] }));
        }
      }
      return { yes: findings.length > 0, findings };
    }
    case 'amenazadas': {
      for (const c of [hero, enemy]) {
        for (const p of threatenedPieces(chess, c)) {
          // Se señala la pieza amenazada, no sus atacantes.
          findings.push(finding(`${pieceLabel(p)} (${yours(c)}) ${p.reason} (atacado desde ${list(p.attackers)})`, [p.square, ...p.attackers], c === hero ? 'bad' : 'good', { targets: [p.square] }));
        }
      }
      return { yes: findings.length > 0, findings };
    }
    case 'geometria': {
      for (const c of [hero, enemy]) {
        const idea = findForcingIdea(c === hero ? fen : withTurn(fen, c), { maxMs });
        if (idea) {
          const first = idea.line[0].uci;
          const ends = [first.slice(0, 2), first.slice(2, 4)];
          findings.push(finding(`${c === hero ? 'Hay una idea forzada' : 'Cuidado: el rival tiene una idea forzada'} de ${idea.moves} jugadas: ${describeIdea(idea, { moves: c !== hero })}`, c === hero ? [] : ends, c === hero ? 'good' : 'bad', { targets: ends }));
        }
      }
      for (const c of [hero, enemy]) {
        const who = c === hero ? 'Tienes' : 'El rival tiene';
        for (const f of forks(fen, c)) {
          // Vale señalar la casilla del ataque doble o las piezas atacadas.
          const forked = f.targets.map((t) => t.square);
          findings.push(finding(`${who} un ataque doble de ${f.kind}: ${f.move.san} ataca ${list(f.targets.map(pieceLabel))}${f.safe ? '' : ' (la casilla está atacada)'}`, [f.move.from, f.move.to, ...forked], c === hero ? 'good' : 'bad', { targets: [f.move.to, ...forked] }));
        }
        const { pins, lines } = alignments(chess, c);
        for (const p of pins) {
          findings.push(finding(`${who} una ${p.kind}: ${pieceLabel(p.attacker)} sobre ${pieceLabel(p.front)} y ${pieceLabel(p.back)}`, [p.attacker.square, p.front.square, p.back.square], c === hero ? 'good' : 'bad', { targets: [p.front.square, p.back.square] }));
        }
        // Las parejas alineadas son informativas: no cuentan como fallo si no se señalan.
        for (const l of lines.slice(0, 3)) {
          const who2 = c === hero ? 'del rival' : 'tuyas';
          findings.push(finding(`Piezas ${who2} alineadas en ${l.diagonal ? 'diagonal' : 'línea'}: ${pieceLabel(l.a)} y ${pieceLabel(l.b)}`, [l.a.square, l.b.square], 'info'));
        }
      }
      return { yes: findings.some((f) => f.targets.length), findings };
    }
    case 'debilidades': {
      const endgame = isEndgame(chess);
      for (const c of [hero, enemy]) {
        const s = pawnStructure(chess, c);
        const who = c === hero ? 'tuyo' : 'del rival';
        const tone = c === hero ? 'bad' : 'good';
        for (const p of s.isolated) findings.push(finding(`Peón aislado ${who} en ${p.square}`, [p.square], tone, { targets: [p.square] }));
        const doubledFiles = [...new Set(s.doubled.map((p) => p.square[0]))];
        for (const file of doubledFiles) {
          const sqs = s.doubled.filter((p) => p.square[0] === file).map((p) => p.square);
          findings.push(finding(`Peones doblados ${c === hero ? 'tuyos' : 'del rival'} en la columna ${file}: ${list(sqs)}`, sqs, tone, { targets: sqs }));
        }
        const weak = kingWeakness(chess, c, endgame);
        if (weak) findings.push(finding(`Rey ${c === hero ? 'tuyo' : 'rival'} en ${weak.square}: ${weak.reason}`, [weak.square], tone, { targets: [weak.square] }));
        // Agujeros: casillas que ya no puede defender ningún peón (informativas).
        const hs = holes(chess, c).slice(0, 4);
        if (hs.length) findings.push(finding(`Casillas débiles ${c === hero ? 'en tu campo' : 'en el campo rival'} (ningún peón puede defenderlas): ${list(hs)}`, hs, 'info'));
      }
      return { yes: findings.some((f) => f.targets.length), findings };
    }
    case 'peorPieza': {
      const ranked = worstPieces(fen, hero);
      if (ranked.length) {
        const w = ranked[0];
        findings.push(finding(`Tu peor pieza parece ${pieceLabel(w)}: ${w.mobility} jugada(s), ${Math.round(w.ratio * 100)}% de su movilidad máxima`, [w.square], 'bad', { targets: [w.square] }));
        for (const p of ranked.slice(1, 3)) findings.push(finding(`Después: ${pieceLabel(p)} (${p.mobility} jugadas, ${Math.round(p.ratio * 100)}% de su máximo)`, [p.square], 'info'));
      }
      return { yes: ranked.length > 0, findings };
    }
    case 'rival': {
      for (const idea of rivalIdeas(fen, hero)) {
        findings.push(finding(`${idea.san}: ${list(idea.tags.map((t) => t.text))}`, [idea.move.from, idea.move.to], 'bad', { targets: [idea.move.from, idea.move.to], match: 'all', move: idea.uci }));
      }
      return { yes: findings.length > 0, findings };
    }
    case 'cambios':
    case 'cambiosFinal': {
      const m = material(chess);
      const diff = m[hero] - m[enemy];
      if (diff > 0) findings.push(finding(`Vas ${diff} punto(s) por delante en material: los cambios de piezas (no de peones) te favorecen`, [], 'good'));
      else if (diff < 0) findings.push(finding(`Vas ${-diff} punto(s) por detrás: evita cambios, busca complicaciones`, [], 'bad'));
      else findings.push(finding('Material igualado: cambia tu peor pieza por la mejor del rival', [], 'info'));
      const ksMine = kingSafety(chess, hero);
      if (m.queens && ksMine && ksMine.shield <= 1) findings.push(finding('Tu rey está expuesto: cambiar damas reduce el peligro', [ksMine.square], 'info'));
      for (const t of availableTrades(fen)) {
        findings.push(finding(`Cambio disponible: ${t.san} (${PIECE_NAMES[t.piece]} por ${PIECE_NAMES[t.captured]})`, [t.from, t.to], diff > 0 ? 'good' : diff < 0 ? 'bad' : 'info', { targets: [t.from, t.to], match: 'all', move: toUci(t) }));
      }
      const mine = worstPieces(fen, hero)[0];
      const theirs = worstPieces(fen, enemy).at(-1);
      if (mine && theirs) findings.push(finding(`Idea: cambiar tu ${pieceLabel(mine)} (poco activa) por la ${pieceLabel(theirs)} (la más activa del rival)`, [mine.square, theirs.square], 'info'));
      return { yes: findings.length > 0, findings };
    }
    case 'estructura': {
      const breaks = pawnBreaks(fen, hero);
      if (breaks.length) findings.push(finding(`Rupturas de peón posibles: ${list(breaks.map((m) => m.san))}`, breaks.map((m) => m.to), 'info', { targets: breaks.map((m) => m.to) }));
      const s = pawnStructure(chess, hero);
      if (s.passed.length) findings.push(finding(`Tienes peones pasados: ${list(s.passed.map((p) => p.square))}`, s.passed.map((p) => p.square), 'good', { targets: s.passed.map((p) => p.square) }));
      return { yes: findings.length > 0, findings };
    }
    case 'coronar': {
      for (const c of [hero, enemy]) {
        const s = pawnStructure(chess, c);
        for (const p of s.passed) findings.push(finding(`Peón pasado ${c === hero ? 'tuyo' : 'del rival'} en ${p.square}`, [p.square], c === hero ? 'good' : 'bad', { targets: [p.square] }));
      }
      return { yes: findings.length > 0, findings };
    }
    case 'torre': {
      const r = rookActivity(chess, hero);
      for (const rook of r.rooks) {
        findings.push(finding(`${pieceLabel(rook)}: ${rook.onOpen ? 'en columna abierta' : rook.onHalfOpen ? 'en columna semiabierta' : 'pasiva'}`, [rook.square], rook.onOpen || rook.onHalfOpen ? 'good' : 'bad', rook.onOpen ? {} : { targets: [rook.square] }));
      }
      if (r.openFiles.length) findings.push(finding(`Columnas abiertas: ${list(r.openFiles)}`, [], 'info'));
      return { yes: r.rooks.some((x) => !x.onOpen), findings };
    }
    case 'fijar': {
      const s = pawnStructure(chess, enemy);
      const weak = [...new Set([...s.isolated, ...s.doubled])];
      for (const p of weak) findings.push(finding(`Debilidad rival para fijar y atacar: peón de ${p.square}`, [p.square], 'good', { targets: [p.square] }));
      return { yes: weak.length > 0, findings };
    }
    case 'casillas': {
      const ranked = worstPieces(fen, hero);
      for (const p of ranked.slice(0, 2)) findings.push(finding(`Busca una casilla mejor para ${pieceLabel(p)}`, [p.square], 'info', { targets: [p.square] }));
      return { yes: true, findings };
    }
    default:
      return { yes: false, findings };
  }
}

/**
 * Hallazgos del paso "¿Qué ha cambiado?" a partir de lastMoveDiff: lo que el
 * jugador tendría que señalar (la pieza atacada, la que quedó sin defensa, el
 * objetivo de la línea abierta o cortada).
 */
export function changeFindings(diff, hero) {
  if (!diff) return [];
  const out = [];
  const name = (p) => pieceLabel(p);
  const mine = (p) => p.color === hero;
  const moved = diff.piece;
  if (diff.captured) out.push(finding(`Ha capturado ${name(diff.captured)}`, [diff.to], 'info'));
  for (const p of diff.attacks) {
    const what = p.type === 'k' ? 'a tu rey (jaque)' : `${mine(p) ? 'tu' : 'la'} ${name(p)}${p.wins ? '' : ' (bien defendida: no se pierde en el cambio)'}`;
    out.push(finding(`${PIECE_NAMES[moved.type][0].toUpperCase()}${PIECE_NAMES[moved.type].slice(1)} de ${moved.square} ataca ahora ${what}`, [moved.square, p.square], mine(p) && p.wins ? 'bad' : 'info', { targets: [p.square] }));
  }
  for (const p of diff.undefended) {
    out.push(finding(`Ha dejado de defender ${name(p)}${p.stillDefended ? ' (aún la defiende otra pieza)' : ': queda sin defensa'}`, [diff.from, p.square], p.stillDefended ? 'info' : 'good', { targets: [p.square] }));
  }
  for (const o of diff.opened) {
    out.push(finding(`Al irse de ${diff.from} abre la línea de ${name(o.by)} hacia ${name(o.target)}${mine(o.by) ? ' (a tu favor)' : ' (ataque a la descubierta)'}`, [o.by.square, diff.from, o.target.square], mine(o.by) ? 'good' : 'bad', { targets: [o.target.square] }));
  }
  for (const b of diff.blocked) {
    out.push(finding(`En ${diff.to} corta la línea de ${name(b.by)} hacia ${name(b.target)}`, [b.by.square, diff.to, b.target.square], mine(b.by) ? 'bad' : 'good', { targets: [b.target.square] }));
  }
  return out;
}

/**
 * Enlaza lo que cambió con la jugada clave: "la jugada del rival dejó sin
 * defensa el alfil de e7" si la clave lo aprovecha. Devuelve una frase o null.
 */
export function changeLink(diff, fen, keyUci) {
  if (!diff || !keyUci) return null;
  const chess = load(fen);
  const to = keyUci.slice(2, 4);
  let key;
  try {
    key = chess.move({ from: keyUci.slice(0, 2), to, promotion: keyUci[4] });
  } catch {
    return null;
  }
  const loose = diff.undefended.find((p) => !p.stillDefended && (p.square === to || chess.attackers(p.square, key.color).includes(to)));
  if (loose) return `La jugada del rival dejó sin defensa ${pieceLabel(loose)}, y la clave ${key.san} lo aprovecha.`;
  if (to === diff.to) return `La clave ${key.san} captura la pieza que acaba de mover el rival.`;
  const opened = diff.opened.find((o) => o.by.color === key.color && (o.by.square === key.from || o.target.square === to));
  if (opened) return `Al mover, el rival abrió la línea de ${pieceLabel(opened.by)}: la clave ${key.san} la usa.`;
  if (diff.blocked.some((b) => b.target.square === to || b.by.square === to)) return `La pieza del rival se interpuso en una línea, y la clave ${key.san} actúa sobre ella.`;
  if (chess.attackers(diff.to, key.color).includes(to) && !chess.isCheckmate()) return `La clave ${key.san} ataca la pieza que acaba de mover el rival.`;
  return null;
}

/**
 * ¿Es el rey de `color` una debilidad? En el centro solo si quedan damas, ya
 * no puede enrocar y tiene una columna abierta o semiabierta al lado (antes
 * bastaba con estar en la columna d o e, y casi siempre salía SÍ). Fuera del
 * centro, si le queda poco escudo de peones y no es un final.
 */
export function kingWeakness(chess, color, endgame = isEndgame(chess)) {
  const ks = kingSafety(chess, color);
  if (!ks || endgame) return null;
  const rights = chess.getCastlingRights(color);
  const canCastle = rights.k || rights.q;
  if (ks.central) {
    if (canCastle) return null;
    const file = ks.square.charCodeAt(0) - 97;
    const pawns = allPawns(chess, color);
    const exposed = [file - 1, file, file + 1].some((f) => f >= 0 && f < 8 && !pawns.some((p) => p.square.charCodeAt(0) - 97 === f));
    return exposed || ks.shield <= 1 ? { square: ks.square, reason: 'sigue en el centro, sin enroque y con columnas abiertas' } : null;
  }
  return ks.shield <= 1 ? { square: ks.square, reason: 'poco escudo de peones' } : null;
}

const allPawns = (chess, color) => allPieces(chess).filter((p) => p.type === 'p' && p.color === color);

/**
 * Corrige una respuesta "señalando": qué hallazgos ha encontrado el jugador
 * con las casillas que ha tocado (`picks`), cuáles se le han escapado y qué
 * casillas eran falsas alarmas (no aparecen en ningún hallazgo).
 */
export function scorePicks(findings, picks) {
  const touched = new Set(picks);
  const required = findings.filter((f) => f.targets?.length);
  const found = required.filter((f) => (f.match === 'all' ? f.targets.every((sq) => touched.has(sq)) : f.targets.some((sq) => touched.has(sq))));
  const missed = required.filter((f) => !found.includes(f));
  const known = new Set(findings.flatMap((f) => [...f.squares, ...(f.targets ?? [])]));
  const falseAlarms = [...touched].filter((sq) => !known.has(sq));
  // Acierto: todo lo importante encontrado; si no había nada, no señalar nada.
  const correct = required.length ? missed.length === 0 : falseAlarms.length === 0;
  return { required: required.length, found, missed, falseAlarms, correct };
}

/** Qué preguntas toca hacer en esta posición según el nivel. */
export function questionPlan(fen, level) {
  const chess = load(fen);
  const endgame = isEndgame(chess);
  const tactical = TACTICAL_QUESTIONS.map((q) => ({ ...q, group: 'tactica' }));
  const strategic = endgame
    ? Object.entries(ENDGAME_QUESTIONS).map(([id, q]) => ({ id, ...q, group: 'final' }))
    : LEVELS[level].strategic.map((id) => ({ id, ...STRATEGIC_QUESTIONS[id], group: 'estrategia' }));
  return { endgame, tactical, strategic };
}

export const describeSide = (color) => `Juegan las ${COLOR_NAMES[color]}`;
export const describePiece = (type) => PIECE_NAMES[type];
