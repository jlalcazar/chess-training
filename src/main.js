import './styles.css';
import { Chess } from 'chess.js';
import { Board } from './board.js';
import { $, h, storage, uciToMove } from './dom.js';
import { BLIND_SPOTS, COLOR_NAMES, PIECE_NAMES, blindSpots, mateInOne, other, seeMove, describeIdea, evaluateMove, explainLine, findForcingIdea, forcingSweep, holes, lastMoveDiff, load, narratePly, outposts, pieceRoutes, squareControl, withTurn, worstPieces } from './analysis.js';
import { DEFAULT_DEPTH, ENGINE_SOURCES, StockfishEngine, describeAdvantage, engineMove, evaluateMoves, evaluatePosition, formatScore, pvToSan, toCp, verdict, winChance } from './engine.js';
import { emptyStats, recordExercise, summarize } from './stats.js';
import { CONFIDENCE, GLANCE_CASES, GLANCE_SECONDS, glanceCase } from './intuition.js';
import { PHASE_NAMES, fixation, keyFirstSeen, phaseDurations } from './timeline.js';
import { ERROR_INFO, classifyMistake, errorAdvice } from './errors.js';
import { EVAL_SYMBOLS, blindQuestions, cpToSymbol, firstDeviation, gradeBlind, playLine, rivalNode, symbolOf } from './blindline.js';
import { SRS_INTERVALS, dueReviews, dueText, emptyProgress, failCount, learnedPuzzles, legacyCount, recordAttempt, srsChange, themeSummary, upcomingReviews } from './progress.js';
import { DIFFICULTIES, THEMES, THEME_HELP, fetchDailyPuzzle, fetchNextPuzzle, fetchPuzzleById, themeName } from './lichess.js';
import {
  BREATHING,
  INTUITION_SECONDS,
  LEVELS,
  MAX_CANDIDATES,
  MODES,
  NO_TIME_STEPS,
  TACTICAL_QUESTIONS,
  answerQuestion,
  changeFindings,
  changeLink,
  questionPlan,
  scorePicks,
} from './method.js';

// ----------------------------------------------------------------- utilidades

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');

function log(...args) {
  if (DEBUG) console.log('[trainer]', ...args);
}

// ---------------------------------------------------------------------- estado

// Preferencias: las antiguas y las nuevas opciones de entrenamiento (todas se
// guardan en `settings`; los valores guardados antes siguen valiendo).
const SETTING_DEFAULTS = {
  level: 'casual', angle: 'mix', difficulty: 'normal', mode: 'tiempo', breathing: true, engineOn: false, engineSource: 'stockfish',
  whatChanged: true, // paso "¿Qué ha cambiado?"
  glance: true, // golpe de vista de 10 s
  pointAnswers: false, // responder señalando en el tablero
  predictReply: 'auto', // predecir la respuesta del rival: auto = desde Intermedio
  calcStep: false, // paso "Calcular" siempre (si no, con un botón en Decisión)
  lineSweep: true, // barrido rápido antes de cada jugada de la línea
  safetyCheck: true, // "¿Qué permite mi jugada?" antes de jugar
  scaffold: true, // ayuda que se retira por pregunta
  blindArrows: 'auto', // flechas de la línea a ciegas: auto = ocultas en Avanzado y Experto
  lichessUser: '',
};
const settings = { ...SETTING_DEFAULTS, ...storage.get('settings', {}) };
let state = null;
let timer = null;

const board = new Board($('#board'), { onMove: (m) => onBoardMove(m), onPick: (sq) => onBoardPick(sq) });
const boardMode = $('#board-mode');
const panel = $('#panel');

function stopTimer() {
  clearInterval(timer);
  timer = null;
}

function newState(puzzle) {
  const plan = questionPlan(puzzle.fen, settings.level);
  return {
    puzzle,
    plan,
    mode: settings.mode,
    flow: flowFor(settings.mode, puzzle),
    step: null,
    candidates: [],
    addingCandidate: false, // en Decisión: el próximo movimiento en el tablero se apunta, no se juega
    intuition: null,
    questionIndex: 0,
    answers: {}, // id -> { user: boolean, result }
    ply: 0,
    playFen: puzzle.fen,
    lastMove: puzzle.lastMove,
    mistakes: [],
    predictions: [], // respuestas del rival que has predicho (no cuentan como errores)
    feedback: null,
    revealed: false,
    hint: 0, // nivel de pista para la jugada actual (0-3)
    hintsUsed: 0,
    startedAt: Date.now(),
    timeline: [], // mapa del proceso: se registra en silencio
  };
}

/** Apunta un evento en la línea de tiempo del ejercicio (fases, candidatas, respuestas, pistas, jugadas). */
function track(type, data = {}) {
  if (!state?.timeline) return;
  state.timeline.push({ t: Date.now() - state.startedAt, type, ...data });
}

/** Pasos del ejercicio según el modo y las opciones (se fijan al empezar). */
function flowFor(mode, puzzle) {
  if (mode !== 'tiempo') return ['intuicion', 'comprobacion', 'resolver', 'resumen'];
  return [
    settings.breathing && 'calma',
    settings.whatChanged && puzzle.fenBefore && puzzle.lastMove && 'cambios',
    settings.glance && 'vistazo',
    'candidatas', 'tactica', 'estrategia',
    settings.calcStep && 'calculo',
    'decision', 'resolver', 'resumen',
  ].filter(Boolean);
}

const STEP_LABELS = { calma: 'Calma', cambios: '¿Qué cambió?', vistazo: 'Golpe de vista', candidatas: 'Candidatas', tactica: 'Táctica', estrategia: 'Estrategia', calculo: 'Calcular', decision: 'Decisión', permite: '¿Qué permite?', resolver: 'Jugar', resumen: 'Resumen', intuicion: 'Intuición', comprobacion: 'Comprobar' };

/** El paso que sigue a `step` en el flujo de este ejercicio. */
function nextStep(step) {
  const i = state.flow.indexOf(step);
  return state.flow[i + 1] ?? 'decision';
}

/** Número del paso para los títulos ("3. Preguntas tácticas"). */
const stepNo = (step) => state.flow.indexOf(step) + 1;

/** Modo del ejercicio actual (el de las opciones si no hay ejercicio). */
const mode = () => state?.mode ?? settings.mode;

// ------------------------------------------------------------------- arranque

function renderSettings() {
  const select = (key, options) =>
    h(
      'select',
      {
        onChange: (e) => {
          settings[key] = e.target.value;
          storage.set('settings', settings);
        },
      },
      Object.entries(options).map(([value, label]) => h('option', { value, selected: settings[key] === value }, label)),
    );
  const levelOptions = Object.fromEntries(Object.entries(LEVELS).map(([k, v]) => [k, v.label]));
  // Un tema elegido desde "Temas" puede no estar en la lista corta del selector.
  const themeOptions = THEMES[settings.angle] ? THEMES : { ...THEMES, [settings.angle]: themeName(settings.angle) };
  const due = dueReviews(loadProgress(), Date.now()).length;
  $('#settings').replaceChildren(
    h('label', {}, 'Nivel ', select('level', levelOptions)),
    h('label', {}, 'Modo ', select('mode', MODES)),
    h('label', {}, 'Tema ', select('angle', themeOptions)),
    h('label', {}, 'Dificultad ', select('difficulty', DIFFICULTIES)),
    h(
      'label',
      { class: 'check' },
      h('input', {
        type: 'checkbox',
        checked: settings.breathing,
        onChange: (e) => {
          settings.breathing = e.target.checked;
          storage.set('settings', settings);
        },
      }),
      ' Respiración inicial',
    ),
    h('button', { class: 'primary', onClick: () => loadPuzzle() }, 'Nuevo ejercicio'),
    h('button', { onClick: () => loadPuzzle('daily') }, 'Puzzle del día'),
    h('button', { id: 'review-button', class: due ? 'review-due' : '', onClick: openReview, title: 'Ejercicios fallados para repetir de forma espaciada' }, due ? `Repaso (${due})` : 'Repaso'),
    h('button', { onClick: openThemes, title: 'Resueltos y no resueltos por tema' }, 'Temas'),
    h('button', { onClick: openStats }, 'Estadísticas'),
    h('button', { onClick: openOptions, title: 'Opciones de entrenamiento: pasos y ayudas que puedes activar o quitar' }, 'Opciones'),
  );
}

/** Opciones de entrenamiento (se guardan en `settings`; se aplican al empezar el siguiente ejercicio). */
const OPTIONS = [
  { key: 'whatChanged', label: '¿Qué ha cambiado con la jugada del rival?', help: 'Paso corto tras la calma: señala qué ataca, qué dejó de defender y qué líneas abrió o cortó la última jugada.' },
  { key: 'glance', label: 'Golpe de vista (10 s)', help: 'La primera jugada que te salga, con tu seguridad. Mide tu intuición.' },
  { key: 'pointAnswers', label: 'Responder señalando en el tablero', help: 'En lugar de Sí/No: toca las casillas (de los dos colores) o juega el mate. Así decir siempre "sí" no puntúa.' },
  { key: 'predictReply', label: 'Predecir la respuesta del rival', help: 'Tras cada jugada correcta, juegas tú la respuesta que esperas del rival.', options: { auto: 'Desde Intermedio', on: 'Siempre', off: 'Nunca' } },
  { key: 'calcStep', label: 'Paso «Calcular» siempre', help: 'Compara dos candidatas con líneas a ciegas antes de decidir. Si está apagado, tienes un botón en Decisión.' },
  { key: 'lineSweep', label: 'Barrido rápido en cada jugada de la línea', help: 'Antes de cada jugada tuya en la línea: cuántos jaques, capturas y amenazas hay, sin decir cuáles.' },
  { key: 'safetyCheck', label: '¿Qué permite mi jugada? (antes de jugar)', help: 'Juegas tú la respuesta que más te preocupa y la app te dice qué no miraste.' },
  { key: 'scaffold', label: 'Ayuda que se retira', help: 'Las preguntas que dominas pasan a un chequeo rápido de 30 s; si fallan, vuelven a ser guiadas.' },
  { key: 'blindArrows', label: 'Flechas en la línea a ciegas', help: 'Dibujar las jugadas que introduces o tenerlas solo en la cabeza.', options: { auto: 'Ocultas en Avanzado y Experto', on: 'Siempre visibles', off: 'Siempre ocultas' } },
];

function openOptions() {
  const row = (o) => {
    const control = o.options
      ? h('select', { 'aria-label': o.label, onChange: (e) => { settings[o.key] = e.target.value; saveSettings(); } },
          Object.entries(o.options).map(([value, label]) => h('option', { value, selected: String(settings[o.key]) === value }, label)))
      : h('input', { type: 'checkbox', checked: Boolean(settings[o.key]), onChange: (e) => { settings[o.key] = e.target.checked; saveSettings(); } });
    return h('li', { class: 'option-row' },
      o.options ? h('label', {}, h('strong', {}, o.label), ' ', control) : h('label', { class: 'check' }, control, ' ', h('strong', {}, o.label)),
      h('div', { class: 'muted small' }, o.help));
  };
  openDialog('options-dialog', 'Opciones de entrenamiento',
    h('p', { class: 'muted small' }, 'Todo es opcional: el proceso de siempre sigue igual. Los cambios se aplican desde el siguiente ejercicio.'),
    h('ul', { class: 'options' }, OPTIONS.map(row)),
    h('h3', {}, 'Atajos de teclado'),
    h('p', { class: 'small' }, 'S y N: responder · ?: pista · Intro: continuar · 1-5: elegir candidata · P: jugar la elegida · flechas: navegar en el resumen.'),
  );
}

// Cada carga tiene su número: una respuesta o animación de un ejercicio anterior no toca el actual.
let loadSeq = 0;

/** `source`: nada (siguiente de Lichess), 'daily', un id de Lichess o un ejercicio ya guardado. */
async function loadPuzzle(source, { srs = false } = {}) {
  const request = ++loadSeq;
  stopTimer();
  cancelEngine();
  panel.replaceChildren(h('p', { class: 'muted' }, 'Pidiendo un ejercicio a Lichess…'));
  try {
    const puzzle =
      typeof source === 'object' && source
        ? source
        : source === 'daily'
          ? await fetchDailyPuzzle()
          : source
            ? await fetchPuzzleById(source)
            : await fetchNextPuzzle({ angle: settings.angle, difficulty: settings.difficulty });
    if (request !== loadSeq) return;
    log('puzzle', puzzle);
    state = newState(puzzle);
    state.step = state.flow[0];
    state.stepAt = Date.now();
    track('phase', { step: state.step });
    state.srsSession = srs;
    // Muestra la posición anterior y luego la jugada del rival, como en Lichess.
    board.setInteractive(false);
    board.setMarks({});
    board.setArrows([]);
    board.setPosition(puzzle.fenBefore, { orientation: puzzle.heroColor });
    const current = state;
    setTimeout(() => {
      if (state !== current) return;
      board.setPosition(puzzle.fen, { orientation: puzzle.heroColor, lastMove: puzzle.lastMove });
      render();
    }, 700);
    panel.replaceChildren(h('p', { class: 'muted' }, `El rival juega ${puzzle.lastMove?.san ?? ''}…`));
  } catch (err) {
    if (request !== loadSeq) return;
    console.error(err);
    panel.replaceChildren(
      h('div', { class: 'error' }, h('strong', {}, 'No se pudo cargar el ejercicio. '), err.message),
      h('button', { onClick: () => loadPuzzle(source) }, 'Reintentar'),
    );
  }
}

// ------------------------------------------------------------------ render

function go(step) {
  stopTimer();
  state.pointing = null;
  state.controlShown = false;
  board.setTints({});
  board.setLabels({});
  state.step = step;
  state.stepAt = Date.now();
  track('phase', { step });
  state.questionIndex = 0;
  state.feedback = null;
  log('step', step);
  render();
}

function render() {
  if (!state) return;
  const { puzzle } = state;
  const done = state.step === 'resumen' || state.step === 'remate';
  const header = h(
    'div',
    { class: 'puzzle-head' },
    h('div', {},
      h('span', { class: `side side-${puzzle.heroColor}` }, `Juegan ${COLOR_NAMES[puzzle.heroColor]}`),
      h('span', { class: 'muted' }, ` · Rival: ${puzzle.lastMove?.san} · Puzzle ${puzzle.id}${done ? ` (${puzzle.rating})` : ''}`),
    ),
    nextButton(done),
  );
  const steps = state.flow.map((id) => [id, id === 'estrategia' && state.plan.endgame ? 'Final' : STEP_LABELS[id]]);
  // "¿Qué permite?" y el remate son pasos intermedios: se marcan sobre el paso más cercano.
  const shown = { permite: 'resolver', remate: 'resumen' }[state.step] ?? state.step;
  const idx = steps.findIndex(([id]) => id === shown);
  const stepper = h('ol', { class: 'stepper' }, steps.map(([id, label], i) => h('li', { class: i < idx ? 'done' : i === idx ? 'current' : '' }, label)));

  const views = { calma, cambios, vistazo, candidatas, tactica, estrategia, calculo, decision, permite, resolver, resumen, intuicion, comprobacion, remate };
  panel.replaceChildren(header, stepper, views[state.step]());
  if (DEBUG) panel.append(h('details', { class: 'debug' }, h('summary', {}, 'Depuración'), h('pre', {}, JSON.stringify({ ...state, plan: undefined }, null, 2))));
  syncBoard();
}

function nextButton(done) {
  const pending = state.srsSession ? dueReviews(loadProgress(), Date.now()).filter((r) => r.id !== state.puzzle.id).length : 0;
  if (pending) {
    return h('button', { class: done ? 'primary next' : 'next', onClick: () => startReviewSession(state.puzzle.id) }, `Siguiente repaso (${pending}) →`);
  }
  return h('button', { class: done ? 'primary next' : 'next', title: done ? '' : 'Pasa a otro ejercicio sin terminar este', onClick: () => loadPuzzle() }, 'Siguiente ejercicio →');
}

// Pasos que gestionan sus propias marcas en el tablero.
const MARK_STEPS = ['tactica', 'estrategia', 'cambios'];

function syncBoard() {
  const { step } = state;
  // El tablero siempre refleja la posición del ejercicio actual (salvo en el repaso, que navega).
  if (step === 'remate') {
    const f = state.finale;
    board.setPosition(f.fen, { orientation: state.puzzle.heroColor, lastMove: f.lastMove });
    board.setInteractive(f.status === 'playing' && !f.thinking);
    board.setArrows([]);
    board.setMarks({});
    renderBoardNav();
    return;
  }
  const entry = activeEntry();
  if (entry) {
    // Tablero quieto: las jugadas se generan desde la posición que tienes en la cabeza.
    board.setPosition(entry.startFen, { orientation: state.puzzle.heroColor, lastMove: state.lastMove });
    board.setMoveFen(entryLine(entry).fen, { showTargets: false });
    board.setInteractive(!entryLine(entry).over);
    board.setPickMode(false);
    board.setArrows(lineArrows(entry));
    board.setMarks({});
    renderBoardMode();
    renderBoardNav();
    return;
  }
  board.setMoveFen(null);
  if (state.step === 'resolver' && state.blind) {
    // Preguntas o revisión de la línea a ciegas: el tablero sigue quieto.
    if (state.blind.phase === 'questions') board.setPosition(state.blind.entry.startFen, { orientation: state.puzzle.heroColor, lastMove: state.lastMove });
    board.setInteractive(false);
    board.setPickMode(Boolean(state.pointing));
    if (state.blind.phase === 'questions') board.setArrows(lineArrows(state.blind.entry));
    renderBoardMode();
    renderBoardNav();
    return;
  }
  if (step === 'permite') board.setPosition(state.safety.fenAfter, { orientation: state.puzzle.heroColor, lastMove: state.safety.lastMove });
  else if (step !== 'resumen') board.setPosition(state.playFen, { orientation: state.puzzle.heroColor, lastMove: state.lastMove });
  board.setInteractive((['candidatas', 'intuicion', 'decision', 'resolver'].includes(step) || (step === 'vistazo' && !state.glance) || (step === 'permite' && state.safety?.guess === undefined)) && !(step === 'resolver' && (state.revealed || state.ply >= state.puzzle.solution.length)));
  board.setPickMode(Boolean(state.pointing));
  if (step === 'candidatas' || step === 'decision') {
    board.setArrows(state.candidates.map((c) => ({ from: c.move.from, to: c.move.to, tone: 'candidate' })));
  } else if (step === 'comprobacion' && state.intuition) {
    board.setArrows([{ from: state.intuition.move.from, to: state.intuition.move.to, tone: 'candidate' }]);
  } else if (!MARK_STEPS.includes(step)) {
    board.setArrows([]);
  }
  if (step === 'resolver' && state.hint >= 2) {
    const expected = state.puzzle.solution[state.ply];
    board.setMarks(state.hint >= 3 ? { [expected.slice(0, 2)]: 'info', [expected.slice(2, 4)]: 'good' } : { [expected.slice(0, 2)]: 'info' });
  } else if (!MARK_STEPS.includes(step) && !state.pointing) board.setMarks({});
  if (step === 'resumen' && state.review) {
    const pos = state.review.positions[state.review.index];
    board.setPosition(pos.fen, { lastMove: pos.lastMove });
    const focus = state.engineFocus;
    const best = settings.engineOn ? state.review.evals.get(pos.fen)?.pv?.[0] : null;
    if (focus && state.review.index === state.review.puzzleIndex) board.setArrows([{ from: focus.uci.slice(0, 2), to: focus.uci.slice(2, 4), tone: focus.tone }]);
    else if (best) board.setArrows([{ from: best.slice(0, 2), to: best.slice(2, 4), tone: 'good' }]);
    else board.setArrows([]);
  }
  renderBoardMode();
  renderBoardNav();
}

