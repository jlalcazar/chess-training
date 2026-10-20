// El método de pensamiento (Resumen_Ajedrez.md) traducido a pasos, preguntas
// y respuestas calculadas sobre la posición.
import {
  COLOR_NAMES,
  PIECE_NAMES,
  alignments,
  forks,
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
};

export const BREATHING = { inhale: 7, exhale: 5, total: 30 };
export const MAX_CANDIDATES = 5;
export const INTUITION_SECONDS = 20;

export const TACTICAL_QUESTIONS = [
  { id: 'mate', text: '¿Hay mate en esta posición?', hint: 'Mira todos los jaques, tuyos y del rival.' },
  { id: 'desprotegidas', text: '¿Hay piezas desprotegidas?', hint: 'Busca piezas sin ningún defensor, de los dos colores.' },
  { id: 'amenazadas', text: '¿Hay piezas amenazadas en la posición?', hint: '¿Qué está atacado? ¿Por algo de menos valor? ¿Con más atacantes que defensores?' },
  { id: 'geometria', text: '¿Hay piezas alineadas, a salto de caballo o a doble de peón?', hint: 'Clavadas, enfiladas, ataques dobles de caballo y de peón.' },
];

export const STRATEGIC_QUESTIONS = {
  debilidades: { text: '¿Dónde están las debilidades?', hint: 'Peones aislados o doblados, casillas débiles, rey sin escudo de peones.' },
  peorPieza: { text: '¿Cuál es mi peor pieza?', hint: 'Habla con tus piezas. Prioridad al activar: Caballo, Alfil, Torre, Dama.' },
  rival: { text: '¿Qué quiere hacer mi rival?', hint: 'Si le tocara mover, ¿qué jugaría? Su idea guía tu decisión.' },
  cambios: { text: '¿Qué cambio de piezas me favorece?', hint: '¿Cambiar damas? ¿Un caballo por un alfil? Depende del material y de la seguridad del rey.' },
  estructura: { text: '¿Qué cambios de estructura me favorecen?', hint: '¿Qué jugada de peón es buena y cuál no?' },
};

export const ENDGAME_QUESTIONS = {
  coronar: { text: '¿Puedo coronar un peón?', hint: 'Peones pasados y carreras de peones.' },
  torre: { text: '¿Puedo activar mi torre?', hint: 'Columnas abiertas, séptima fila, detrás de los peones pasados.' },
  fijar: { text: '¿Puedo fijar una debilidad?', hint: 'Peones rivales aislados o doblados que no se pueden mover.' },
  cambiosFinal: { text: '¿Qué piezas debo cambiar en el final?', hint: 'Con ventaja, cambia piezas, no peones.' },
  casillas: { text: '¿Cuáles son las mejores casillas para mis piezas?', hint: 'Pensamiento esquemático: dónde quieres cada pieza en unas jugadas.' },
};

export const NO_TIME_STEPS = [
  { id: 'intuicion', text: 'Fíate de la intuición', hint: 'Elige una de las primeras jugadas que se te ocurran. No hay tiempo para buscar más.' },
  { id: 'comprobacion', text: 'Comprueba que no te dejas nada', hint: 'Revisa la posición: ¿te dejas una pieza o un mate? Si no... adelante.' },
];

const list = (items) => items.join(', ');
const finding = (text, squares = [], tone = 'info') => ({ text, squares, tone });