/** Qué hace un clic en el tablero en cada momento. */
function clickMode() {
  const { step } = state;
  if (state.pointing) return { kind: 'pick', text: 'Clic: señalar casillas (otra vez para quitarla)' };
  if (activeEntry()) return { kind: 'line', text: 'Clic: introducir la línea (el tablero no se mueve)' };
  switch (step) {
    case 'candidatas':
      return { kind: 'candidate', text: 'Clic: apuntar candidata (no se juega)' };
    case 'intuicion':
      return { kind: 'candidate', text: 'Clic: marcar tu jugada (aún no se juega)' };
    case 'vistazo':
      return state.glance ? { kind: 'none', text: 'El tablero está quieto' } : { kind: 'candidate', text: 'Clic: tu primera jugada (no se juega)' };
    case 'decision':
      return state.addingCandidate ? { kind: 'candidate', text: 'Clic: apuntar candidata (no se juega)' } : { kind: 'move', text: 'Clic: jugar' };
    case 'comprobacion':
      return { kind: 'move', text: 'Clic: jugar' };
    case 'permite':
      return state.safety?.guess === undefined ? { kind: 'rival', text: 'Clic: juega la respuesta del rival que más te preocupa' } : { kind: 'none', text: 'El tablero está quieto' };
    case 'resolver':
      if (state.revealed || state.ply >= state.puzzle.solution.length) return { kind: 'none', text: 'El tablero está quieto' };
      if (state.predict) return { kind: 'rival', text: 'Clic: juega la respuesta que esperas del rival' };
      return { kind: 'move', text: 'Clic: jugar' };
    case 'remate':
      return { kind: 'move', text: 'Clic: jugar contra Stockfish' };
    case 'resumen':
      return { kind: 'none', text: 'Navega con los botones o las flechas del teclado' };
    default:
      return { kind: 'none', text: 'El tablero está quieto: mira sin mover' };
  }
}

function renderBoardMode() {
  if (!state) {
    boardMode.hidden = true;
    return;
  }
  const mode = clickMode();
  boardMode.hidden = false;
  boardMode.replaceChildren(
    h('span', { class: `mode-chip mode-${mode.kind}` }, { move: 'Mover', candidate: 'Apuntar', pick: 'Señalar', rival: 'Rival', line: 'A ciegas', none: 'Quieto' }[mode.kind]),
    h('span', {}, mode.text),
    h('span', { class: 'muted small mode-draw' }, ' · Botón derecho: dibujar flechas y círculos'),
  );
}

function onBoardPick(sq) {
  if (!state?.pointing) return;
  state.pointing.onPick(sq);
}

// ------------------------------------------- navegación por la partida (repaso)

/** Todas las posiciones: desde el inicio de la partida, pasando por el ejercicio, hasta el final de la solución. */
function buildReview(puzzle) {
  const chess = load(new Chess().fen());
  const positions = [{ fen: chess.fen(), lastMove: null, label: 'Posición inicial' }];
  const push = (m) => {
    const ply = positions.length;
    const label = `${Math.ceil(ply / 2)}${ply % 2 ? '.' : '...'} ${m.san}`;
    positions.push({ fen: chess.fen(), lastMove: { from: m.from, to: m.to }, label });
  };
  for (const san of puzzle.gameMoves) push(chess.move(san));
  const puzzleIndex = positions.length - 1;
  for (const uci of puzzle.solution) push(chess.move(uciToMove(uci)));
  // Explicación de cada jugada de la solución, indexada por la posición a la que lleva.
  const explanations = new Map(explainLine(puzzle.fen, puzzle.solution).map((p, i) => [puzzleIndex + 1 + i, p]));
  return { positions, puzzleIndex, index: positions.length - 1, evals: new Map(), explanations, alternatives: new Map() };
}

let explainTimer = null;
function stopExplaining() {
  clearInterval(explainTimer);
  explainTimer = null;
}

/** Recorre la solución desde la posición del ejercicio, explicando cada jugada. */
function explainSolution() {
  stopExplaining();
  const review = state.review;
  navigate(review.puzzleIndex);
  explainTimer = setInterval(() => {
    if (state?.review !== review || review.index >= review.positions.length - 1) return stopExplaining();
    navigate(review.index + 1, { keepExplaining: true });
  }, 2500);
}

function navigate(index, { keepExplaining = false } = {}) {
  if (!state?.review || state.step !== 'resumen') return;
  if (!keepExplaining) stopExplaining();
  const { positions } = state.review;
  state.review.index = Math.max(0, Math.min(positions.length - 1, index));
  state.engineFocus = null;
  board.setArrows([]);
  syncBoard();
  if (settings.engineOn) {
    evaluateShownPosition();
    findAlternatives();
  }
}

/** Defensas alternativas del rival en la jugada mostrada (Stockfish, 3 mejores). */
async function findAlternatives() {
  const review = state.review;
  const ply = review.explanations.get(review.index);
  if (!ply || ply.by !== 'rival' || review.alternatives.has(ply.fenBefore)) return;
  review.alternatives.set(ply.fenBefore, undefined);
  const run = engineRun;
  try {
    engine ??= new StockfishEngine();
    const r = await engine.evaluate(ply.fenBefore, { depth: 12, multipv: 3 });
    if (run !== engineRun || state.review !== review) return;
    review.alternatives.set(ply.fenBefore, r.top);
  } catch (err) {
    console.error(err);
    review.alternatives.set(ply.fenBefore, null);
  }
  if (state.review === review) renderBoardNav();
}

function explanationBox(review) {
  const ply = review.explanations.get(review.index);
  if (!ply) return null;
  const children = [h('div', {}, h('span', { class: `who who-${ply.by}` }, ply.by === 'you' ? 'Tú' : 'Rival'), ' ', narratePly(ply))];
  if (ply.by === 'rival' && settings.engineOn) {
    const alts = review.alternatives.get(ply.fenBefore);
    if (alts === undefined) children.push(h('div', { class: 'muted small' }, 'Buscando otras defensas del rival…'));
    else if (alts?.length > 1) {
      // Las puntuaciones son del rival: se dan la vuelta para leerlas desde tu lado.
      const mine = (sc) => (sc.mate != null ? { mate: -sc.mate } : { cp: -sc.cp });
      children.push(h('div', { class: 'small' }, '¿Y si defiende de otra forma? ',
        alts.map((a, i) => {
          const san = pvToSan(ply.fenBefore, a.pv, 1)[0];
          const sc = mine(a.score);
          return h('span', { class: 'alt' }, `${i ? ' · ' : ''}${san}${san === ply.san ? ' (la de la partida)' : ''}: ${formatScore(sc)} ${describeAdvantage(sc)}`);
        }),
      ));
    } else if (alts?.length === 1) children.push(h('div', { class: 'muted small' }, 'No tenía otra defensa razonable.'));
  }
  return h('div', { class: 'explain' }, ...children);
}

const boardNav = $('#board-nav');

function renderBoardNav() {
  const review = state?.step === 'resumen' ? state.review : null;
  boardNav.hidden = !review;
  if (!review) return;
  const { positions, index, puzzleIndex } = review;
  const pos = positions[index];
  const btn = (label, title, target, disabled) => h('button', { title, 'aria-label': title, disabled, onClick: () => navigate(target) }, label);
  const where = index === puzzleIndex ? ' · posición del ejercicio' : index > puzzleIndex ? ' · solución' : '';
  const ev = settings.engineOn ? review.evals.get(pos.fen) : null;
  boardNav.replaceChildren(
    h('div', { class: 'nav-buttons' },
      btn('⏮', 'Posición inicial', 0, index === 0),
      btn('◀', 'Jugada anterior', index - 1, index === 0),
      btn('Ejercicio', 'Ir a la posición del ejercicio', puzzleIndex, index === puzzleIndex),
      btn('▶', 'Jugada siguiente', index + 1, index === positions.length - 1),
      btn('⏭', 'Final', positions.length - 1, index === positions.length - 1),
    ),
    h('div', { class: 'nav-label' }, h('strong', {}, pos.label), h('span', { class: 'muted' }, where)),
    ...[explanationBox(review)].filter(Boolean),
    ...(settings.engineOn ? [advantageBar(ev), h('div', { class: 'nav-eval muted small' }, positionEvalText(ev, pos.fen))] : []),
  );
}

/** Puntuación de una evaluación de posición desde el punto de vista de quien resuelve. */
function heroScore(ev) {
  if (!ev) return null;
  return ev.toMove === state.puzzle.heroColor ? ev.score : ev.score.mate != null ? { mate: -ev.score.mate } : { cp: -ev.score.cp };
}

/** Barra de ventaja tipo Lichess: tu parte en tu color, de izquierda a derecha. */
function advantageBar(ev) {
  const score = heroScore(ev);
  const share = Math.round(winChance(score) * 100);
  const hero = state.puzzle.heroColor === 'w' ? 'white' : 'black';
  return h('div', { class: `adv-bar hero-${hero}`, role: 'img', 'aria-label': score ? describeAdvantage(score) : 'sin evaluación' },
    h('div', { class: 'adv-fill', style: `width: ${score ? share : 50}%` }),
    h('span', { class: 'adv-text' }, score ? `${formatScore(score)} · ${describeAdvantage(score)}` : '…'),
  );
}

function positionEvalText(ev, fen) {
  if (ev === undefined) return 'Evaluando la posición…';
  if (ev === null) return load(fen).isGameOver() ? 'Partida terminada.' : 'Sin evaluación para esta posición.';
  const best = pvToSan(fen, ev.pv, 4);
  const mover = ev.toMove === state.puzzle.heroColor ? 'Tu mejor jugada' : 'Mejor jugada del rival';
  return `${mover}: ${best[0] ?? '—'}${best.length > 1 ? ` (${best.join(' ')})` : ''} · ${ev.via === 'cloud' ? 'nube de Lichess' : 'Stockfish'}`;
}

let positionTimer = null;
function evaluateShownPosition() {
  clearTimeout(positionTimer);
  const review = state.review;
  const { fen } = review.positions[review.index];
  if (review.evals.has(fen)) return;
  const run = engineRun;
  positionTimer = setTimeout(async () => {
    try {
      engine ??= new StockfishEngine();
      const ev = await evaluatePosition(settings.engineSource, fen, { engine, depth: 12 });
      if (run !== engineRun || state.review !== review) return;
      review.evals.set(fen, ev);
    } catch (err) {
      console.error(err);
      if (run === engineRun) review.evals.set(fen, null);
    }
    if (state.review === review) syncBoard();
  }, 250);
}

document.addEventListener('keydown', (ev) => {
  if (state?.step !== 'resumen' || ['INPUT', 'TEXTAREA', 'SELECT'].includes(ev.target.tagName)) return;
  const { index, positions } = state.review ?? {};
  const target = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: positions?.length - 1 }[ev.key];
  if (target === undefined) return;
  ev.preventDefault();
  navigate(target);
});

// --------------------------------------------------------------- paso: calma

function calma() {
  stopTimer();
  let left = BREATHING.total;
  const phase = h('div', { class: 'breath-phase' }, 'Inhala');
  const circle = h('div', { class: 'breath-circle inhale' });
  const counter = h('div', { class: 'muted' }, `${left} s`);
  let t = 0;
  timer = setInterval(() => {
    t++;
    left--;
    const cycle = t % (BREATHING.inhale + BREATHING.exhale);
    const inhaling = cycle < BREATHING.inhale;
    phase.textContent = inhaling ? 'Inhala' : 'Exhala';
    circle.className = `breath-circle ${inhaling ? 'inhale' : 'exhale'}`;
    counter.textContent = `${left} s`;
    if (left <= 0) go(nextStep('calma'));
  }, 1000);
  return h(
    'section',
    {},
    h('h2', {}, `${stepNo('calma')}. Respira y mira la posición sin pensar`),
    h('p', {}, `Inhala ${BREATHING.inhale} segundos, exhala ${BREATHING.exhale}. No calcules: deja que la intuición trabaje. Así evitas jugar "al toque", que es donde nacen muchos errores.`),
    h('div', { class: 'breath' }, circle, phase, counter),
    h('label', { class: 'block' }, '¿Qué te llama la atención? (opcional)', h('textarea', { rows: 2, onInput: (e) => (state.firstImpression = e.target.value) }, state.firstImpression ?? '')),
    h('button', { onClick: () => go(nextStep('calma')) }, 'Estoy listo/a'),
  );
}

// ------------------------------------------- señalar casillas en el tablero

/** Empieza una respuesta "señalando": cada clic marca o desmarca una casilla. */
function beginPointing() {
  state.pointing = {
    picks: [],
    startedAt: Date.now(),
    onPick(sq) {
      const p = state.pointing;
      const i = p.picks.indexOf(sq);
      if (i >= 0) p.picks.splice(i, 1);
      else if (p.max && p.picks.length >= p.max) return;
      else p.picks.push(sq);
      board.setMarks(Object.fromEntries(p.picks.map((x) => [x, 'pick'])));
      const counter = document.getElementById('pick-count');
      if (counter) counter.textContent = pickCountText(p.picks.length);
    },
  };
  board.setMarks({});
  board.setArrows([]);
}

const pickCountText = (n) => (n ? `${n} ${n === 1 ? 'casilla señalada' : 'casillas señaladas'}` : 'Ninguna casilla señalada');

/** Termina la respuesta y la corrige contra los hallazgos; deja las marcas de colores. */
function endPointing(findings) {
  const p = state.pointing;
  state.pointing = null;
  const result = { ...scorePicks(findings, p?.picks ?? []), picks: [...(p?.picks ?? [])], ms: Date.now() - (p?.startedAt ?? Date.now()) };
  showPointingResult(findings, result);
  return result;
}

/** Verde: encontrado; rojo: lo que se escapó; gris: falsas alarmas. */
function showPointingResult(findings, result) {
  const marks = {};
  for (const f of result.missed) for (const sq of f.targets) marks[sq] ??= 'missed';
  for (const f of result.found) for (const sq of f.targets) if (result.picks.includes(sq) || f.match === 'all') marks[sq] = 'found';
  for (const sq of result.falseAlarms) marks[sq] = 'false';
  board.setMarks(marks);
}

/** Frase del resultado: "Has encontrado 3 de 4 en 9 s". */
function pointingSummary(result) {
  const secs = Math.round(result.ms / 1000);
  const fa = result.falseAlarms.length ? ` · ${result.falseAlarms.length} ${result.falseAlarms.length === 1 ? 'falsa alarma' : 'falsas alarmas'}` : '';
  if (!result.required) return result.falseAlarms.length ? `No había nada que señalar${fa} (${secs} s).` : `Correcto: no había nada (${secs} s).`;
  return `Has encontrado ${result.found.length} de ${result.required} en ${secs} s${fa}.`;
}

/** Botones del modo señalar: contador, "Listo", "No hay nada" y borrar. */
function pointingControls(onDone) {
  const n = state.pointing?.picks.length ?? 0;
  return h('div', { class: 'pointing' },
    h('p', { class: 'small' }, h('span', { id: 'pick-count' }, pickCountText(n)), ' · toca otra vez una casilla para quitarla.'),
    h('div', { class: 'actions' },
      h('button', { class: 'primary', 'data-key': 'enter', onClick: () => onDone(false) }, 'Listo'),
      h('button', { 'data-key': 'n', onClick: () => { if (state.pointing) state.pointing.picks = []; onDone(true); } }, 'No hay nada'),
      h('button', { class: 'link', onClick: () => { if (!state.pointing) return; state.pointing.picks = []; board.setMarks({}); document.getElementById('pick-count').textContent = pickCountText(0); } }, 'Borrar'),
    ),
  );
}

// ------------------------------------------------ paso: ¿qué ha cambiado?

function cambios() {
  const { puzzle } = state;
  const hero = puzzle.heroColor;
  state.change ??= (() => {
    const diff = lastMoveDiff(puzzle.fenBefore, puzzle.fen, puzzle.lastMove);
    return { diff, findings: changeFindings(diff, hero), result: null };
  })();
  const ch = state.change;
  const next = () => {
    state.pointing = null;
    board.setMarks({});
    go(nextStep('cambios'));
  };
  const children = [
    h('h2', {}, `${stepNo('cambios')}. ¿Qué ha cambiado con ${puzzle.lastMove.san}?`),
    h('p', {}, 'Antes de buscar jugadas, mira la jugada del rival. Señala en el tablero qué ataca ahora la pieza que se movió, qué dejó de defender, qué línea abrió al irse (descubierta) y qué línea cortó al llegar.'),
    h('div', { class: 'actions' },
      h('button', {
        title: 'Mantén pulsado para ver la posición antes de la jugada del rival',
        onPointerdown: () => board.setPosition(puzzle.fenBefore, { orientation: hero }),
        onPointerup: () => syncBoard(),
        onPointerleave: () => syncBoard(),
      }, 'Ver la posición anterior (mantén pulsado)'),
    ),
  ];
  if (!ch.result) {
    if (!state.pointing) beginPointing();
    children.push(
      pointingControls(() => {
        ch.result = endPointing(ch.findings);
        log('cambios', ch.result);
        render();
        showPointingResult(ch.findings, ch.result);
      }),
      h('div', { class: 'actions' }, h('button', { class: 'link', onClick: next }, 'Saltar este paso')),
    );
  } else {
    children.push(
      h('p', { class: ch.result.correct ? 'ok' : 'ko' }, pointingSummary(ch.result)),
      ch.findings.length ? findingsList(ch.findings) : h('p', { class: 'muted' }, 'La jugada no cambia ataques ni defensas a simple vista.'),
      h('p', { class: 'muted small' }, 'Verde: lo que encontraste. Rojo: lo que se te escapó. Gris: casillas que no tenían que ver.'),
      h('div', { class: 'actions' }, h('button', { class: 'primary', 'data-key': 'enter', onClick: next }, 'Seguir')),
    );
  }
  return h('section', {}, ...children);
}

// ------------------------------------------------- paso: golpe de vista

function vistazo() {
  stopTimer();
  const g = state.glance;
  const next = () => go(nextStep('vistazo'));
  if (!g) {
    let left = GLANCE_SECONDS;
    const counter = h('div', { class: 'countdown' }, String(left));
    timer = setInterval(() => {
      left--;
      counter.textContent = String(Math.max(left, 0));
      counter.classList.toggle('urgent', left <= 3);
      if (left <= 0) {
        state.glance = { none: true };
        render();
      }
    }, 1000);
    return h('section', {},
      h('h2', {}, `${stepNo('vistazo')}. Golpe de vista: ${GLANCE_SECONDS} segundos`),
      h('p', {}, 'Mueve en el tablero la primera jugada que te salga, sin pensar. No se juega: entra como tu candidata 1 ("intuición") y al final verás si tu intuición acertó.'),
      counter,
      h('div', { class: 'actions' }, h('button', { class: 'link', onClick: () => { state.glance = { none: true, skipped: true }; next(); } }, 'Saltar')),
    );
  }
  if (g.none) {
    return h('section', {},
      h('h2', {}, `${stepNo('vistazo')}. Golpe de vista`),
      h('p', {}, 'No ha salido ninguna jugada: no pasa nada, a veces la posición pide pensar.'),
      h('div', { class: 'actions' }, h('button', { class: 'primary', 'data-key': 'enter', onClick: next }, 'Seguir')),
    );
  }
  const pick = (confidence) => {
    g.confidence = confidence;
    g.ms = g.ms ?? 0;
    // Entra como candidata 1, etiquetada como intuición.
    const ev = evaluateWithIdea(state.puzzle.fen, g.move);
    if (ev && !state.candidates.some((c) => c.uci === ev.uci)) state.candidates.unshift({ ...ev, source: 'intuicion' });
    track('candidate', { uci: g.uci, source: 'intuicion' });
    next();
  };
  return h('section', {},
    h('h2', {}, `${stepNo('vistazo')}. Golpe de vista: ${g.san}`),
    h('p', {}, '¿Qué seguridad tienes en esta jugada? Sé sincero/a: así se mide si tu intuición está bien calibrada.'),
    h('div', { class: 'actions' }, Object.entries(CONFIDENCE).map(([id, c], i) => h('button', { 'data-key': String(i + 1), onClick: () => pick(id) }, `${c.label} (${Math.round(c.p * 100)} %)`))),
  );
}

/** Tarjeta del resumen: qué pasó con tu golpe de vista. */
function glanceCard() {
  const g = state.glance;
  if (!g?.uci || !g.confidence) return null;
  const kase = state.glanceCase;
  return h('div', { class: 'glance-card' },
    h('strong', {}, `Tu golpe de vista: ${g.san} (${CONFIDENCE[g.confidence].label.toLowerCase()})`),
    h('ul', { class: 'cases' }, Object.entries(GLANCE_CASES).map(([id, c]) => h('li', { class: id === kase ? `current tone-${c.tone}` : '' }, h('strong', {}, c.label), id === kase ? ` · ${c.text}` : null))),
    kase === 'otra' ? h('p', { class: 'small' }, 'Tu intuición falló y tu primera jugada tampoco fue la clave: el método no llegó a corregirla.') : null,
  );
}

// ---------------------------------------------------------- paso: candidatas

/** evaluateMove + la idea forzada de varias jugadas que empieza con esa jugada. */
function evaluateWithIdea(fen, move) {
  const ev = evaluateMove(fen, move);
  if (!ev) return null;
  const idea = findForcingIdea(fen, { firstMove: ev.move, maxMs: 300 });
  if (idea) {
    ev.idea = idea;
    ev.tags.push({ q: idea.mate ? 'mate' : 'geometria', text: `idea forzada de ${idea.moves} jugadas: ${describeIdea(idea, { moves: false })}` });
    ev.yesCount = new Set(ev.tags.map((t) => t.q)).size;
  }
  return ev;
}

function addCandidate(move) {
  const ev = evaluateWithIdea(state.puzzle.fen, withPromotion(move, 0));
  if (ev && state.candidates.length < MAX_CANDIDATES && !state.candidates.some((c) => c.uci === ev.uci)) {
    state.candidates.push(ev);
    track('candidate', { uci: ev.uci });
  }
  render();
}

function candidateList(removable) {
  if (!state.candidates.length) return h('p', { class: 'muted' }, 'Todavía no hay candidatas.');
  return h(
    'ol',
    { class: 'candidates' },
    state.candidates.map((c, i) =>
      h(
        'li',
        {},
        h('strong', {}, c.san),
        c.source === 'intuicion' ? h('span', { class: 'muted small' }, ' (intuición)') : null,
        removable &&
          h('button', {
            class: 'link',
            onClick: () => {
              track('removeCandidate', { uci: state.candidates[i].uci });
              state.candidates.splice(i, 1);
              render();
            },
          }, 'quitar'),
      ),
    ),
  );
}

function candidatas() {
  const sweep = state.sweep;
  return h(
    'section',
    {},
    h('h2', {}, `${stepNo('candidatas')}. Hasta ${MAX_CANDIDATES} jugadas candidatas, sin calcular`),
    h('p', {}, 'Mueve en el tablero las jugadas que se te ocurran (no se juegan, solo se apuntan). No entres en variantes todavía: muchos cálculos acaban en líneas que nunca aparecen.'),
    candidateList(true),
    sweep ? sweepView(sweep) : null,
    h('div', { class: 'actions' },
      sweep
        ? h('button', { class: 'primary', onClick: () => go('tactica') }, 'Ya lo he revisado: pasar a las preguntas')
        : h('button', { class: 'primary', onClick: startSweep }, state.candidates.length ? 'Pasar a las preguntas' : 'No se me ocurre nada: hazme preguntas'),
    ),
    h('p', { class: 'muted small' }, 'Si no te convence lo que ves, las preguntas te ayudarán a generar candidatas.'),
  );
}

/** Barrido final: cuántos jaques, capturas y amenazas hay, sin decir cuáles. */
function startSweep() {
  const fen = state.puzzle.fen;
  const mine = forcingSweep(fen);
  const theirs = forcingSweep(withTurn(fen, state.puzzle.heroColor === 'w' ? 'b' : 'w'));
  state.sweep = { mine, theirs };
  log('sweep', state.sweep);
  render();
}

function sweepView({ mine, theirs }) {
  const picked = (list) => list.filter((m) => state.candidates.some((c) => c.move.from === m.from && c.move.to === m.to)).length;
  const pieces = (list) => [...new Set(list.map((m) => PIECE_NAMES[m.piece]))].join(', ');
  const row = (label, list) => {
    const n = picked(list);
    const warn = list.length > 0 && n === 0;
    return h('li', { class: warn ? 'warn' : '' },
      h('strong', {}, `${label}: ${list.length}`),
      list.length ? ` (con ${pieces(list)})` : '',
      ` · en tus candidatas: ${n}`,
      warn ? h('span', { class: 'ko' }, ' ⚠ no has apuntado ninguno') : null,
    );
  };
  const missing = [mine.checks, mine.captures, mine.threats].some((l) => l.length && !picked(l));
  return h('div', { class: 'sweep' },
    h('h3', {}, 'Barrido antes de seguir: jaques, capturas y amenazas'),
    h('ul', {}, row('Jaques', mine.checks), row('Capturas', mine.captures), row('Amenazas', mine.threats)),
    h('p', { class: 'small' }, `El rival, si le tocara mover, tendría ${theirs.checks.length} jaque(s), ${theirs.captures.length} captura(s) y ${theirs.threats.length} amenaza(s).`),
    h('p', { class: missing ? 'ko small' : 'ok small' }, missing
      ? 'Te falta revisar alguna categoría. Puedes añadir candidatas en el tablero antes de seguir.'
      : 'Has tenido en cuenta todas las categorías forzantes.'),
  );
}

// ------------------------------------------------------- preguntas (táctica)

// Preguntas que se pueden responder señalando en el tablero.
const POINTABLE = new Set(['mate', 'desprotegidas', 'amenazadas', 'geometria', 'debilidades']);
// Preguntas en las que se toca una pieza y la casilla donde la quieres.
const ROUTE_QUESTIONS = new Set(['peorPieza', 'casillas']);
const POINT_PROMPTS = {
  mate: 'Juega en el tablero el mate (toca origen y destino), tuyo o del rival. Si no hay, pulsa "No hay nada".',
  desprotegidas: 'Toca las piezas sin ningún defensor, de los dos colores.',
  amenazadas: 'Toca las piezas que se pierden en el cambio (de los dos colores): la pieza amenazada, no quien la ataca.',
  geometria: 'Toca las piezas clavadas, enfiladas o atacadas a la vez (o la casilla del ataque doble), de los dos colores.',
  debilidades: 'Marca hasta 3 debilidades: peones aislados o doblados, un rey expuesto.',
};

function questionView(questions, title, intro, onDone) {
  const q = questions[state.questionIndex];
  if (!q) {
    onDone();
    return h('div');
  }
  const answer = state.answers[q.id];
  const pointing = settings.pointAnswers && POINTABLE.has(q.id);
  const children = [
    h('h2', {}, title),
    intro && h('p', { class: 'muted' }, intro),
    h('p', { class: 'progress' }, `Pregunta ${state.questionIndex + 1} de ${questions.length}`),
    h('h3', {}, q.text),
    h('p', { class: 'hint' }, q.hint),
  ];
  const result = () => answerQuestion(q.id, state.puzzle.fen, state.puzzle.heroColor);
  if (!answer) {
    const askedAt = state.questionAskedAt?.[q.id] ?? Date.now();
    state.questionAskedAt = { ...state.questionAskedAt, [q.id]: askedAt };
    const pick = (user) => {
      const r = result();
      state.answers[q.id] = { user, result: r, ms: Date.now() - askedAt };
      track('answer', { q: q.id, user });
      log('question', q.id, { user, result: r });
      render();
      showFindings(r.findings);
    };
    if (pointing) {
      if (!state.pointing) beginPointing();
      if (q.id === 'debilidades') state.pointing.max = 3;
      children.push(
        h('p', {}, POINT_PROMPTS[q.id]),
        pointingControls(() => {
          const r = result();
          const pr = endPointing(r.findings);
          state.answers[q.id] = {
            user: pr.picks.length > 0,
            result: r,
            picks: pr.picks,
            pointed: { found: pr.found.length, required: pr.required, falseAlarms: pr.falseAlarms.length, ms: pr.ms, correct: pr.correct },
            pointResult: pr,
          };
          track('answer', { q: q.id, user: pr.picks.length > 0, found: pr.found.length, required: pr.required });
          log('question', q.id, pr);
          render();
          showPointingResult(r.findings, pr);
        }),
      );
    } else if (q.open) {
      const note = h('textarea', { rows: 2, placeholder: 'Escribe tu idea (opcional)' });
      if (ROUTE_QUESTIONS.has(q.id)) {
        if (!state.pointing) beginPointing();
        state.pointing.max = 2;
        children.push(h('p', { class: 'small' }, 'Opcional: toca una de tus piezas y después la casilla donde la quieres. Te enseñaré la ruta.'));
      }
      children.push(
        h('label', { class: 'block' }, 'Tu respuesta:', note),
        h('div', { class: 'actions' }, h('button', {
          class: 'primary',
          'data-key': 'enter',
          onClick: () => {
            state.notes = { ...state.notes, [q.id]: note.value };
            const wish = state.pointing?.picks ?? [];
            state.pointing = null;
            if (ROUTE_QUESTIONS.has(q.id)) state.routeWish = { ...state.routeWish, [q.id]: wish };
            pick(null);
          },
        }, 'Ver el análisis')),
      );
    } else {
      children.push(h('div', { class: 'actions' },
        h('button', { 'data-key': 's', onClick: () => pick(true) }, 'Sí'),
        h('button', { 'data-key': 'n', onClick: () => pick(false) }, 'No'),
        h('button', { class: 'link', onClick: () => pick(null) }, 'No lo sé')));
    }
  } else {
    const { user, result: r, pointResult } = answer;
    let verdictText;
    let ok;
    if (pointResult) {
      verdictText = pointingSummary(pointResult);
      ok = pointResult.correct;
    } else {
      verdictText = q.open
        ? 'Pregunta abierta: no hay respuesta correcta o incorrecta. Contrasta tu idea con esto:'
        : user === null ? 'Lo importante es hacerse la pregunta. Mira lo que hay:' : user === r.yes ? '¡Bien visto!' : r.yes ? 'Había algo: revisa con calma.' : 'Esta vez no había nada relevante.';
      ok = q.open || user === r.yes;
    }
    children.push(
      q.open && state.notes?.[q.id] ? h('p', {}, h('strong', {}, 'Tu idea: '), state.notes[q.id]) : null,
      h('p', { class: `verdict ${ok ? 'ok' : 'ko'}` }, verdictText),
      findingsList(r.findings, pointResult),
      h('p', { class: 'muted small' }, pointResult
        ? 'Verde: lo que encontraste. Rojo: lo que se te escapó (con su explicación). Gris: falsas alarmas. Pulsa una línea para verla.'
        : 'Pulsa una línea para verla en el tablero. Verde: a tu favor. Rojo: peligro para ti.'),
      q.id === 'debilidades' ? controlMapView() : null,
      ROUTE_QUESTIONS.has(q.id) ? routeView(q.id) : null,
      h('div', { class: 'actions' },
        h('button', { class: 'primary', 'data-key': 'enter', onClick: () => { state.questionIndex++; state.routeShown = null; board.setMarks({}); board.setTints({}); board.setLabels({}); render(); } }, state.questionIndex + 1 < questions.length ? 'Siguiente pregunta' : 'Continuar'),
      ),
    );
    if (state.step === 'tactica' || state.step === 'estrategia') children.push(candidateReminder());
  }
  return h('section', {}, ...children);
}

/** "Ver control": tiñe cada casilla según qué bando la controla, con agujeros y puestos avanzados. */
function controlMapView() {
  const on = state.controlShown;
  const toggle = () => {
    state.controlShown = !state.controlShown;
    if (state.controlShown) {
      const chess = load(state.puzzle.fen);
      const control = squareControl(chess);
      const tints = {};
      for (const [sq, c] of Object.entries(control)) if (c.owner) tints[sq] = c.owner;
      const hero = state.puzzle.heroColor;
      for (const c of ['w', 'b']) for (const sq of holes(chess, c).slice(0, 6)) tints[sq] = 'hole';
      for (const sq of outposts(chess, hero)) tints[sq] = 'outpost';
      board.setTints(tints);
    } else board.setTints({});
    render();
  };
  return h('div', { class: 'control-map' },
    h('button', { 'aria-pressed': String(Boolean(on)), onClick: toggle }, on ? 'Ocultar control' : 'Ver control'),
    on ? h('p', { class: 'small' }, 'Claro: casillas que controlan las blancas. Oscuro: las negras. Rayado: disputadas. ○ agujero (ningún peón puede defenderla). ★ puesto avanzado para ti.') : null,
  );
}

/** Ruta de la pieza: la que elegiste y las 3 mejores casillas según el análisis. */
function routeView(qid) {
  const fen = state.puzzle.fen;
  const hero = state.puzzle.heroColor;
  const [pieceSq, wishSq] = state.routeWish?.[qid] ?? [];
  const chess = load(fen);
  const own = pieceSq && chess.get(pieceSq)?.color === hero ? pieceSq : null;
  const subject = own ?? worstPieceSquare(fen, hero);
  if (!subject) return null;
  const routes = pieceRoutes(fen, subject, { to: own ? wishSq : undefined });
  if (!routes.piece) return null;
  const label = `${PIECE_NAMES[routes.piece.type]} de ${subject}`;
  const show = (r) => {
    state.routeShown = r.path.join('-');
    const arrows = r.path.slice(1).map((sq, i) => ({ from: r.path[i], to: sq, tone: 'mine', label: i + 1 }));
    board.setArrows(arrows);
    board.setMarks(Object.fromEntries(r.dangers.map((d) => [d.sq, 'bad'])));
    render();
  };
  const describe = (r) => `${r.moves} ${r.moves === 1 ? 'tiempo' : 'tiempos'} (${r.path.join(' → ')})${r.dangers.length ? ` · peligro en ${r.dangers.map((d) => `${d.sq}: ${d.why}`).join('; ')}` : ' · camino seguro'}`;
  const items = [];
  if (own && wishSq) {
    items.push(routes.to
      ? h('li', {}, h('strong', {}, `Tu idea, ${wishSq}: `), describe(routes.to), ' ', h('button', { class: 'link', onClick: () => show(routes.to) }, 'ver'))
      : h('li', {}, h('strong', {}, `Tu idea, ${wishSq}: `), 'no llega en 3 jugadas moviendo solo esa pieza.'));
  }
  routes.best.forEach((b, i) => items.push(h('li', {}, h('strong', {}, `${i + 1}. ${b.sq}${b.outpost ? ' (puesto avanzado)' : ''}: `), describe(b), ' ', h('button', { class: 'link', onClick: () => show(b) }, 'ver'))));
  return h('div', { class: 'routes' },
    h('strong', {}, `Mejores casillas para tu ${label}`),
    h('ul', {}, items),
    h('p', { class: 'muted small' }, 'Flechas numeradas: la ruta jugada a jugada. En rojo, las casillas peligrosas del camino.'),
  );
}

const worstPieceSquare = (fen, hero) => worstPieces(fen, hero)[0]?.square ?? null;