/** Responde a una pregunta del método. Devuelve { yes, findings } desde el punto de vista de `hero`. */
export function answerQuestion(id, fen, hero) {
  const chess = load(fen);
  const enemy = other(hero);
  const findings = [];
  const yours = (c) => (c === hero ? 'tuyo/a' : 'del rival');

  switch (id) {
    case 'mate': {
      const mine = mateInOne(fen, hero);
      const theirs = mateInOne(fen, enemy);
      for (const m of mine) findings.push(finding(`Tienes mate en 1: ${m.san}`, [m.from, m.to], 'good'));
      for (const m of theirs) findings.push(finding(`El rival amenaza mate: ${m.san}`, [m.from, m.to], 'bad'));
      const checks = load(fen).moves({ verbose: true }).filter((m) => m.san.includes('+') && !m.san.endsWith('#'));
      if (!mine.length && checks.length) {
        findings.push(finding(`No hay mate inmediato, pero tienes ${checks.length} jaque(s) para revisar: ${list(checks.map((m) => m.san))}`, checks.flatMap((m) => [m.to]), 'info'));
      }
      const ks = kingSafety(chess, enemy);
      if (ks && ks.shield <= 1) findings.push(finding(`El rey rival en ${ks.square} tiene poca protección de peones`, [ks.square], 'info'));
      return { yes: mine.length > 0 || theirs.length > 0, findings };
    }
    case 'desprotegidas': {
      for (const c of [hero, enemy]) {
        for (const p of unprotectedPieces(chess, c)) {
          findings.push(finding(`${pieceLabel(p)} (${yours(c)}) no tiene defensores${p.attacked ? ' y está atacado/a' : ''}`, [p.square], c === hero ? 'bad' : 'good'));
        }
      }
      return { yes: findings.length > 0, findings };
    }
    case 'amenazadas': {
      for (const c of [hero, enemy]) {
        for (const p of threatenedPieces(chess, c)) {
          findings.push(finding(`${pieceLabel(p)} (${yours(c)}) ${p.reason} (atacado desde ${list(p.attackers)})`, [p.square, ...p.attackers], c === hero ? 'bad' : 'good'));
        }
      }
      return { yes: findings.length > 0, findings };
    }
    case 'geometria': {
      for (const c of [hero, enemy]) {
        const who = c === hero ? 'Tienes' : 'El rival tiene';
        for (const f of forks(fen, c)) {
          findings.push(finding(`${who} un ataque doble de ${f.kind}: ${f.move.san} ataca ${list(f.targets.map(pieceLabel))}${f.safe ? '' : ' (la casilla está atacada)'}`, [f.move.from, f.move.to, ...f.targets.map((t) => t.square)], c === hero ? 'good' : 'bad'));
        }
        const { pins, lines } = alignments(chess, c);
        for (const p of pins) {
          findings.push(finding(`${who} una ${p.kind}: ${pieceLabel(p.attacker)} sobre ${pieceLabel(p.front)} y ${pieceLabel(p.back)}`, [p.attacker.square, p.front.square, p.back.square], c === hero ? 'good' : 'bad'));
        }
        for (const l of lines.slice(0, 3)) {
          const who2 = c === hero ? 'del rival' : 'tuyas';
          findings.push(finding(`Piezas ${who2} alineadas en ${l.diagonal ? 'diagonal' : 'línea'}: ${pieceLabel(l.a)} y ${pieceLabel(l.b)}`, [l.a.square, l.b.square], 'info'));
        }
      }
      return { yes: findings.length > 0, findings };
    }
    case 'debilidades': {
      for (const c of [hero, enemy]) {
        const s = pawnStructure(chess, c);
        const who = c === hero ? 'tuyos' : 'del rival';
        if (s.isolated.length) findings.push(finding(`Peones aislados ${who}: ${list(s.isolated.map((p) => p.square))}`, s.isolated.map((p) => p.square), c === hero ? 'bad' : 'good'));
        if (s.doubled.length) findings.push(finding(`Peones doblados ${who}: ${list(s.doubled.map((p) => p.square))}`, s.doubled.map((p) => p.square), c === hero ? 'bad' : 'good'));
        const ks = kingSafety(chess, c);
        if (ks && (ks.shield <= 1 || ks.central)) {
          findings.push(finding(`Rey ${c === hero ? 'tuyo' : 'rival'} en ${ks.square}: ${ks.central ? 'sigue en el centro' : 'poco escudo de peones'}`, [ks.square], c === hero ? 'bad' : 'good'));
        }
      }
      return { yes: findings.length > 0, findings };
    }
    case 'peorPieza': {
      const ranked = worstPieces(fen, hero);
      if (ranked.length) {
        const w = ranked[0];
        findings.push(finding(`Tu peor pieza parece ${pieceLabel(w)}: ${w.mobility} jugada(s), ${Math.round(w.ratio * 100)}% de su movilidad máxima`, [w.square], 'bad'));
        for (const p of ranked.slice(1, 3)) findings.push(finding(`Después: ${pieceLabel(p)} (${p.mobility} jugadas, ${Math.round(p.ratio * 100)}% de su máximo)`, [p.square], 'info'));
      }
      return { yes: ranked.length > 0, findings };
    }
    case 'rival': {
      for (const idea of rivalIdeas(fen, hero)) {
        findings.push(finding(`${idea.san}: ${list(idea.tags.map((t) => t.text))}`, [idea.move.from, idea.move.to], 'bad'));
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
      return { yes: diff !== 0, findings };
    }
    case 'estructura': {
      const breaks = pawnBreaks(fen, hero);
      if (breaks.length) findings.push(finding(`Rupturas de peón posibles: ${list(breaks.map((m) => m.san))}`, breaks.map((m) => m.to), 'info'));
      const s = pawnStructure(chess, hero);
      if (s.passed.length) findings.push(finding(`Tienes peones pasados: ${list(s.passed.map((p) => p.square))}`, s.passed.map((p) => p.square), 'good'));
      return { yes: findings.length > 0, findings };
    }
    case 'coronar': {
      for (const c of [hero, enemy]) {
        const s = pawnStructure(chess, c);
        if (s.passed.length) findings.push(finding(`Peones pasados ${c === hero ? 'tuyos' : 'del rival'}: ${list(s.passed.map((p) => p.square))}`, s.passed.map((p) => p.square), c === hero ? 'good' : 'bad'));
      }
      return { yes: findings.length > 0, findings };
    }
    case 'torre': {
      const r = rookActivity(chess, hero);
      for (const rook of r.rooks) {
        findings.push(finding(`${pieceLabel(rook)}: ${rook.onOpen ? 'en columna abierta' : rook.onHalfOpen ? 'en columna semiabierta' : 'pasiva'}`, [rook.square], rook.onOpen || rook.onHalfOpen ? 'good' : 'bad'));
      }
      if (r.openFiles.length) findings.push(finding(`Columnas abiertas: ${list(r.openFiles)}`, [], 'info'));
      return { yes: r.rooks.some((x) => !x.onOpen), findings };
    }
    case 'fijar': {
      const s = pawnStructure(chess, enemy);
      const weak = [...new Set([...s.isolated, ...s.doubled])];
      if (weak.length) findings.push(finding(`Debilidades rivales para fijar y atacar: ${list(weak.map((p) => p.square))}`, weak.map((p) => p.square), 'good'));
      return { yes: weak.length > 0, findings };
    }
    case 'casillas': {
      const ranked = worstPieces(fen, hero);
      for (const p of ranked.slice(0, 2)) findings.push(finding(`Busca una casilla mejor para ${pieceLabel(p)}`, [p.square], 'info'));
      return { yes: true, findings };
    }
    default:
      return { yes: false, findings };
  }
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