function findingsList(findings, pointResult) {
  if (!findings.length) return h('p', { class: 'muted' }, 'El análisis no encuentra nada destacable.');
  const status = (f) => (!pointResult || !f.targets?.length ? '' : pointResult.found.includes(f) ? ' found' : ' missed');
  return h('ul', { class: 'findings' }, findings.map((f) => h('li', { class: `tone-${f.tone}${status(f)}`, onClick: () => showFindings([f]) },
    status(f) === ' found' ? '✔ ' : status(f) === ' missed' ? '✘ ' : '', f.text)));
}

function showFindings(findings) {
  const marks = {};
  for (const f of findings) for (const sq of f.squares) marks[sq] ??= f.tone;
  board.setMarks(marks);
}

function candidateReminder() {
  const full = state.candidates.length >= MAX_CANDIDATES;
  return h('details', { class: 'reminder' },
    h('summary', {}, `¿Te sugiere una candidata nueva? (${state.candidates.length}/${MAX_CANDIDATES})`),
    h('p', { class: 'small' }, full
      ? `Ya tienes ${MAX_CANDIDATES} candidatas, el máximo. Para apuntar otra, en el paso de decisión quita una y pulsa "Añadir candidata".`
      : 'Recuérdala: en el paso de decisión pulsa "Añadir candidata" y muévela en el tablero. Se apunta en la tabla, no se juega.'),
    candidateList(false),
  );
}

function tactica() {
  return questionView(state.plan.tactical, `${stepNo('tactica')}. Preguntas tácticas`, `${LEVELS[settings.level].tacticalNote} Fíjate en los dos colores.`, () => queueMicrotask(() => go('estrategia')));
}

function estrategia() {
  const { plan } = state;
  const title = `${stepNo('estrategia')}. ${plan.endgame ? 'Preguntas de finales' : 'Preguntas estratégicas'}`;
  const intro = plan.endgame ? 'Sin damas en el tablero: cambian las preguntas.' : LEVELS[settings.level].strategicNote;
  const tacticalHits = plan.tactical.filter((q) => state.answers[q.id]?.result.yes).length;
  if (!state.forceStrategy && state.questionIndex === 0 && !state.answers[plan.strategic[0]?.id] && !plan.endgame && tacticalHits >= 3) {
    return h('section', {},
      h('h2', {}, title),
      h('p', {}, `Las preguntas tácticas han dado ${tacticalHits} "síes". Cuando la táctica funciona, la estrategia puede esperar.`),
      h('div', { class: 'actions' },
        h('button', { class: 'primary', onClick: () => go(nextStep('estrategia')) }, 'Ir a decidir'),
        h('button', { onClick: () => { state.forceStrategy = true; render(); } }, 'Hacer igualmente las preguntas'),
      ),
    );
  }
  return questionView(plan.strategic, title, intro, () => queueMicrotask(() => go(nextStep('estrategia'))));
}

// ------------------------------------------------------------- decisión

function decision() {
  const rows = state.candidates.map((c, i) =>
    h('tr', {},
      h('td', {}, h('strong', {}, c.san)),
      h('td', { class: 'yes' }, String(c.yesCount)),
      h('td', {}, c.tags.length ? h('ul', {}, c.tags.map((t) => h('li', {}, t.text))) : h('span', { class: 'muted' }, '—'),
        // Los avisos solo se ven después de comprobar tú qué permite la jugada.
        !settings.safetyCheck || state.checked?.has(c.uci)
          ? (c.warnings.length ? h('ul', { class: 'warnings' }, c.warnings.map((w) => h('li', {}, `⚠ ${w}`))) : null)
          : h('div', { class: 'muted small' }, 'Avisos: se ven tras «¿Qué permite?»')),
      h('td', {},
        h('button', { class: 'primary', onClick: () => playDecision(c.move) }, 'Jugar'),
        h('button', { class: 'link', onClick: () => { track('removeCandidate', { uci: c.uci }); state.candidates.splice(i, 1); render(); } }, 'quitar'),
      ),
    ),
  );
  const full = state.candidates.length >= MAX_CANDIDATES;
  const adding = state.addingCandidate;
  return h('section', {},
    h('h2', {}, `${stepNo('decision')}. Decide`),
    h('p', {}, 'La mejor jugada suele responder SÍ a varias preguntas. Compara tus candidatas y revisa los avisos (qué dejas colgado).'),
    state.candidates.length
      ? h('table', { class: 'decision' }, h('thead', {}, h('tr', {}, h('th', {}, 'Jugada'), h('th', {}, 'Síes'), h('th', {}, 'Qué consigue'), h('th', {}))), h('tbody', {}, rows))
      : h('p', { class: 'muted' }, 'No apuntaste candidatas.'),
    calcSummary(),
    h('div', { class: 'actions' },
      !state.calc?.chosen && state.candidates.length ? h('button', { onClick: () => { if (!state.flow.includes('calculo')) state.flow.splice(state.flow.indexOf('decision'), 0, 'calculo'); go('calculo'); }, title: 'Compara dos candidatas calculando sus líneas a ciegas' }, 'Comparar dos candidatas (Calcular)') : null,
      h('button', {
        class: adding ? 'toggle on' : 'toggle',
        'aria-pressed': adding ? 'true' : 'false',
        disabled: full,
        title: full ? `Máximo ${MAX_CANDIDATES} candidatas: quita una para añadir otra` : null,
        onClick: () => { state.addingCandidate = !state.addingCandidate; render(); },
      }, adding ? 'Cancelar (no añadir)' : `Añadir candidata (${state.candidates.length}/${MAX_CANDIDATES})`),
    ),
    h('p', { class: adding ? 'small adding' : 'small' }, adding
      ? 'Mueve en el tablero la jugada que te sugirieron las preguntas: se añade a la tabla, no se juega.'
      : full
        ? `Ya tienes ${MAX_CANDIDATES} candidatas: quita una para apuntar otra. Una jugada en el tablero se juega directamente.`
        : 'Una jugada en el tablero se juega directamente. Para apuntarla antes como candidata, pulsa "Añadir candidata".'),
  );
}

function playDecision(move) {
  state.addingCandidate = false;
  if (settings.safetyCheck && !state.safetySkip) return startSafety(move, 'decision');
  go('resolver');
  playUserMove(move);
}

// ---------------------------------------------- ¿qué permite mi jugada?

/** Antes de jugar: la posición tras tu jugada, con el rival al turno. */
function startSafety(move, from) {
  const full = withPromotion(move, 0);
  const chess = load(state.puzzle.fen);
  let m;
  try {
    m = chess.move(full);
  } catch {
    return undefined;
  }
  state.safety = { move: full, uci: m.from + m.to + (m.promotion ?? ''), san: m.san, fenAfter: chess.fen(), lastMove: { from: m.from, to: m.to }, from, guess: undefined, shown: false };
  return go('permite');
}

/** Lo que el rival puede hacer tras tu jugada: jaques, capturas, amenazas, mate en 1 e idea forzada. */
function safetyAnalysis(fenAfter) {
  const chess = load(fenAfter);
  const sweep = forcingSweep(fenAfter);
  const mates = chess.moves({ verbose: true }).filter((m) => m.san.endsWith('#'));
  const idea = mates.length ? null : findForcingIdea(fenAfter, { maxMs: 300 });
  const winning = sweep.captures.map((m) => ({ m, gain: seeMove(chess, m) })).filter((x) => x.gain > 0).sort((a, b) => b.gain - a.gain);
  // La respuesta más peligrosa: mate, idea forzada, captura que gana material o jaque.
  const worst = mates[0] ? { uci: uciOf(mates[0]), san: mates[0].san, why: 'da mate' }
    : idea ? { uci: idea.line[0].uci, san: idea.line[0].san, why: describeIdea(idea, { moves: true }) }
      : winning[0] ? { uci: uciOf(winning[0].m), san: winning[0].m.san, why: `gana ${winning[0].gain} punto(s) en el cambio` }
        : null;
  const forcing = new Set([...sweep.checks, ...sweep.captures, ...sweep.threats, ...mates].map(uciOf));
  return { sweep, mates, idea, worst, forcing };
}

const uciOf = (m) => m.from + m.to + (m.promotion ?? '');

function permite() {
  const sf = state.safety;
  const done = sf.guess !== undefined;
  const children = [
    h('h2', {}, `¿Qué permite ${sf.san}?`),
    h('p', {}, `El tablero muestra la posición tras ${sf.san}, con el rival al turno. Juega la respuesta del rival que más te preocupa o pulsa «No veo nada peligroso».`),
  ];
  if (!done) {
    children.push(h('div', { class: 'actions' },
      h('button', { 'data-key': 'n', onClick: () => safetyGuess(null) }, 'No veo nada peligroso'),
      h('button', { class: 'link', onClick: () => leaveSafety(false) }, 'Cambiar de jugada'),
    ));
    return h('section', {}, ...children);
  }
  const a = sf.analysis;
  const ev = evaluateMove(state.puzzle.fen, sf.move);
  const guessSan = sf.guess?.san;
  let verdictEl;
  if (!a.worst) {
    verdictEl = h('p', { class: 'ok' }, guessSan ? `Temías ${guessSan}: no hay nada realmente peligroso.` : 'Correcto: el rival no tiene nada peligroso.');
  } else if (sf.guess?.uci === a.worst.uci) {
    verdictEl = h('p', { class: 'ok' }, `Temías ${guessSan}: bien visto, es lo más peligroso (${a.worst.why}).`);
  } else if (sf.guess && a.forcing.has(sf.guess.uci)) {
    verdictEl = h('p', { class: 'ko' }, `Temías ${guessSan}: bien mirado, pero lo más peligroso es ${a.worst.san} (${a.worst.why}).`);
  } else {
    verdictEl = h('p', { class: 'ko' }, `No miraste ${a.worst.san}: ${a.worst.why}.`);
  }
  const n = (list) => list.length;
  children.push(
    verdictEl,
    h('p', {}, h('strong', {}, 'El rival tiene: '), `${n(a.sweep.checks)} jaque(s), ${n(a.sweep.captures)} captura(s) y ${n(a.sweep.threats)} amenaza(s)`,
      a.mates.length ? `; ¡${a.mates.length === 1 ? 'un mate' : `${a.mates.length} mates`} en 1!` : '; ningún mate en 1',
      a.idea ? '; y una idea forzada.' : '.'),
    sf.shown
      ? h('ul', { class: 'safety-list' },
        a.mates.length ? h('li', { class: 'ko' }, `Mate: ${a.mates.map((m) => m.san).join(', ')}`) : null,
        a.idea ? h('li', { class: 'ko' }, `Idea forzada: ${describeIdea(a.idea, { moves: true })}`) : null,
        n(a.sweep.checks) ? h('li', {}, `Jaques: ${a.sweep.checks.map((m) => m.san).join(', ')}`) : null,
        n(a.sweep.captures) ? h('li', {}, `Capturas: ${a.sweep.captures.map((m) => m.san).join(', ')}`) : null,
        n(a.sweep.threats) ? h('li', {}, `Amenazas: ${a.sweep.threats.map((m) => m.san).join(', ')}`) : null)
      : h('div', { class: 'actions' }, h('button', { onClick: () => { sf.shown = true; render(); } }, 'Ver cuáles')),
    ev.warnings.length ? h('ul', { class: 'warnings' }, ev.warnings.map((w) => h('li', {}, `⚠ ${w}`))) : h('p', { class: 'muted small' }, 'Tu jugada no deja nada colgado a simple vista.'),
    h('div', { class: 'actions' },
      h('button', { class: 'primary', 'data-key': 'p', onClick: () => leaveSafety(true) }, `Jugar ${sf.san} igualmente`),
      h('button', { onClick: () => leaveSafety(false) }, 'Cambiar de jugada'),
    ),
  );
  return h('section', {}, ...children);
}

/** Tu respuesta: la jugada del rival que temías (o null: "no veo nada"). */
function safetyGuess(move) {
  const sf = state.safety;
  let guess = null;
  if (move) {
    const chess = load(sf.fenAfter);
    try {
      const m = chess.move({ ...move, promotion: move.promotion ?? 'q' });
      guess = { uci: uciOf(m), san: m.san };
    } catch {
      return;
    }
  }
  sf.guess = guess;
  sf.analysis = safetyAnalysis(sf.fenAfter);
  state.checked = new Set([...(state.checked ?? []), sf.uci]);
  const ok = !sf.analysis.worst || guess?.uci === sf.analysis.worst.uci;
  state.safetyLog = [...(state.safetyLog ?? []), { uci: sf.uci, guess: guess?.uci ?? null, worst: sf.analysis.worst?.uci ?? null, ok }];
  track('safety', { uci: sf.uci, guess: guess?.uci ?? null, ok });
  render();
}

function leaveSafety(play) {
  const sf = state.safety;
  if (!play) {
    state.safety = null;
    return go(sf.from);
  }
  go('resolver');
  playUserMove(sf.move);
}

// ------------------------------------------------------- modo sin tiempo

function intuicion() {
  stopTimer();
  let left = INTUITION_SECONDS;
  const counter = h('div', { class: 'countdown' }, String(left));
  timer = setInterval(() => {
    left--;
    counter.textContent = String(Math.max(left, 0));
    counter.classList.toggle('urgent', left <= 5);
    if (left <= 0) stopTimer();
  }, 1000);
  const s = NO_TIME_STEPS[0];
  return h('section', {},
    h('h2', {}, `${stepNo('intuicion')}. ${s.text}`),
    h('p', {}, s.hint),
    counter,
    h('p', { class: 'muted small' }, 'Marca la jugada en el tablero. Todavía no se juega: primero la comprobarás.'),
  );
}

function comprobacion() {
  const s = NO_TIME_STEPS[1];
  const ev = state.intuition;
  const mate = answerQuestion('mate', state.puzzle.fen, state.puzzle.heroColor);
  const threats = answerQuestion('amenazadas', state.puzzle.fen, state.puzzle.heroColor);
  const dangers = [...mate.findings, ...threats.findings].filter((f) => f.tone === 'bad');
  return h('section', {},
    h('h2', {}, `${stepNo('comprobacion')}. ${s.text}`),
    h('p', {}, s.hint),
    h('h3', {}, `Tu jugada: ${ev.san}`),
    ev.tags.length ? h('ul', {}, ev.tags.map((t) => h('li', {}, t.text))) : h('p', { class: 'muted' }, 'No da jaque, no captura y no amenaza nada concreto.'),
    ev.warnings.length
      ? h('ul', { class: 'warnings' }, ev.warnings.map((w) => h('li', {}, `⚠ ${w}`)))
      : h('p', { class: 'ok' }, 'No deja nada colgado a primera vista.'),
    dangers.length ? h('div', {}, h('p', {}, 'Antes de mover, peligros que ya había en la posición:'), findingsList(dangers)) : null,
    h('div', { class: 'actions' },
      h('button', { class: 'primary', 'data-key': 'p', onClick: () => onBoardMove(ev.move) }, `Jugar ${ev.san}`),
      h('button', { onClick: () => { state.intuition = null; go('intuicion'); } }, 'Cambiar de jugada'),
    ),
  );
}

// ------------------------------------------------------------- resolver

function onBoardMove(move) {
  if (!state) return;
  const entry = activeEntry();
  if (entry) {
    if (addLineMove(entry, move)) render();
    return;
  }
  switch (state.step) {
    case 'candidatas':
      return addCandidate(move);
    case 'vistazo': {
      if (state.glance) return undefined;
      const full = withPromotion(move, 0);
      const chess = load(state.puzzle.fen);
      let m;
      try {
        m = chess.move(full);
      } catch {
        return undefined;
      }
      stopTimer();
      state.glance = { move: full, uci: m.from + m.to + (m.promotion ?? ''), san: m.san, mates: chess.isCheckmate(), ms: Date.now() - state.stepAt };
      return render();
    }
    case 'intuicion': {
      const ev = evaluateWithIdea(state.puzzle.fen, withPromotion(move, 0));
      if (!ev) return;
      state.intuition = ev;
      track('candidate', { uci: ev.uci, source: 'intuicion' });
      return go('comprobacion');
    }
    case 'decision':
      if (!state.addingCandidate) return playDecision(move);
      state.addingCandidate = false;
      return addCandidate(move);
    case 'comprobacion':
      if (settings.safetyCheck) return startSafety(move, 'comprobacion');
      go('resolver');
      return playUserMove(move);
    case 'permite':
      return state.safety?.guess === undefined ? safetyGuess(move) : undefined;
    case 'resolver':
      return state.predict ? predictReply(move) : playUserMove(move);
    case 'remate':
      return finaleMove(move);
    default:
      return undefined;
  }
}

/** Coronación: usa la pieza de la solución si coincide la jugada; si no, dama. */
function withPromotion(move, ply) {
  const expected = state.puzzle.solution[ply];
  if (expected && expected.startsWith(move.from + move.to) && expected[4]) return { ...move, promotion: expected[4] };
  const chess = load(state.playFen);
  const piece = chess.get(move.from);
  if (piece?.type === 'p' && (move.to[1] === '8' || move.to[1] === '1')) return { ...move, promotion: move.promotion ?? 'q' };
  return { from: move.from, to: move.to };
}

function playUserMove(move) {
  const { puzzle } = state;
  const expected = puzzle.solution[state.ply];
  if (!expected) return;
  const full = withPromotion(move, state.ply);
  const chess = load(state.playFen);
  let played;
  try {
    played = chess.move(full);
  } catch {
    return;
  }
  const uci = played.from + played.to + (played.promotion ?? '');
  // Lichess acepta cualquier mate aunque no sea la jugada registrada.
  const correct = uci === expected || chess.isCheckmate();
  log('move', { uci, expected, correct });
  track('move', { uci, ply: state.ply, ok: correct });
  if (state.ply === 0) state.firstPlayed ??= uci;
  if (!correct) {
    const ev = evaluateMove(state.playFen, full);
    // Antes de avisar: por qué falló (orden, casilla, profilaxis, colgada u otra).
    const why = classifyMistake(state.playFen, uci, puzzle.solution, state.ply);
    state.mistakes.push({ ply: state.ply, fen: state.playFen, uci, san: played.san, expected, ev, kind: why.kind, why: why.text });
    saveProgress(false);
    state.feedback = { type: 'ko', ev, why };
    render();
    return;
  }
  state.feedback = { type: 'ok', san: played.san };
  state.ply++;
  state.hint = 0;
  state.playFen = chess.fen();
  state.lastMove = { from: played.from, to: played.to };
  board.setPosition(state.playFen, { lastMove: state.lastMove });
  if (state.ply >= puzzle.solution.length || chess.isGameOver()) {
    state.ply = puzzle.solution.length;
    finish(true);
    return;
  }
  // Predecir la respuesta del rival (si tiene más de una jugada legal).
  if (predictionEnabled() && chess.moves().length > 1) {
    state.predict = { ply: state.ply };
    render();
    return;
  }
  playRivalReply();
}

/** ¿Se pide predecir la respuesta del rival? Por defecto, desde el nivel Intermedio. */
function predictionEnabled() {
  if (settings.predictReply === 'on') return true;
  if (settings.predictReply === 'off') return false;
  return settings.level !== 'casual';
}

/** El rival juega la respuesta de la solución (tras una pausa); `guess` es tu predicción, si la hubo. */
function playRivalReply(guess = null) {
  render();
  board.setInteractive(false);
  const current = state;
  setTimeout(() => {
    if (state !== current || current.revealed) return;
    const chess = load(state.playFen);
    const reply = chess.move(uciToMove(state.puzzle.solution[state.ply]));
    state.ply++;
    state.hint = 0;
    state.playFen = chess.fen();
    state.lastMove = { from: reply.from, to: reply.to };
    state.feedback = { type: 'reply', san: reply.san, guess };
    board.setPosition(state.playFen, { lastMove: state.lastMove });
    render();
  }, guess ? 900 : 600);
}

/** Tu predicción de la respuesta del rival: no cuenta como error del ejercicio. */
function predictReply(move) {
  const chess = load(state.playFen);
  let m;
  try {
    m = chess.move({ ...move, promotion: move.promotion ?? 'q' });
  } catch {
    return;
  }
  const expected = state.puzzle.solution[state.ply];
  const uci = m.from + m.to + (m.promotion ?? '');
  const ok = uci === expected || uci.slice(0, 4) === expected.slice(0, 4);
  state.predictions.push({ ply: state.ply, uci, san: m.san, ok });
  track('prediction', { uci, ok });
  state.predict = null;
  // Muestra un momento tu predicción y después la jugada de verdad.
  board.setPosition(chess.fen(), { lastMove: { from: m.from, to: m.to } });
  playRivalReply({ san: m.san, ok });
}

function revealSolution() {
  if (state.revealed) return;
  state.revealed = true;
  state.predict = null;
  saveProgress(false);
  render();
  const chess = load(state.playFen);
  const rest = state.puzzle.solution.slice(state.ply);
  const sans = rest.map((u) => chess.move(uciToMove(u)).san);
  state.revealedLine = sans;
  let i = 0;
  const replay = load(state.playFen);
  board.setInteractive(false);
  const current = state;
  const stepFn = () => {
    if (state !== current) return;
    if (i >= rest.length) {
      state.playFen = replay.fen();
      state.ply = state.puzzle.solution.length;
      finish(false);
      return;
    }
    const m = replay.move(uciToMove(rest[i++]));
    board.setPosition(replay.fen(), { lastMove: { from: m.from, to: m.to } });
    setTimeout(stepFn, 900);
  };
  stepFn();
}

function resolver() {
  const { feedback } = state;
  const children = [h('h2', {}, `${stepNo('resolver')}. ${mode() === 'tiempo' ? 'Juega tu decisión' : 'Juega'}`)];
  if (state.predict) {
    children.push(
      feedback?.type === 'ok' ? h('p', { class: 'ok' }, `✔ ${feedback.san} es correcta.`) : null,
      h('h3', {}, '¿Qué juega el rival?'),
      h('p', {}, 'Mueve en el tablero la pieza del rival: la respuesta que esperas. Fallar aquí no cuenta como error del ejercicio.'),
      h('div', { class: 'actions' }, h('button', { class: 'link', onClick: () => { state.predict = null; playRivalReply(); } }, 'Que juegue el rival sin predecir')),
    );
    return h('section', {}, ...children);
  }
  if (!feedback) children.push(h('p', {}, 'Mueve en el tablero. El rival responderá automáticamente.'));
  else if (feedback.type === 'ok') children.push(h('p', { class: 'ok' }, `✔ ${feedback.san} es correcta.`));
  else if (feedback.type === 'reply') {
    const g = feedback.guess;
    children.push(
      g ? h('p', { class: g.ok ? 'ok' : 'ko' }, g.ok ? `✔ Lo previste: el rival juega ${feedback.san}.` : `✘ Esperabas ${g.san}; el rival juega ${feedback.san}.`) : null,
      h('p', {}, `${g ? '' : `El rival responde ${feedback.san}. `}Tu turno: vuelve a hacerte las preguntas tácticas, sobre todo "¿hay mate?".`),
      settings.lineSweep ? lineSweepView() : null,
    );
  } else if (feedback.type === 'ko') {
    const { ev, why } = feedback;
    children.push(
      h('p', { class: 'ko' }, `✘ ${ev.san} no es la jugada del ejercicio.`),
      why ? h('p', { class: 'why' }, h('span', { class: `badge kind-${why.kind}` }, ERROR_INFO[why.kind].label), ' ', why.text) : null,
      ev.warnings.length ? h('ul', { class: 'warnings' }, ev.warnings.map((w) => h('li', {}, `⚠ ${w}`))) : h('p', { class: 'muted' }, 'No deja nada colgado a simple vista, pero hay algo más fuerte.'),
      h('p', {}, 'Pista: ¿qué preguntas responden SÍ? Busca jaques, capturas y amenazas, para ti y para el rival.'),
    );
  }
  if (state.revealed) {
    children.push(h('p', { class: 'muted' }, 'Mostrando la solución…'));
    return h('section', {}, ...children);
  }
  if (state.blind) {
    children.push(blindView());
    return h('section', {}, ...children);
  }
  if (state.hint) children.push(hintView());
  children.push(h('div', { class: 'actions' },
    state.hint < 3 ? h('button', { 'data-key': '?', onClick: nextHint }, `Pista (${state.hint + 1}/3)`) : null,
    h('button', { onClick: revealSolution }, 'Ver la solución'),
    state.ply < state.puzzle.solution.length - 1 ? h('button', { onClick: startBlind, title: 'El tablero se queda quieto y calculas la línea entera' }, 'Introduce la línea entera') : null,
  ));
  return h('section', {}, ...children);
}

/** Barrido rápido antes de cada jugada propia de la línea: recuentos, sin desvelar cuáles. */
function lineSweepView() {
  const mine = forcingSweep(state.playFen);
  const theirs = forcingSweep(withTurn(state.playFen, other(state.puzzle.heroColor)));
  const mates = mateInOne(state.playFen, state.puzzle.heroColor).length;
  const n = (list, one, many) => `${list.length} ${list.length === 1 ? one : many}`;
  return h('div', { class: 'sweep line-sweep' },
    h('strong', {}, 'Barrido rápido: '),
    `tienes ${n(mine.checks, 'jaque', 'jaques')}, ${n(mine.captures, 'captura', 'capturas')} y ${n(mine.threats, 'amenaza', 'amenazas')}`,
    mates ? ' (¡alguno es mate!)' : '',
    `. El rival, si le tocara: ${n(theirs.checks, 'jaque', 'jaques')}, ${n(theirs.captures, 'captura', 'capturas')} y ${n(theirs.threats, 'amenaza', 'amenazas')}.`,
  );
}

// ------------------------------------------------- líneas a ciegas

/** Las flechas de la línea a ciegas: en Avanzado y Experto se ocultan por defecto. */
function blindArrowsVisible() {
  if (settings.blindArrows === 'on') return true;
  if (settings.blindArrows === 'off') return false;
  return !['avanzado', 'experto'].includes(settings.level);
}

/** La línea que se está introduciendo ahora (tablero quieto), si la hay. */
function activeEntry() {
  if (state.step === 'resolver' && state.blind?.phase === 'input') return state.blind.entry;
  if (state.step === 'calculo' && state.calc?.current) {
    const entry = state.calc.lines[state.calc.current];
    if (!entry.done) return entry;
  }
  return null;
}

const entryLine = (entry) => playLine(entry.startFen, entry.ucis);

function lineArrows(entry) {
  if (!blindArrowsVisible()) return [];
  return entryLine(entry).moves.map((m, i) => ({ from: m.from, to: m.to, tone: m.by === 'you' ? 'mine' : 'theirs', label: i + 1 }));
}

/** Añade una jugada a la línea (desde el tablero o escrita en SAN). */
function addLineMove(entry, move) {
  const line = entryLine(entry);
  if (line.over) return false;
  const chess = load(line.fen);
  let m;
  try {
    m = chess.move(typeof move === 'string' ? move : { ...move, promotion: move.promotion ?? 'q' });
  } catch {
    return false;
  }
  const uci = uciOf(m);
  // En las jugadas del rival se apunta lo que has mirado (paso Calcular).
  if (m.color !== state.puzzle.heroColor) entry.considered[entry.ucis.length] = [...new Set([...(entry.considered[entry.ucis.length] ?? []), uci])];
  entry.ucis.push(uci);
  track('lineMove', { uci });
  return true;
}

/** Lista de la línea, campo para escribir jugadas y botones de deshacer. */
function lineEntryView(entry, { max = Infinity, onDone, doneLabel = 'Terminar la línea', extra = null } = {}) {
  const line = entryLine(entry);
  const startChess = load(entry.startFen);
  const startNo = Number(entry.startFen.split(' ')[5]);
  const blackFirst = startChess.turn() === 'b';
  const items = line.moves.map((m, i) => {
    const absolute = i + (blackFirst ? 1 : 0);
    const no = startNo + Math.floor(absolute / 2);
    const prefix = absolute % 2 === 0 ? `${no}.` : i === 0 ? `${no}...` : '';
    return h('span', { class: `line-move by-${m.by}` }, `${prefix}${m.san} `);
  });
  const input = h('input', { type: 'text', class: 'san-input', placeholder: 'Escribe la jugada (p. ej. Cf3 o Nf3) y pulsa Intro', 'aria-label': 'Jugada en notación algebraica' });
  input.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    ev.stopPropagation();
    const raw = input.value.trim();
    if (addLineMove(entry, raw) || addLineMove(entry, spanishSan(raw))) render();
    else input.setCustomValidity('Jugada no válida en la posición de tu cabeza');
    input.reportValidity();
  });
  const full = line.moves.length >= max || line.over;
  const turn = load(line.fen).turn() === state.puzzle.heroColor ? 'Te toca a ti' : 'Le toca al rival';
  return h('div', { class: 'line-entry' },
    h('p', { class: 'line-moves' }, items.length ? items : h('span', { class: 'muted' }, 'Todavía no hay jugadas.')),
    line.over ? h('p', { class: 'small ok' }, line.mate ? 'La línea acaba en mate.' : 'La partida termina aquí.') : h('p', { class: 'small' }, full ? 'Has llegado al final de la línea.' : `${turn}: mueve en el tablero (sin que se mueva nada) o escribe la jugada.`),
    full ? null : input,
    extra,
    h('div', { class: 'actions' },
      h('button', { class: 'primary', 'data-key': 'enter', disabled: !line.moves.length, onClick: onDone }, doneLabel),
      h('button', { disabled: !entry.ucis.length || entry.ucis.length <= (entry.fixed ?? 0), onClick: () => { entry.ucis.pop(); render(); } }, 'Deshacer'),
    ),
  );
}

/** Notación española a inglesa: C caballo, A alfil, T torre, D dama, R rey ("Cf3" → "Nf3"). */
function spanishSan(san) {
  const map = { C: 'N', A: 'B', T: 'R', D: 'Q', R: 'K' };
  return san.replace(/^[CATDR]/, (x) => map[x]).replace(/=([CATD])/, (_, x) => `=${map[x]}`);
}

// -------------------------------------- paso: calcular dos candidatas

function calculo() {
  const c = (state.calc ??= { picks: [...state.candidates].sort((a, b) => b.yesCount - a.yesCount).slice(0, 2).map((x) => x.uci), lines: {}, order: [], current: null, chosen: false });
  const title = h('h2', {}, `${stepNo('calculo')}. Calcula y compara dos candidatas`);
  const toDecision = () => go(nextStep('calculo'));
  if (!state.candidates.length) {
    return h('section', {}, title, h('p', {}, 'No hay candidatas que comparar.'), h('div', { class: 'actions' }, h('button', { class: 'primary', onClick: toDecision }, 'Ir a decidir')));
  }
  if (!c.chosen) {
    return h('section', {}, title,
      h('p', {}, 'Elige hasta 2 candidatas (preseleccionadas las que tienen más «síes»). Para cada una introducirás la línea a ciegas hasta donde creas que hay que parar: una posición tranquila, sin jaques ni capturas pendientes.'),
      h('ul', { class: 'calc-picks' }, state.candidates.map((x) => h('li', {}, h('label', { class: 'check' },
        h('input', {
          type: 'checkbox',
          checked: c.picks.includes(x.uci),
          onChange: (e) => {
            c.picks = e.target.checked ? [...c.picks, x.uci].slice(-2) : c.picks.filter((u) => u !== x.uci);
            render();
          },
        }), ` ${x.san} `, h('span', { class: 'muted small' }, `(${x.yesCount} síes)`))))),
      h('div', { class: 'actions' },
        h('button', {
          class: 'primary',
          disabled: !c.picks.length,
          onClick: () => {
            c.chosen = true;
            c.order = [...c.picks];
            for (const uci of c.order) c.lines[uci] = { startFen: state.puzzle.fen, ucis: [uci], fixed: 1, considered: {}, done: false, eval: null };
            c.current = c.order[0];
            track('calcStart', { picks: c.order });
            render();
          },
        }, 'Calcular'),
        h('button', { class: 'link', onClick: toDecision }, 'Saltar este paso'),
      ));
  }
  const entry = c.current ? c.lines[c.current] : null;
  if (entry && !entry.done) {
    const line = entryLine(entry);
    const rivalToMove = load(line.fen).turn() !== state.puzzle.heroColor && !line.over;
    const lastRival = !rivalToMove && entry.ucis.length > 1 && line.moves.at(-1)?.by === 'rival';
    let counter = null;
    if (rivalToMove || lastRival) {
      const idx = rivalToMove ? entry.ucis.length : entry.ucis.length - 1;
      const fen = rivalToMove ? line.fen : playLine(entry.startFen, entry.ucis.slice(0, -1)).fen;
      const node = rivalNode(fen, entry.considered[idx] ?? []);
      counter = h('p', { class: `small node ${node.total && node.seen < node.total ? 'ko' : 'ok'}` },
        node.total
          ? `Aquí el rival tiene ${node.checks} ${node.checks === 1 ? 'jaque' : 'jaques'} y ${node.captures} ${node.captures === 1 ? 'captura' : 'capturas'}; has mirado ${node.seen} de ${node.total}.`
          : 'Aquí el rival no tiene jaques ni capturas.',
        lastRival ? ' ' : null,
        lastRival ? h('button', { class: 'link', onClick: () => { entry.ucis.pop(); render(); } }, 'Mirar otra respuesta') : null);
    }
    const n = c.order.indexOf(c.current) + 1;
    return h('section', {}, title,
      h('h3', {}, `Línea ${n} de ${c.order.length}: empieza con ${line.moves[0]?.san}`),
      h('p', { class: 'small' }, 'Introduce las respuestas del rival y tus jugadas sin mover el tablero. Para las respuestas del rival puedes mirar varias: juega una, pulsa «Mirar otra respuesta» y prueba otra.'),
      lineEntryView(entry, { onDone: () => { entry.done = true; track('calcLine', { uci: c.current, plies: entry.ucis.length }); render(); }, doneLabel: 'Aquí paro', extra: counter }),
    );
  }
  if (entry && entry.eval == null) {
    return h('section', {}, title,
      h('h3', {}, `¿Cómo valoras la posición final de ${entryLine(entry).moves.map((m) => m.san).join(' ')}?`),
      h('p', { class: 'small' }, 'Desde tu punto de vista. Valorar la posición donde paras es la mitad del cálculo.'),
      h('div', { class: 'actions eval-buttons' }, EVAL_SYMBOLS.map((e, i) => h('button', {
        'data-key': String(i + 1),
        title: e.text,
        onClick: () => {
          entry.eval = e.id;
          track('calcEval', { uci: c.current, eval: e.id });
          c.current = c.order.find((u) => !c.lines[u].done) ?? null;
          render();
        },
      }, `${e.symbol} ${e.text}`))),
    );
  }
  return h('section', {}, title,
    h('p', {}, 'Ya tienes las dos líneas. En la decisión verás las dos posiciones finales lado a lado.'),
    calcSummary(),
    h('div', { class: 'actions' }, h('button', { class: 'primary', 'data-key': 'enter', onClick: toDecision }, 'Ir a decidir')),
  );
}

/** Las posiciones finales de las líneas calculadas, en tableros pequeños lado a lado. */
function calcSummary() {
  const c = state.calc;
  if (!c?.chosen) return null;
  const done = c.order.filter((u) => c.lines[u].done);
  if (!done.length) return null;
  return h('div', { class: 'calc-boards' }, done.map((uci) => {
    const entry = c.lines[uci];
    const line = entryLine(entry);
    const el = h('div', { class: 'mini-board' });
    const mini = new Board(el);
    mini.setPosition(line.fen, { orientation: state.puzzle.heroColor, lastMove: line.moves.at(-1) ? { from: line.moves.at(-1).from, to: line.moves.at(-1).to } : null });
    const sym = entry.eval != null ? symbolOf(entry.eval) : null;
    const real = state.engine?.calcEvals?.[uci];
    return h('figure', { class: 'calc-line' },
      el,
      h('figcaption', {},
        h('strong', {}, line.moves.map((m) => m.san).join(' ')),
        sym ? h('div', {}, `Tu valoración: ${sym.symbol} (${sym.text})`) : null,
        real ? h('div', { class: real.symbol === entry.eval ? 'ok' : 'ko' }, `Stockfish: ${symbolOf(real.symbol).symbol} (${formatScore(real.score)})`) : null),
    );
  }));
}

/** Empieza la línea a ciegas en el paso Jugar. */
function startBlind() {
  state.blind = { entry: { startFen: state.playFen, ucis: [], considered: {} }, startPly: state.ply, phase: 'input', answers: {}, qi: 0 };
  track('blindStart', {});
  render();
}

function blindView() {
  const b = state.blind;
  const remaining = state.puzzle.solution.length - b.startPly;
  if (b.phase === 'input') {
    return h('div', { class: 'blind-box' },
      h('h3', {}, 'Introduce la línea entera'),
      h('p', { class: 'small' }, `El tablero se queda quieto: introduce tus jugadas y las respuestas que esperas del rival (hasta ${remaining}). ${blindArrowsVisible() ? 'Se dibujan como flechas numeradas: azul las tuyas, naranja las del rival.' : 'Sin flechas: la línea solo está en tu cabeza.'} Las jugadas que coincidan con la solución se darán por jugadas; si te apartas en una jugada tuya, cuenta como fallo.`),
      lineEntryView(b.entry, { max: remaining, onDone: () => { b.qs = blindQuestions(b.entry.startFen, b.entry.ucis); b.phase = 'questions'; b.qi = 0; render(); } }),
      h('button', { class: 'link', onClick: () => { state.blind = null; render(); } }, 'Cancelar la línea a ciegas'),
    );
  }
  if (b.phase === 'questions') {
    const q = b.qs[b.qi];
    const answer = (value) => {
      b.answers[q.id] = value;
      state.pointing = null;
      board.setMarks({});
      b.qi++;
      if (b.qi >= b.qs.length) return reviewBlind();
      return render();
    };
    const controls = [];
    if (q.kind === 'square' || q.kind === 'squares') {
      if (!state.pointing) beginPointing();
      if (q.kind === 'square') state.pointing.max = 1;
      controls.push(h('p', { class: 'small' }, 'Toca la casilla en el tablero (la posición final solo está en tu cabeza).'),
        h('div', { class: 'actions' },
          h('button', { class: 'primary', 'data-key': 'enter', onClick: () => answer(q.kind === 'square' ? state.pointing?.picks[0] ?? null : [...(state.pointing?.picks ?? [])]) }, 'Listo'),
          q.kind === 'squares' ? h('button', { 'data-key': 'n', onClick: () => answer([]) }, 'Ninguna') : null));
    } else if (q.kind === 'choice') {
      controls.push(h('div', { class: 'actions' }, Object.entries(q.options).map(([id, label], i) => h('button', { 'data-key': String(i + 1), onClick: () => answer(id) }, label))));
    } else {
      controls.push(h('div', { class: 'actions' }, h('button', { 'data-key': 's', onClick: () => answer(true) }, 'Sí'), h('button', { 'data-key': 'n', onClick: () => answer(false) }, 'No')));
    }
    return h('div', { class: 'blind-box' },
      h('h3', {}, `Sobre la posición final (${b.qi + 1}/${b.qs.length})`),
      h('p', {}, q.text),
      ...controls,
    );
  }
  // Revisión: la línea comparada con la solución y las preguntas corregidas.
  const line = entryLine(b.entry);
  const sol = state.puzzle.solution.slice(b.startPly);
  const dev = b.deviation;
  const solSan = playLine(b.entry.startFen, sol).moves.map((m) => m.san);
  return h('div', { class: 'blind-box' },
    h('h3', {}, 'Tu línea comparada con la solución'),
    h('p', { class: 'line-moves' }, line.moves.map((m, i) => h('span', { class: `line-move ${dev === -1 || i < dev ? 'ok' : i === dev ? 'ko' : 'muted'}` }, `${i === dev ? '✘ ' : i < dev || dev === -1 ? '✔ ' : ''}${m.san} `))),
    dev >= 0 ? h('p', { class: 'small ko' }, `La primera que se aparta es ${line.moves[dev].san} (${line.moves[dev].by === 'you' ? 'tuya' : 'del rival'}): en la solución era ${solSan[dev] ?? '—'}.`) : h('p', { class: 'small ok' }, 'Toda tu línea coincide con la solución.'),
    h('ul', { class: 'blind-answers' }, b.qs.map((q) => {
      const ok = gradeBlind(q, b.answers[q.id]);
      const right = q.kind === 'choice' ? q.options[q.answer] : q.kind === 'yesno' ? `${q.answer ? 'Sí' : 'No'} (${q.detail})` : q.answer.length ? q.answer.join(', ') : 'ninguna';
      return h('li', { class: ok ? 'ok' : 'ko' }, `${ok ? '✔' : '✘'} ${q.text} `, h('span', { class: 'muted' }, `Respuesta: ${right}.`));
    })),
    h('div', { class: 'actions' }, h('button', { class: 'primary', 'data-key': 'enter', onClick: applyBlind }, 'Seguir con el ejercicio')),
  );
}

/** Reproduce tu línea en el tablero y pasa a la revisión. */
function reviewBlind() {
  const b = state.blind;
  b.phase = 'review';
  b.deviation = firstDeviation(b.entry.startFen, b.entry.ucis, state.puzzle.solution.slice(b.startPly));
  const ok = b.qs.filter((q) => gradeBlind(q, b.answers[q.id])).length;
  state.blindLog = [...(state.blindLog ?? []), { moves: b.entry.ucis.length, deviation: b.deviation, questions: b.qs.length, correct: ok }];
  track('blindDone', { deviation: b.deviation, correct: ok });
  render();
  const current = state;
  const replay = load(b.entry.startFen);
  const moves = entryLine(b.entry).moves;
  board.setInteractive(false);
  let i = 0;
  const stepFn = () => {
    if (state !== current || state.blind !== b) return;
    if (i >= moves.length) {
      board.setArrows(moves.map((m, k) => ({ from: m.from, to: m.to, tone: m.by === 'you' ? 'mine' : 'theirs', label: k + 1 })));
      if (b.deviation >= 0) board.setMarks({ [moves[b.deviation].to]: 'missed' });
      return;
    }
    const m = replay.move(uciToMove(moves[i++].uci));
    board.setPosition(replay.fen(), { lastMove: { from: m.from, to: m.to } });
    setTimeout(stepFn, 700);
  };
  setTimeout(stepFn, 300);
}

/** Da por jugadas las jugadas que coinciden; en la primera que se aparta, se juega como en el tablero. */
function applyBlind() {
  const b = state.blind;
  state.blind = null;
  board.setMarks({});
  const ucis = b.entry.ucis;
  const until = b.deviation === -1 ? ucis.length : b.deviation;
  const chess = load(state.playFen);
  for (let i = 0; i < until; i++) {
    const m = chess.move(uciToMove(ucis[i]));
    if (m.color !== state.puzzle.heroColor) state.predictions.push({ ply: state.ply, uci: ucis[i], san: m.san, ok: true, blind: true });
    track('move', { uci: ucis[i], ply: state.ply, ok: true, blind: true });
    state.ply++;
    state.playFen = chess.fen();
    state.lastMove = { from: m.from, to: m.to };
    if (chess.isCheckmate() || state.ply >= state.puzzle.solution.length) {
      state.ply = state.puzzle.solution.length;
      board.setPosition(state.playFen, { lastMove: state.lastMove });
      return finish(true);
    }
  }
  state.feedback = null;
  if (b.deviation >= 0) {
    const dev = ucis[b.deviation];
    if (b.deviation % 2 === 0) {
      // Jugada tuya distinta: cuenta como jugada en el tablero (y como fallo).
      render();
      return playUserMove(uciToMove(dev));
    }
    // Respuesta del rival distinta: predicción fallida; el rival juega la de la solución.
    const san = playLine(state.playFen, [dev]).moves[0]?.san ?? dev;
    state.predictions.push({ ply: state.ply, uci: dev, san, ok: false, blind: true });
    return playRivalReply({ san, ok: false });
  }
  // La línea era más corta: si ahora le toca al rival, responde él.
  if (load(state.playFen).turn() !== state.puzzle.heroColor) return playRivalReply();
  return render();
}

const QUESTION_BY_ID = Object.fromEntries(TACTICAL_QUESTIONS.map((q) => [q.id, q.text]));

function nextHint() {
  state.hint++;
  state.hintsUsed++;
  track('hint', { level: state.hint });
  saveProgress(false);
  render();
}

function hintView() {
  const expected = state.puzzle.solution[state.ply];
  const ev = evaluateWithIdea(state.playFen, uciToMove(expected));
  const questions = [...new Set(ev.tags.map((t) => t.q))].map((q) => QUESTION_BY_ID[q]).filter(Boolean);
  const piece = PIECE_NAMES[load(state.playFen).get(expected.slice(0, 2)).type];
  return h('div', { class: 'hint-box' },
    h('p', {}, h('strong', {}, 'Pista 1: '), questions.length
      ? `la jugada responde SÍ a: ${questions.join(' / ')}`
      : 'es una jugada tranquila: piensa en qué quiere hacer el rival y en tu peor pieza.'),
    state.hint >= 2 ? h('p', {}, h('strong', {}, 'Pista 2: '), ['dama', 'torre'].includes(piece) ? `mueve la ${piece} marcada en el tablero.` : `mueve el ${piece} marcado en el tablero.`) : null,
    state.hint >= 3 ? h('p', {}, h('strong', {}, 'Pista 3: '), 'la casilla de destino está marcada en verde.') : null,
  );
}

// --------------------------------------------------------------- resumen

function finish(solved) {
  if (state.finished) return;
  state.finished = true;
  const { puzzle } = state;
  state.solved = solved && state.mistakes.length === 0;
  // Resuelto (para temas y repaso) = sin errores, sin pistas y sin ver la solución.
  state.success = state.solved && state.hintsUsed === 0;
  const history = storage.get('history', []);
  history.unshift({ id: puzzle.id, rating: puzzle.rating, solved: state.solved, clean: state.success, mistakes: state.mistakes.length, level: settings.level, mode: mode(), date: new Date().toISOString() });
  storage.set('history', history.slice(0, 200));
  // Estadísticas por pregunta: qué preguntas señalaban la jugada clave.
  const key = evaluateWithIdea(puzzle.fen, uciToMove(puzzle.solution[0]));
  const keyUci = key?.uci;
  const tried = mode() === 'tiempo' ? state.candidates.map((c) => c.uci) : [state.intuition?.uci].filter(Boolean);
  state.keyInCandidates = tried.includes(keyUci);
  state.blind = blindSpots(puzzle.fen, puzzle.solution[0], tried);
  // Golpe de vista: ¿acertó? ¿lo jugaste o lo cambiaste?
  const g = state.glance;
  state.glanceCase = g?.uci ? glanceCase({ glance: g.uci, played: state.firstPlayed, key: keyUci, glanceMates: g.mates }) : null;
  state.endedAt = Date.now() - state.startedAt;
  state.keySeen = keyFirstSeen(state.timeline, keyUci);
  storage.set('stats', recordExercise(storage.get('stats', emptyStats()), {
    answers: state.answers,
    notes: state.notes,
    keyQuestions: key ? [...new Set(key.tags.map((t) => t.q))] : [],
    keyInCandidates: mode() === 'tiempo' ? state.keyInCandidates : null,
    blind: state.blind,
    hintsUsed: state.hintsUsed,
    glance: g?.confidence ? { confidence: g.confidence, correct: g.uci === keyUci || g.mates, kase: state.glanceCase } : null,
    keySource: state.keySeen.where,
    errors: state.mistakes.map((m) => m.kind).filter(Boolean),
    predictions: { ok: state.predictions.filter((p) => p.ok).length, total: state.predictions.length },
  }));
  saveProgress(state.success);
  state.review = buildReview(puzzle);
  go('resumen');
  if (settings.engineOn) startEngine();
}

/**
 * Registra el intento en temas y repaso, una sola vez por ejercicio: en cuanto
 * falla (error, pista o ver la solución) o al terminar. Así, aunque pases al
 * siguiente sin acabarlo, el fallo queda guardado para repasarlo.
 */
function saveProgress(success) {
  if (state.progressSaved) return;
  state.progressSaved = true;
  const { puzzle } = state;
  const progress = loadProgress();
  const before = progress.puzzles[puzzle.id];
  const after = recordAttempt(progress, puzzle, { success, mistakes: state.mistakes.length, hintsUsed: state.hintsUsed, revealed: state.revealed, now: Date.now() });
  state.progressStored = storage.set('progress', after);
  state.srsChange = state.progressStored ? srsChange(before, after.puzzles[puzzle.id]) : null;
  state.firstTry = !before;
  refreshReviewBadge();
}

function loadProgress() {
  const p = storage.get('progress', null);
  if (p?.puzzles) return p;
  // Primera vez: se apuntan los ejercicios hechos antes (no guardaban sus temas).
  const legacyIds = [...new Set(storage.get('history', []).map((x) => x.id).filter(Boolean))];
  const fresh = { ...emptyProgress(), legacyIds };
  storage.set('progress', fresh);
  return fresh;
}

/** Por qué cuenta como no resuelto. */
function failReason() {
  if (state.revealed) return 'porque viste la solución';
  if (state.mistakes.length) return state.mistakes.length === 1 ? 'por el error' : 'por los errores';
  return state.hintsUsed === 1 ? 'porque usaste una pista' : `porque usaste ${state.hintsUsed} pistas`;
}

/** Qué ha pasado con el ejercicio en tus temas y en el repaso. */
function progressNote() {
  const { puzzle } = state;
  const themes = puzzle.themes.map(themeName).join(', ');
  const change = state.srsChange;
  const srs = {
    added: `Lo guardo en tu repaso: volverá mañana (después a los ${SRS_INTERVALS.slice(1).join(', ')} días si lo aciertas).`,
    reset: 'Fallado en el repaso: vuelve a empezar y te lo enseño mañana.',
    advanced: change?.kind === 'advanced' ? `Repaso superado (caja ${change.box + 1} de ${SRS_INTERVALS.length}): volverá dentro de ${change.days} días.` : '',
    learned: '¡Aprendido! Lo has acertado en todos los repasos y sale de la lista.',
    early: change?.kind === 'early' ? `Repasado antes de tiempo: la fecha no cambia (le toca ${dueText(change.due, Date.now())}).` : '',
  }[change?.kind];
  if (state.progressStored === false) {
    return h('div', { class: 'progress-note ko-box' }, h('p', {}, 'No se ha podido guardar tu progreso: el almacenamiento del navegador está lleno o no está disponible.'));
  }
  const where = state.firstTry
    ? `Cuenta como ${state.success ? 'resuelto' : `no resuelto (${failReason()})`} en tus temas: ${themes}.`
    : `Ya lo habías intentado: tus temas siguen contando el primer intento.`;
  return h('div', { class: `progress-note ${state.success ? 'ok-box' : 'ko-box'}` },
    h('p', {}, where, ' ', h('button', { class: 'link', onClick: openThemes }, 'Ver mis temas')),
    srs ? h('p', {}, srs, ' ', h('button', { class: 'link', onClick: openReview }, 'Ver mi repaso')) : null,
  );
}

function resumen() {
  const { puzzle } = state;
  const key = evaluateMove(puzzle.fen, uciToMove(puzzle.solution[0]));
  const solutionInCandidates = state.candidates.some((c) => c.uci === key.uci) || state.intuition?.uci === key.uci;
  const isOpen = (id) => [...state.plan.tactical, ...state.plan.strategic].find((q) => q.id === id)?.open;
  const missed = Object.entries(state.answers).filter(([id, a]) => a && !isOpen(id) && a.user !== null && a.user !== a.result.yes);
  const history = storage.get('history', []);
  // Los registros antiguos no tienen `clean`: se usa `solved`.
  const solvedCount = history.filter((x) => x.clean ?? x.solved).length;
  const line = (() => {
    const c = load(puzzle.fen);
    return puzzle.solution.map((u) => c.move(uciToMove(u)).san).join(' ');
  })();

  return h('section', {},
    h('h2', {}, state.success ? '¡Resuelto!' : state.solved ? 'Resuelto con pistas' : state.mistakes.length && !state.revealed ? 'Resuelto con errores' : 'Solución vista'),
    h('p', {}, h('strong', {}, 'Solución: '), line),
    h('p', {}, h('strong', {}, `Clave ${key.san}: `), key.tags.length ? key.tags.map((t) => t.text).join('; ') : 'jugada tranquila: no da jaque ni captura; aquí cuentan las preguntas estratégicas.'),
    lineView(),
    themesView(),
    glanceCard(),
    processPanel(),
    mode() === 'tiempo'
      ? h('p', { class: solutionInCandidates ? 'ok' : 'ko' }, solutionInCandidates ? 'La jugada clave estaba entre tus candidatas. La técnica de candidatas funciona.' : 'La jugada clave no estaba entre tus candidatas. Repasa: ¿qué pregunta te habría llevado a ella?')
      : h('p', { class: state.intuition?.uci === key.uci ? 'ok' : 'ko' }, state.intuition?.uci === key.uci ? 'Tu intuición acertó.' : `Tu intuición fue ${state.intuition?.san ?? '—'}. Con más tiempo, el proceso completo ayuda a corregirla.`),
    !state.keyInCandidates && state.blind?.length
      ? h('p', { class: 'blind' }, h('strong', {}, 'Por qué pudo costarte verla: '), `es ${state.blind.map((b) => BLIND_SPOTS[b]).join('; ')}. Estos son puntos ciegos frecuentes: tenlos en cuenta en el barrido.`)
      : null,
    missed.length ? h('div', {}, h('p', {}, 'Preguntas en las que tu respuesta no coincidió con el análisis:'), h('ul', {}, missed.map(([id]) => h('li', {}, questionText(id))))) : null,
    state.firstImpression ? h('p', {}, h('strong', {}, 'Tu primera impresión: '), state.firstImpression) : null,
    progressNote(),
    state.hintsUsed ? h('p', { class: 'muted small' }, `Pistas usadas: ${state.hintsUsed}.`) : null,
    state.predictions.length ? h('p', { class: 'small' }, h('strong', {}, 'Respuestas del rival previstas: '), `${state.predictions.filter((p) => p.ok).length} de ${state.predictions.length}`,
      state.predictions.some((p) => !p.ok) ? h('span', { class: 'muted' }, ` (esperabas ${state.predictions.filter((p) => !p.ok).map((p) => p.san).join(', ')})`) : null) : null,
    state.mistakes.length ? h('div', { class: 'why-list' }, h('strong', {}, 'Por qué fallaron tus jugadas:'), h('ul', {}, state.mistakes.map((m) => h('li', {}, h('span', { class: `badge kind-${m.kind}` }, ERROR_INFO[m.kind]?.label ?? '—'), ' ', m.why ?? m.san)))) : null,
    h('p', { class: 'muted small' }, `Dificultad Lichess: ${puzzle.rating} · Has resuelto ${solvedCount} de ${history.length} ejercicios en este navegador.`),
    finaleButton(),
    h('p', {}, h('a', { href: puzzle.puzzleUrl, target: '_blank', rel: 'noopener' }, 'Ver en Lichess'), ' · ', h('a', { href: puzzle.gameUrl, target: '_blank', rel: 'noopener' }, 'Partida original')),
    engineSection(),
  );
}

// ------------------------------------------- evaluación con motor (repaso)

let engine = null;
let engineRun = 0;

function saveSettings() {
  storage.set('settings', settings);
}

function cancelEngine() {
  engineRun++;
  engine?.terminate();
  engine = null;
}

/** Jugadas a evaluar con su origen: la clave, tus candidatas, tu intuición y tus fallos. */
function movesToEvaluate() {
  const { puzzle } = state;
  const origin = new Map();
  const add = (uci, label) => uci && origin.set(uci, [...(origin.get(uci) ?? []), label]);
  add(puzzle.solution[0], 'solución');
  for (const c of state.candidates) add(c.uci, 'candidata');
  add(state.intuition?.uci, 'intuición');
  return origin;
}

async function startEngine() {
  const run = ++engineRun;
  const source = settings.engineSource;
  const { puzzle } = state;
  const origin = movesToEvaluate();
  state.engine = { status: 'running', source, best: null, rows: [], origin };
  state.engineFocus = null;
  render();
  try {
    // También con la nube: Stockfish completa las posiciones que la nube no tiene.
    engine ??= new StockfishEngine();
    const result = await evaluateMoves(source, puzzle.fen, [...origin.keys()], {
      engine,
      onProgress: ({ best, rows }) => {
        if (run !== engineRun) return;
        Object.assign(state.engine, { best, rows: [...rows] });
        render();
      },
    });
    if (run !== engineRun) return;
    Object.assign(state.engine, { status: 'done', best: result.best, rows: result.rows });
    log('engine', state.engine);
    render();
    await explainMistakes(run);
    await rivalBestReply(run);
    await evaluateCalcLines(run);
    evaluateShownPosition();
  } catch (err) {
    if (run !== engineRun) return;
    console.error(err);
    Object.assign(state.engine, { status: 'error', error: err.message });
  }
  render();
}

/** Tras tu primera jugada: la mejor respuesta del rival según Stockfish (para «¿Qué permite?»). */
async function rivalBestReply(run) {
  const uci = state.firstPlayed;
  if (!uci) return;
  const chess = load(state.puzzle.fen);
  try {
    chess.move(uciToMove(uci));
  } catch {
    return;
  }
  if (chess.isGameOver()) return;
  const r = await engine.evaluate(chess.fen(), { depth: 12 });
  if (run !== engineRun) return;
  const san = pvToSan(chess.fen(), r.pv, 3);
  const feared = state.safetyLog?.findLast((x) => x.uci === uci)?.guess;
  state.engine.rivalBest = { after: pvToSan(state.puzzle.fen, [uci], 1)[0], san, uci: r.pv[0], score: r.score, feared };
  render();
}

/** Paso Calcular: Stockfish valora la posición final de cada línea («Valoraste = y era ±»). */
async function evaluateCalcLines(run) {
  const c = state.calc;
  if (!c?.chosen) return;
  for (const uci of c.order) {
    const entry = c.lines[uci];
    if (!entry.done) continue;
    const line = entryLine(entry);
    let score;
    if (line.mate) score = { mate: load(line.fen).turn() === state.puzzle.heroColor ? -1 : 1 };
    else if (line.over) score = { cp: 0 };
    else {
      const r = await engine.evaluate(line.fen, { depth: 12 });
      if (run !== engineRun) return;
      score = load(line.fen).turn() === state.puzzle.heroColor ? r.score : r.score.mate != null ? { mate: -r.score.mate } : { cp: -r.score.cp };
    }
    (state.engine.calcEvals ??= {})[uci] = { score, symbol: cpToSymbol(Math.max(-10000, Math.min(10000, toCp(score)))) };
    render();
  }
}

/** Para cada jugada fallida: qué responde el rival y qué era mejor (siempre con Stockfish). */
async function explainMistakes(run) {
  const seen = new Set();
  const list = state.mistakes.filter((m) => m.fen && !seen.has(m.fen + m.uci) && seen.add(m.fen + m.uci));
  if (!list.length) return;
  const explained = [];
  for (const m of list) {
    // En la posición del ejercicio se reutiliza lo ya evaluado, para que las cifras coincidan.
    const atStart = m.fen === state.puzzle.fen;
    const known = atStart ? state.engine.rows.find((r) => r.uci === m.uci && r.available) : null;
    const best = atStart && state.engine.best ? state.engine.best : await engine.evaluate(m.fen, { depth: DEFAULT_DEPTH });
    const played = known ?? (await engine.evaluate(m.fen, { depth: DEFAULT_DEPTH, move: m.uci }));
    if (run !== engineRun) return;
    explained.push({ ...m, best, played, loss: Math.max(0, toCp(best.score) - toCp(played.score)) });
    state.engine.mistakes = [...explained];
    render();
  }
}

function mistakesView(ev) {
  if (!ev.mistakes?.length) return null;
  return h('div', { class: 'mistakes' },
    h('h4', {}, 'Por qué fallaron tus jugadas'),
    h('ul', {}, ev.mistakes.map((m) => {
      const line = pvToSan(m.fen, m.played.pv, 5);
      const best = pvToSan(m.fen, m.best.pv, 4);
      const v = verdict(m.loss, m.played.score);
      return h('li', {},
        h('span', { class: `badge tone-${v.tone}` }, v.label), ' ',
        m.kind ? h('span', { class: `badge kind-${m.kind}` }, ERROR_INFO[m.kind].label) : null, m.kind ? ' ' : null,
        h('strong', {}, m.san), ` (${formatScore(m.played.score)}, ${describeAdvantage(m.played.score)}). `,
        line.length > 1 ? `El rival responde ${line[1]}${line.length > 2 ? ` y sigue ${line.slice(2).join(' ')}` : ''}. ` : '',
        `Lo mejor era `, h('strong', {}, best[0] ?? '—'), ` (${formatScore(m.best.score)})${best.length > 1 ? `: ${best.join(' ')}` : ''}.`,
      );
    })),
  );
}

/** Las 3 mejores jugadas del motor: ¿estaban entre tus candidatas? */
function topMovesView(best) {
  const { puzzle } = state;
  const tried = new Set([...state.candidates.map((c) => c.uci), state.intuition?.uci].filter(Boolean));
  const ref = toCp(best.top[0].score);
  const good = best.top.filter((t) => ref - toCp(t.score) <= 100);
  const missed = good.filter((t) => !tried.has(t.pv[0]));
  return h('div', { class: 'top-moves' },
    h('strong', {}, 'Las 3 mejores según el motor'),
    h('ol', {}, best.top.map((t) => {
      const san = pvToSan(puzzle.fen, t.pv, 4);
      const inList = tried.has(t.pv[0]);
      return h('li', {},
        h('strong', {}, san[0]), ` ${formatScore(t.score)} `,
        h('span', { class: inList ? 'ok' : 'ko' }, inList ? '✔ estaba en tus candidatas' : '✘ no la consideraste'),
        h('span', { class: 'muted small' }, ` ${san.slice(1).join(' ')}`),
      );
    })),
    missed.length && tried.size
      ? h('p', { class: 'small' }, `Se te ${missed.length === 1 ? 'escapó 1 jugada buena' : `escaparon ${missed.length} jugadas buenas`} (a menos de 1 peón de la mejor). Mira en el barrido si eran jaques, capturas o amenazas.`)
      : null,
  );
}

function toggleEngine() {
  settings.engineOn = !settings.engineOn;
  saveSettings();
  if (settings.engineOn) {
    startEngine();
  } else {
    cancelEngine();
    state.engine = null;
    state.engineFocus = null;
    render();
  }
}

function engineSection() {
  const on = settings.engineOn;
  const controls = h('div', { class: 'actions' },
    h('button', { class: on ? '' : 'primary', 'aria-pressed': String(on), onClick: toggleEngine }, on ? 'Desactivar motor' : 'Activar motor'),
    h('select', {
      'aria-label': 'Fuente de evaluación',
      onChange: (e) => {
        settings.engineSource = e.target.value;
        saveSettings();
        if (settings.engineOn) {
          cancelEngine();
          startEngine();
        }
      },
    }, Object.entries(ENGINE_SOURCES).map(([value, label]) => h('option', { value, selected: settings.engineSource === value }, label))),
  );
  const box = h('div', { class: 'engine' }, h('h3', {}, 'Evaluación con motor'), controls);
  if (!on) {
    box.append(h('p', { class: 'muted small' }, 'Compara tus candidatas con una evaluación real. Solo está disponible al terminar el ejercicio, para no condicionar tu proceso de pensamiento.'));
    return box;
  }
  const ev = state.engine;
  if (!ev) return box;
  if (ev.status === 'error') {
    box.append(h('p', { class: 'error' }, ev.error), h('button', { onClick: startEngine }, 'Reintentar'));
    return box;
  }
  const { puzzle } = state;
  if (ev.best) {
    const san = pvToSan(puzzle.fen, ev.best.pv);
    box.append(h('p', {}, h('strong', {}, 'Mejor según el motor: '), `${san[0] ?? '—'} (${formatScore(ev.best.score)}) `, h('span', { class: 'muted' }, san.join(' '))));
  }
  if (ev.best?.top?.length > 1) box.append(topMovesView(ev.best));
  if (ev.source === 'cloud' && (ev.best?.via === 'stockfish' || ev.rows.some((r) => r.via === 'stockfish'))) {
    box.append(h('p', { class: 'muted small' }, 'La nube de Lichess solo tiene las posiciones que alguien ya analizó; lo que faltaba se ha completado con Stockfish (marcado como "Stockfish").'));
  }
  const available = ev.rows.filter((r) => r.available);
  const reference = ev.best ? toCp(ev.best.score) : Math.max(...available.map((r) => toCp(r.score)));
  const rows = [...ev.rows].sort((a, b) => (b.available ? toCp(b.score) : -Infinity) - (a.available ? toCp(a.score) : -Infinity));
  if (rows.length) {
    box.append(h('table', { class: 'engine-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Jugada'), h('th', {}, 'Eval.'), h('th', {}, 'Veredicto'), h('th', {}, 'Línea'))),
      h('tbody', {}, rows.map((r) => {
        const san = pvToSan(puzzle.fen, r.pv);
        const v = r.available ? verdict(Math.max(0, reference - toCp(r.score)), r.score) : null;
        const focus = () => {
          state.engineFocus = { uci: r.uci, tone: v?.tone ?? 'info' };
          state.review.index = state.review.puzzleIndex;
          render();
        };
        return h('tr', { class: state.engineFocus?.uci === r.uci ? 'focus' : '', onClick: focus },
          h('td', {}, h('strong', {}, san[0] ?? r.uci), h('div', { class: 'muted small' }, ev.origin.get(r.uci)?.join(', '))),
          h('td', { class: 'score', title: r.available ? describeAdvantage(r.score) : '' }, r.available ? formatScore(r.score) : '—', ev.source === 'cloud' && r.via ? h('div', { class: 'muted small' }, r.via === 'cloud' ? 'nube' : 'Stockfish') : null),
          h('td', {}, v ? h('span', { class: `badge tone-${v.tone}` }, v.label) : h('span', { class: 'muted small' }, 'sin datos')),
          h('td', { class: 'muted small' }, san.slice(1).join(' ')),
        );
      })),
    ));
  }
  const mistakes = mistakesView(ev);
  if (mistakes) box.append(mistakes);
  if (ev.calcEvals && state.calc?.chosen) {
    box.append(h('div', { class: 'small' }, h('strong', {}, 'Tus líneas del paso Calcular'), h('ul', {}, state.calc.order.filter((u) => ev.calcEvals[u]).map((u) => {
      const entry = state.calc.lines[u];
      const mine = entry.eval != null ? symbolOf(entry.eval).symbol : '—';
      const real = symbolOf(ev.calcEvals[u].symbol).symbol;
      return h('li', { class: entry.eval === ev.calcEvals[u].symbol ? 'ok' : 'ko' }, `${entryLine(entry).moves.map((m) => m.san).join(' ')}: valoraste ${mine} y era ${real} (${formatScore(ev.calcEvals[u].score)}).`);
    }))));
  }
  if (ev.rivalBest?.san.length) {
    const rb = ev.rivalBest;
    // La puntuación es del rival: se da la vuelta para leerla desde tu lado.
    const mine = rb.score.mate != null ? { mate: -rb.score.mate } : { cp: -rb.score.cp };
    box.append(h('p', { class: 'small' }, h('strong', {}, `¿Qué permitía ${rb.after}? `),
      `La mejor respuesta del rival según Stockfish: ${rb.san[0]} (${formatScore(mine)}, ${describeAdvantage(mine)})${rb.san.length > 1 ? `, ${rb.san.join(' ')}` : ''}.`,
      rb.feared !== undefined ? (rb.feared === rb.uci ? ' Era la que temías: bien visto.' : ' No era la que temías.') : ''));
  }
  if (ev.status === 'running') {
    const total = ev.origin.size;
    box.append(h('p', { class: 'muted small' }, `Analizando… ${ev.rows.length}/${total}${ev.source === 'stockfish' ? ` (profundidad ${DEFAULT_DEPTH})` : ''}`));
  } else {
    box.append(h('p', { class: 'muted small' }, 'Pulsa una jugada para verla en el tablero. Evaluación desde tu punto de vista: positivo es bueno para ti.'));
  }
  return box;
}

// ------------------------------------------- rematar contra Stockfish

function finaleButton() {
  const end = state.review.positions.at(-1).fen;
  const chess = load(end);
  if (chess.isGameOver()) return h('p', { class: 'muted small' }, 'La línea termina en mate: no hay nada que rematar.');
  return h('div', { class: 'actions' },
    h('button', { onClick: () => startFinale(end) }, 'Rematar contra Stockfish'),
    h('span', { class: 'muted small' }, 'Juega tú desde la posición final y convierte la ventaja.'),
  );
}

function startFinale(fen) {
  stopExplaining();
  state.finale = { fen, startFen: fen, lastMove: null, moves: [], status: 'playing', thinking: false, eval: null };
  go('remate');
  // Si la solución acaba con tu jugada, empieza moviendo Stockfish.
  if (load(fen).turn() !== state.puzzle.heroColor) engineReply();
  else evaluateFinale();
}

async function evaluateFinale() {
  const f = state.finale;
  const current = state;
  try {
    engine ??= new StockfishEngine();
    const ev = await evaluatePosition('stockfish', f.fen, { engine, depth: 10 });
    if (state !== current || state.finale !== f) return;
    f.eval = ev;
    render();
  } catch (err) {
    console.error(err);
  }
}

async function finaleMove(move) {
  const f = state.finale;
  if (f.status !== 'playing' || f.thinking) return;
  const chess = load(f.fen);
  let m;
  try {
    m = chess.move({ ...move, promotion: move.promotion ?? 'q' });
  } catch {
    return;
  }
  f.moves.push(m.san);
  f.fen = chess.fen();
  f.lastMove = { from: m.from, to: m.to };
  if (chess.isGameOver()) return endFinale(chess);
  return engineReply();
}

/** Stockfish juega por el rival en el remate. */
async function engineReply() {
  const f = state.finale;
  const chess = load(f.fen);
  f.thinking = true;
  render();
  const current = state;
  try {
    engine ??= new StockfishEngine();
    const reply = await engineMove(engine, f.fen, { depth: 10 });
    if (state !== current || state.finale !== f) return;
    const r = chess.move(uciToMove(reply));
    f.moves.push(r.san);
    f.fen = chess.fen();
    f.lastMove = { from: r.from, to: r.to };
  } catch (err) {
    console.error(err);
  }
  f.thinking = false;
  if (chess.isGameOver()) return endFinale(chess);
  render();
  evaluateFinale();
}

function endFinale(chess) {
  const f = state.finale;
  f.thinking = false;
  f.status = chess.isCheckmate() ? (chess.turn() === state.puzzle.heroColor ? 'lost' : 'won') : 'draw';
  render();
}

function remate() {
  const f = state.finale;
  const msg = {
    playing: f.thinking ? 'Stockfish está pensando…' : 'Tu turno. Mueve en el tablero.',
    won: '¡Rematado! Has dado mate a Stockfish.',
    lost: 'Stockfish te ha dado mate: repasa en qué momento se escapó la ventaja.',
    draw: 'Tablas: la ventaja se ha escapado.',
  }[f.status];
  const score = f.eval ? heroScore(f.eval) : null;
  const slipping = score && f.status === 'playing' && toCp(score) < 150;
  return h('section', {},
    h('h2', {}, 'Rematar contra Stockfish'),
    h('p', {}, 'Desde la posición final de la solución, demuestra que sabes ganarla: juegas tú y Stockfish defiende.'),
    f.eval ? advantageBar(f.eval) : null,
    h('p', { class: f.status === 'won' ? 'ok' : f.status === 'playing' ? '' : 'ko' }, msg),
    slipping ? h('p', { class: 'ko small' }, 'La ventaja se está escapando: vuelve a las preguntas tácticas (¿hay mate?, ¿piezas desprotegidas?).') : null,
    f.moves.length ? h('p', { class: 'muted small' }, f.moves.join(' ')) : null,
    h('div', { class: 'actions' },
      h('button', { onClick: () => startFinale(f.startFen) }, 'Empezar de nuevo'),
      h('button', { onClick: () => { state.finale = null; go('resumen'); } }, 'Volver al resumen'),
    ),
  );
}

/** "Tu recorrido": segundos por fase, dónde apareció la clave y aviso de fijación. */
function processPanel() {
  const tl = state.timeline;
  if (!tl?.length) return null;
  const phases = phaseDurations(tl, state.endedAt ?? Date.now() - state.startedAt);
  const total = phases.reduce((a, p) => a + p.ms, 0) || 1;
  const seen = state.keySeen ?? { where: 'nunca' };
  const key = evaluateMove(state.puzzle.fen, uciToMove(state.puzzle.solution[0]));
  const where = {
    intuicion: `La jugada clave ${key.san} te salió por intuición, a los ${seen.seconds} s.`,
    candidatas: `La jugada clave ${key.san} apareció al apuntar candidatas, a los ${seen.seconds} s.`,
    preguntas: `La jugada clave ${key.san} apareció a los ${seen.seconds} s${seen.after ? `, después de la pregunta «${questionText(seen.after)}»` : ''} (${PHASE_NAMES[seen.phase] ?? seen.phase}).`,
    nunca: `La jugada clave ${key.san} no apareció en tu proceso.`,
  }[seen.where];
  const fix = mode() === 'tiempo' ? fixation(tl) : null;
  const fixSan = fix ? state.candidates.find((c) => c.uci === fix.uci)?.san ?? fix.uci : null;
  return h('div', { class: 'process' },
    h('h3', {}, 'Tu recorrido'),
    h('div', { class: 'phase-bar', role: 'img', 'aria-label': phases.map((p) => `${p.name} ${p.seconds} s`).join(', ') },
      phases.map((p) => h('div', { class: `phase-seg seg-${p.step}`, style: `flex-grow: ${Math.max(p.ms / total, 0.02)}`, title: `${p.name}: ${p.seconds} s` }))),
    h('ul', { class: 'phase-list' }, phases.map((p) => h('li', {}, h('span', { class: `dot seg-${p.step}` }), `${p.name}: ${p.seconds} s`))),
    h('p', { class: seen.where === 'nunca' ? 'ko small' : 'small' }, where),
    fix ? h('p', { class: 'blind small' }, `Apuntaste una sola candidata (${fixSan}) a los ${fix.seconds} s: cuando encuentres una buena jugada, busca una mejor.`) : null,
  );
}

/** La línea ganadora narrada jugada a jugada (pulsa una jugada para verla). */
function lineView() {
  const review = state.review;
  const items = [...review.explanations.entries()];
  return h('div', { class: 'line-view' },
    h('div', { class: 'line-head' },
      h('strong', {}, 'La línea ganadora, jugada a jugada'),
      h('button', { onClick: explainSolution }, '▶ Explícamela en el tablero'),
    ),
    h('ol', {}, items.map(([index, ply]) => h('li', {
      class: `${ply.by === 'you' ? 'mine' : 'theirs'}${review.index === index ? ' current' : ''}`,
      onClick: () => navigate(index),
    }, narratePly(ply)))),
  );
}

/** Los temas del puzzle explicados, con la jugada donde aparecen. */
function themesView() {
  const { puzzle, review } = state;
  const plies = [...review.explanations.values()];
  const items = puzzle.themes.filter((t) => THEME_HELP[t]).map((t) => {
    const help = THEME_HELP[t];
    const where = help.move ? plies.find((p) => p.by === 'you' && p.themes.includes(help.move)) : null;
    return h('li', {}, h('strong', {}, themeName(t)), `: ${help.text}`, where ? h('span', { class: 'muted' }, ` En este ejercicio: ${where.san}.`) : null);
  });
  const rest = puzzle.themes.filter((t) => !THEME_HELP[t]).map(themeName);
  return h('div', { class: 'themes' },
    h('strong', {}, 'Temas del ejercicio'),
    items.length ? h('ul', {}, items) : null,
    rest.length ? h('p', { class: 'muted small' }, `También: ${rest.join(', ')}.`) : null,
  );
}

function questionText(id) {
  return [...state.plan.tactical, ...state.plan.strategic].find((q) => q.id === id)?.text ?? id;
}

// ------------------------------------------------------------ estadísticas

const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const times = (n) => `${n} ${n === 1 ? 'vez' : 'veces'}`;

function bar(value, tone) {
  return h('div', { class: 'bar' }, h('div', { class: `bar-fill tone-${tone}`, style: `width: ${Math.round((value ?? 0) * 100)}%` }));
}

function statsView() {
  const { rows, hardest, exercises, candidates, blindSpots: blind, hints } = summarize(storage.get('stats', emptyStats()));
  if (!rows.length) {
    return h('div', {}, h('p', {}, 'Todavía no hay datos. Termina algún ejercicio en el modo "con tiempo" respondiendo a las preguntas.'));
  }
  const closed = rows.filter((r) => !r.open);
  const open = rows.filter((r) => r.open);
  return h('div', {},
    h('p', { class: 'muted small' }, `${exercises} ${exercises === 1 ? 'ejercicio terminado' : 'ejercicios terminados'} en este navegador.`),
    hardest
      ? h('div', { class: 'callout' },
          h('strong', {}, 'Lo que más te cuesta: '), hardest.text,
          h('div', { class: 'small' },
            hardest.keyMissed ? `En ${hardest.keyMissed} de ${hardest.key} ejercicios esta pregunta llevaba a la jugada clave y no la viste. ` : '',
            hardest.missed ? `${times(hardest.missed)} había algo y respondiste que no. ` : '',
            hardest.falseAlarm ? `${hardest.falseAlarm} ${hardest.falseAlarm === 1 ? 'falsa alarma' : 'falsas alarmas'}. ` : '',
            hardest.unsure ? `${hardest.unsure} "no lo sé".` : ''))
      : h('p', { class: 'muted small' }, 'Responde al menos 3 veces cada pregunta para saber cuál te cuesta más.'),
    candidates.asked
      ? h('p', {}, h('strong', {}, 'Técnica de candidatas: '), `la jugada clave estaba entre tus candidatas en ${candidates.keyFound} de ${candidates.asked} ejercicios (${pct(candidates.keyFound / candidates.asked)}).`)
      : null,
    blind.length
      ? h('div', {},
          h('h3', {}, 'Tus puntos ciegos'),
          h('p', { class: 'muted small' }, 'Tipos de jugada clave y cuántas veces no estaban entre tus candidatas.'),
          h('ul', { class: 'blind-stats' }, blind.map((b) => h('li', {},
            h('span', {}, `${b.text[0].toUpperCase()}${b.text.slice(1)}: `),
            h('strong', {}, `${b.missed} de ${b.seen}`), ` sin ver (${pct(b.rate)})`,
            bar(1 - b.rate, b.rate <= 0.25 ? 'good' : b.rate <= 0.5 ? 'info' : 'bad'),
          ))))
      : null,
    hints.exercises ? h('p', {}, h('strong', {}, 'Pistas: '), `${hints.used} pista(s) en ${hints.needed} de ${hints.exercises} ejercicios.`) : null,
    h('h3', {}, 'Preguntas de sí o no'),
    h('div', { class: 'table-scroll' }, h('table', { class: 'stats-table' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'Pregunta'), h('th', {}, 'Veces'), h('th', {}, 'Aciertos'),
        h('th', { title: 'Había algo y respondiste que no' }, 'No lo viste'),
        h('th', { title: 'Respondiste que sí y no había nada' }, 'Falsa alarma'),
        h('th', {}, 'No lo sé'),
        h('th', { title: 'Ejercicios en los que la pregunta llevaba a la jugada clave y no respondiste que sí' }, 'Clave no vista'),
      )),
      h('tbody', {}, closed.map((r) => h('tr', { class: hardest?.id === r.id ? 'hardest' : '' },
        h('td', {}, r.text, h('div', { class: 'muted small' }, r.group + (r.enough ? '' : ' · pocos datos'))),
        h('td', { class: 'num' }, String(r.asked)),
        h('td', { class: 'num' }, pct(r.accuracy), bar(r.accuracy, r.accuracy >= 0.75 ? 'good' : r.accuracy >= 0.5 ? 'info' : 'bad')),
        h('td', { class: 'num' }, String(r.missed)),
        h('td', { class: 'num' }, String(r.falseAlarm)),
        h('td', { class: 'num' }, String(r.unsure)),
        h('td', { class: 'num' }, r.key ? `${r.keyMissed}/${r.key}` : '—'),
      ))),
    )),
    open.length ? h('h3', {}, 'Preguntas abiertas') : null,
    open.length
      ? h('ul', { class: 'open-stats' }, open.map((r) => h('li', {}, `${r.text} `, h('span', { class: 'muted small' }, `pensada ${times(r.asked)}, con idea escrita ${times(r.withIdea)}${r.key ? ` · señalaba la clave en ${r.key}` : ''}`))))
      : null,
  );
}

function openStats() {
  let dialog = $('#stats-dialog');
  if (!dialog) {
    dialog = h('dialog', { id: 'stats-dialog', class: 'stats-dialog' });
    document.body.append(dialog);
  }
  const close = () => dialog.close();
  dialog.replaceChildren(
    h('div', { class: 'dialog-head' }, h('h2', {}, 'Estadísticas por pregunta'), h('button', { class: 'link', onClick: close, 'aria-label': 'Cerrar' }, 'Cerrar')),
    statsView(),
    h('div', { class: 'actions' },
      h('button', {
        onClick: () => {
          if (!confirm('¿Borrar todas las estadísticas por pregunta?')) return;
          storage.set('stats', emptyStats());
          openStats();
        },
      }, 'Borrar estadísticas'),
    ),
  );
  if (!dialog.open) dialog.showModal();
}

// ------------------------------------------------------- temas y repaso

/** Actualiza solo el botón "Repaso (N)" (sin reconstruir los selectores). */
function refreshReviewBadge() {
  const button = document.getElementById('review-button');
  if (!button) return;
  const due = dueReviews(loadProgress(), Date.now()).length;
  button.textContent = due ? `Repaso (${due})` : 'Repaso';
  button.classList.toggle('review-due', due > 0);
}

// Lo que vence mientras la pestaña está abierta también tiene que avisar.
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refreshReviewBadge());
window.addEventListener('focus', refreshReviewBadge);
window.addEventListener('storage', (ev) => ev.key === 'progress' && refreshReviewBadge());
setInterval(refreshReviewBadge, 60_000);

function openDialog(id, title, ...content) {
  let dialog = document.getElementById(id);
  if (!dialog) {
    dialog = h('dialog', { id, class: 'stats-dialog' });
    document.body.append(dialog);
  }
  dialog.replaceChildren(
    h('div', { class: 'dialog-head' }, h('h2', {}, title), h('button', { class: 'link', onClick: () => dialog.close(), 'aria-label': 'Cerrar' }, 'Cerrar')),
    ...content.filter(Boolean),
  );
  if (!dialog.open) dialog.showModal();
  return dialog;
}

function closeDialogs() {
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
}

function trainTheme(theme) {
  settings.angle = theme;
  saveSettings();
  renderSettings();
  closeDialogs();
  loadPuzzle();
}

/** Repite un ejercicio: el guardado si está en el repaso; si no, se pide a Lichess por su id. */
function replay(rec) {
  closeDialogs();
  loadPuzzle(rec.puzzle ?? rec.id, { srs: Boolean(rec.srs) });
}

/** Carga el repaso pendiente más atrasado; `skipId` salta el que está en pantalla. */
function startReviewSession(skipId) {
  const due = dueReviews(loadProgress(), Date.now());
  const next = due.find((r) => r.id !== skipId);
  if (!next) return openReview();
  closeDialogs();
  loadPuzzle(next.puzzle, { srs: true });
}

function puzzleItem(rec, extra) {
  const last = rec.attempts.at(-1);
  return h('li', { class: 'puzzle-item' },
    h('a', { href: `https://lichess.org/training/${rec.id}`, target: '_blank', rel: 'noopener' }, `#${rec.id}`),
    h('span', { class: 'muted small' }, ` ${rec.rating} · ${rec.attempts.length} ${rec.attempts.length === 1 ? 'intento' : 'intentos'}${last && !last.success ? ' · último fallado' : ''}`),
    extra ? h('span', { class: 'muted small' }, ` · ${extra}`) : null,
    ' ',
    h('button', { class: 'link', 'aria-label': `Repetir el ejercicio ${rec.id}`, onClick: () => replay(rec) }, 'Repetir'),
  );
}

function themeRow(t) {
  const pctText = `${Math.round(t.rate * 100)}%`;
  const tone = t.rate >= 0.75 ? 'good' : t.rate >= 0.5 ? 'info' : 'bad';
  return h('details', { class: 'theme-row' },
    h('summary', {},
      h('span', { class: 'theme-name' }, themeName(t.theme)),
      h('span', { class: 'theme-counts' },
        h('span', { class: 'ok' }, `${t.solved.length} ✔`), ' ', h('span', { class: 'ko' }, `${t.failed.length} ✘`),
        ` · ${pctText}${t.enough ? '' : ' (pocos datos)'}`,
      ),
      bar(t.rate, tone),
    ),
    h('div', { class: 'theme-detail' },
      h('div', { class: 'actions' }, h('button', { class: 'primary', onClick: () => trainTheme(t.theme) }, `Entrenar: ${themeName(t.theme)}`)),
      THEME_HELP[t.theme] ? h('p', { class: 'muted small' }, THEME_HELP[t.theme].text) : null,
      h('div', { class: 'two-cols' },
        h('div', {}, h('h4', {}, `No resueltos (${t.failed.length})`), t.failed.length ? h('ul', {}, t.failed.map((r) => puzzleItem(r, r.srs ? `en repaso, ${dueText(r.srs.due, Date.now())}` : r.learnedAt ? 'aprendido en el repaso' : ''))) : h('p', { class: 'muted small' }, 'Ninguno.')),
        h('div', {}, h('h4', {}, `Resueltos (${t.solved.length})`), t.solved.length ? h('ul', {}, t.solved.map((r) => puzzleItem(r))) : h('p', { class: 'muted small' }, 'Ninguno.')),
      ),
    ),
  );
}

function openThemes() {
  const progress = loadProgress();
  const { groups, weakest, strongest, total, solved, anyEnough } = themeSummary(progress);
  const legacy = legacyCount(progress);
  const legacyNote = legacy > 0
    ? h('p', { class: 'muted small' }, legacy === 1
      ? '1 ejercicio anterior a esta versión no guardaba sus temas y no se cuenta.'
      : `${legacy} ejercicios anteriores a esta versión no guardaban sus temas y no se cuentan.`)
    : null;
  if (!total) {
    return openDialog('themes-dialog', 'Mis temas',
      h('p', {}, 'Todavía no hay ejercicios. Cada ejercicio que termines se clasifica por sus temas de Lichess como resuelto (sin errores, sin pistas y sin ver la solución) o no resuelto.'),
      legacyNote,
    );
  }
  const card = (t, kind) => h('li', { class: `area area-${kind}` },
    h('strong', {}, themeName(t.theme)), ` ${t.solved.length} de ${t.total} (${Math.round(t.rate * 100)}%) `,
    kind === 'weak' ? h('button', { 'aria-label': `Entrenar ${themeName(t.theme)}`, onClick: () => trainTheme(t.theme) }, 'Entrenar') : null,
  );
  openDialog('themes-dialog', 'Mis temas',
    h('p', {}, `${total} ${total === 1 ? 'ejercicio' : 'ejercicios'} · ${solved} ${solved === 1 ? 'resuelto' : 'resueltos'} a la primera (${Math.round((solved / total) * 100)}%).`),
    weakest.length
      ? h('div', {}, h('h3', {}, 'Áreas a estudiar'), h('p', { class: 'muted small' }, 'Los temas con peor porcentaje (con al menos 3 ejercicios). Entrena uno hasta que suba.'), h('ul', { class: 'areas' }, weakest.map((t) => card(t, 'weak'))))
      : h('p', { class: 'muted small' }, anyEnough
        ? 'Sin áreas débiles por ahora: no has fallado ningún tema con 3 o más ejercicios.'
        : 'Con al menos 3 ejercicios de un tema empezaré a señalar tus áreas a estudiar.'),
    strongest.length ? h('div', {}, h('h3', {}, 'Puntos fuertes'), h('ul', { class: 'areas' }, strongest.map((t) => card(t, 'strong')))) : null,
    ...groups.map((g) => h('section', { class: 'theme-group' }, h('h3', {}, g.name), ...g.themes.map(themeRow))),
    legacyNote,
    h('div', { class: 'actions' },
      h('button', {
        onClick: () => {
          if (!confirm('¿Borrar tu progreso por temas y tu repaso?')) return;
          storage.set('progress', emptyProgress());
          refreshReviewBadge();
          openThemes();
        },
      }, 'Borrar progreso'),
    ),
  );
}

function openReview() {
  const progress = loadProgress();
  const now = Date.now();
  const due = dueReviews(progress, now);
  const upcoming = upcomingReviews(progress, now);
  const learned = learnedPuzzles(progress);
  const item = (r) => puzzleItem(r, `${r.themes.slice(0, 3).map(themeName).join(', ')} · caja ${r.srs.box + 1}/${SRS_INTERVALS.length} · fallado ${failCount(r)} ${failCount(r) === 1 ? 'vez' : 'veces'}`);
  openDialog('review-dialog', 'Repaso espaciado',
    h('p', { class: 'muted small' }, `Los ejercicios que no resuelves (con errores, con pistas o viendo la solución) vuelven a los ${SRS_INTERVALS.join(', ')} días. Si lo aciertas cuando toca, pasa a la siguiente caja; si fallas, vuelve a empezar. Al superar la última caja, queda aprendido.`),
    h('div', { class: 'actions' },
      due.length
        ? h('button', { class: 'primary', onClick: () => startReviewSession() }, `Empezar repaso (${due.length})`)
        : h('p', {}, upcoming.length ? `Nada para hoy. El próximo, ${dueText(upcoming[0].srs.due, now)}.` : 'No tienes ejercicios pendientes de repaso.'),
    ),
    due.length ? h('div', {}, h('h3', {}, `Para hoy (${due.length})`), h('ul', { class: 'review-list' }, due.map(item))) : null,
    upcoming.length
      ? h('div', {}, h('h3', {}, `Próximos (${upcoming.length})`), h('ul', { class: 'review-list' }, upcoming.map((r) => puzzleItem(r, `${dueText(r.srs.due, now)} · ${r.themes.slice(0, 3).map(themeName).join(', ')} · caja ${r.srs.box + 1}/${SRS_INTERVALS.length}`))))
      : null,
    learned.length
      ? h('details', {}, h('summary', {}, `Aprendidos (${learned.length})`), h('ul', { class: 'review-list' }, learned.map((r) => puzzleItem(r))))
      : null,
  );
}

// ------------------------------------------------------------------ inicio

renderSettings();
panel.replaceChildren(
  h('section', {},
    h('h2', {}, 'Cómo pensar la siguiente jugada'),
    h('p', {}, 'Cada ejercicio de Lichess se resuelve siguiendo el proceso: calma, candidatas sin calcular, preguntas tácticas, preguntas estratégicas (o de finales) y decisión. El modo "sin tiempo" entrena el otro escenario: intuición y comprobación.'),
    h('p', {}, 'Elige tu nivel y pulsa "Nuevo ejercicio".'),
  ),
);
if (params.get('puzzle')) loadPuzzle(params.get('puzzle'));
