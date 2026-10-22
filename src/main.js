import './styles.css';
import { Chess } from 'chess.js';
import { Board } from './board.js';
import { BLIND_SPOTS, COLOR_NAMES, PIECE_NAMES, blindSpots, describeIdea, evaluateMove, explainLine, findForcingIdea, forcingSweep, load, narratePly, withTurn } from './analysis.js';
import { DEFAULT_DEPTH, ENGINE_SOURCES, StockfishEngine, describeAdvantage, engineMove, evaluateMoves, evaluatePosition, formatScore, pvToSan, toCp, verdict, winChance } from './engine.js';
import { emptyStats, recordExercise, summarize } from './stats.js';
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
  questionPlan,
} from './method.js';

// ----------------------------------------------------------------- utilidades

const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');

function log(...args) {
  if (DEBUG) console.log('[trainer]', ...args);
}

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

const storage = {
  get(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  /** Devuelve false si no se ha podido guardar (almacenamiento lleno o no disponible). */
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
};

const uciToMove = (uci) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
const moveToUci = (m) => m.from + m.to + (m.promotion ?? '');
// El tablero da la pieza al coronar; si faltara, dama (chess.js la ignora si la jugada no corona).
const withPromotion = (m) => ({ from: m.from, to: m.to, promotion: m.promotion ?? 'q' });

// ---------------------------------------------------------------------- estado

const settings = { level: 'casual', angle: 'mix', difficulty: 'normal', mode: 'tiempo', breathing: true, engineOn: false, engineSource: 'stockfish', ...storage.get('settings', {}) };
let state = null;
let timer = null;

const board = new Board($('#board'), { onMove: (m) => onBoardMove(m) });
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
    step: settings.mode === 'tiempo' ? (settings.breathing ? 'calma' : 'candidatas') : 'intuicion',
    candidates: [],
    addingCandidate: false, // en Decisión: el próximo movimiento en el tablero se apunta, no se juega
    notice: null, // aviso de una sola vez (candidata repetida…): se borra al redibujar
    intuition: null,
    questionIndex: 0,
    answers: {}, // id -> { user: boolean, result }
    ply: 0,
    playFen: puzzle.fen,
    lastMove: puzzle.lastMove,
    mistakes: [],
    feedback: null,
    revealed: false,
    hint: 0, // nivel de pista para la jugada actual (0-3)
    hintsUsed: 0,
    startedAt: Date.now(),
  };
}

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
  state.step = step;
  state.questionIndex = 0;
  state.feedback = null;
  state.addingCandidate = false;
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
  const steps = settings.mode === 'tiempo'
    ? [['calma', 'Calma'], ['candidatas', 'Candidatas'], ['tactica', 'Táctica'], ['estrategia', state.plan.endgame ? 'Final' : 'Estrategia'], ['decision', 'Decisión'], ['resolver', 'Jugar'], ['resumen', 'Resumen']]
    : [['intuicion', 'Intuición'], ['comprobacion', 'Comprobar'], ['resolver', 'Jugar'], ['resumen', 'Resumen']];
  const idx = steps.findIndex(([id]) => id === state.step);
  const stepper = h('ol', { class: 'stepper' }, steps.map(([id, label], i) => h('li', { class: i < idx ? 'done' : i === idx ? 'current' : '' }, label)));

  const views = { calma, candidatas, tactica, estrategia, decision, resolver, resumen, intuicion, comprobacion, remate };
  panel.replaceChildren(header, stepper, views[state.step]());
  state.notice = null;
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
  if (step !== 'resumen') board.setPosition(state.playFen, { orientation: state.puzzle.heroColor, lastMove: state.lastMove });
  const noting = ['candidatas', 'tactica', 'estrategia', 'decision'].includes(step);
  board.setInteractive(noting || step === 'intuicion' || (step === 'resolver' && !state.revealed && state.ply < state.puzzle.solution.length));
  if (noting) {
    board.setArrows(state.candidates.map((c) => ({ from: c.move.from, to: c.move.to, tone: 'candidate' })));
  } else if (step === 'comprobacion' && state.intuition) {
    board.setArrows([{ from: state.intuition.move.from, to: state.intuition.move.to, tone: 'candidate' }]);
  } else {
    board.setArrows([]);
  }
  if (step === 'resolver' && state.hint >= 2) {
    const expected = state.puzzle.solution[state.ply];
    board.setMarks(state.hint >= 3 ? { [expected.slice(0, 2)]: 'info', [expected.slice(2, 4)]: 'good' } : { [expected.slice(0, 2)]: 'info' });
  } else if (!['tactica', 'estrategia'].includes(step)) board.setMarks({});
  if (step === 'resumen' && state.review) {
    const pos = state.review.positions[state.review.index];
    board.setPosition(pos.fen, { lastMove: pos.lastMove });
    const focus = state.engineFocus;
    const best = settings.engineOn ? state.review.evals.get(pos.fen)?.pv?.[0] : null;
    if (focus && state.review.index === state.review.puzzleIndex) board.setArrows([{ from: focus.uci.slice(0, 2), to: focus.uci.slice(2, 4), tone: focus.tone }]);
    else if (best) board.setArrows([{ from: best.slice(0, 2), to: best.slice(2, 4), tone: 'good' }]);
    else board.setArrows([]);
  }
  renderBoardNav();
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
    if (left <= 0) go('candidatas');
  }, 1000);
  return h(
    'section',
    {},
    h('h2', {}, '1. Respira y mira la posición sin pensar'),
    h('p', {}, `Inhala ${BREATHING.inhale} segundos, exhala ${BREATHING.exhale}. No calcules: deja que la intuición trabaje. Así evitas jugar "al toque", que es donde nacen muchos errores.`),
    h('div', { class: 'breath' }, circle, phase, counter),
    h('label', { class: 'block' }, '¿Qué te llama la atención? (opcional)', h('textarea', { rows: 2, onInput: (e) => (state.firstImpression = e.target.value) }, state.firstImpression ?? '')),
    h('button', { onClick: () => go('candidatas') }, 'Estoy listo/a'),
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

/** Apunta la jugada como candidata. Si está repetida o ya hay 5, deja un aviso y devuelve false. */
function addCandidate(move) {
  const repeated = state.candidates.find((c) => c.uci === moveToUci(move));
  if (repeated || state.candidates.length >= MAX_CANDIDATES) {
    state.notice = repeated ? `${repeated.san} ya está entre tus candidatas.` : `Ya tienes ${MAX_CANDIDATES} candidatas: quita una para apuntar otra.`;
    return false;
  }
  const ev = evaluateWithIdea(state.puzzle.fen, withPromotion(move));
  if (ev) state.candidates.push(ev);
  return Boolean(ev);
}

function removeCandidate(i) {
  state.candidates.splice(i, 1);
  render();
}

function noticeView() {
  return state.notice ? h('p', { class: 'notice small' }, state.notice) : null;
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
        removable &&
          h('button', { class: 'link', onClick: () => removeCandidate(i) }, 'quitar'),
      ),
    ),
  );
}

function candidatas() {
  const sweep = state.sweep;
  return h(
    'section',
    {},
    h('h2', {}, `2. Hasta ${MAX_CANDIDATES} jugadas candidatas, sin calcular`),
    h('p', {}, 'Mueve en el tablero las jugadas que se te ocurran (no se juegan, solo se apuntan). No entres en variantes todavía: muchos cálculos acaban en líneas que nunca aparecen.'),
    candidateList(true),
    noticeView(),
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

function questionView(questions, title, intro, onDone) {
  const q = questions[state.questionIndex];
  if (!q) {
    onDone();
    return h('div');
  }
  const answer = state.answers[q.id];
  const children = [
    h('h2', {}, title),
    intro && h('p', { class: 'muted' }, intro),
    h('p', { class: 'progress' }, `Pregunta ${state.questionIndex + 1} de ${questions.length}`),
    h('h3', {}, q.text),
    h('p', { class: 'hint' }, q.hint),
  ];
  if (!answer) {
    const pick = (user) => {
      const result = answerQuestion(q.id, state.puzzle.fen, state.puzzle.heroColor);
      state.answers[q.id] = { user, result };
      log('question', q.id, { user, result });
      render();
      showFindings(result.findings);
    };
    if (q.open) {
      // Se guarda al escribir: apuntar una candidata en el tablero redibuja la pregunta.
      const note = h('textarea', { rows: 2, placeholder: 'Escribe tu idea (opcional)', onInput: (e) => { state.notes = { ...state.notes, [q.id]: e.target.value }; } }, state.notes?.[q.id] ?? '');
      children.push(
        h('label', { class: 'block' }, 'Tu respuesta:', note),
        h('div', { class: 'actions' }, h('button', { class: 'primary', onClick: () => pick(null) }, 'Ver el análisis')),
      );
    } else {
      children.push(h('div', { class: 'actions' }, h('button', { onClick: () => pick(true) }, 'Sí'), h('button', { onClick: () => pick(false) }, 'No'), h('button', { class: 'link', onClick: () => pick(null) }, 'No lo sé')));
    }
  } else {
    const { user, result } = answer;
    const verdict = q.open
      ? 'Pregunta abierta: no hay respuesta correcta o incorrecta. Contrasta tu idea con esto:'
      : user === null ? 'Lo importante es hacerse la pregunta. Mira lo que hay:' : user === result.yes ? '¡Bien visto!' : result.yes ? 'Había algo: revisa con calma.' : 'Esta vez no había nada relevante.';
    children.push(
      q.open && state.notes?.[q.id] ? h('p', {}, h('strong', {}, 'Tu idea: '), state.notes[q.id]) : null,
      h('p', { class: `verdict ${q.open || user === result.yes ? 'ok' : 'ko'}` }, verdict),
      findingsList(result.findings),
      h('p', { class: 'muted small' }, 'Pulsa una línea para verla en el tablero. Verde: a tu favor. Rojo: peligro para ti.'),
      h('div', { class: 'actions' },
        h('button', { class: 'primary', onClick: () => { state.questionIndex++; board.setMarks({}); render(); } }, state.questionIndex + 1 < questions.length ? 'Siguiente pregunta' : 'Continuar'),
      ),
    );
  }
  return h('section', {}, ...children, candidateReminder());
}

function findingsList(findings) {
  if (!findings.length) return h('p', { class: 'muted' }, 'El análisis no encuentra nada destacable.');
  return h('ul', { class: 'findings' }, findings.map((f) => h('li', { class: `tone-${f.tone}`, onClick: () => showFindings([f]) }, f.text)));
}

function showFindings(findings) {
  const marks = {};
  for (const f of findings) for (const sq of f.squares) marks[sq] ??= f.tone;
  board.setMarks(marks);
}

function candidateReminder() {
  const full = state.candidates.length >= MAX_CANDIDATES;
  return h('div', { class: 'reminder' },
    h('p', { class: 'small' },
      h('strong', {}, `¿Te sugiere una candidata nueva? (${state.candidates.length}/${MAX_CANDIDATES}) `),
      full ? 'Ya tienes el máximo: quita una para apuntar otra.' : 'Muévela en el tablero: se apunta, no se juega.'),
    noticeView(),
    candidateList(true),
  );
}

function tactica() {
  return questionView(state.plan.tactical, '3. Preguntas tácticas', `${LEVELS[settings.level].tacticalNote} Fíjate en los dos colores.`, () => queueMicrotask(() => go('estrategia')));
}

function estrategia() {
  const { plan } = state;
  const title = plan.endgame ? '4. Preguntas de finales' : '4. Preguntas estratégicas';
  const intro = plan.endgame ? 'Sin damas en el tablero: cambian las preguntas.' : LEVELS[settings.level].strategicNote;
  const tacticalHits = plan.tactical.filter((q) => state.answers[q.id]?.result.yes).length;
  if (!state.forceStrategy && state.questionIndex === 0 && !state.answers[plan.strategic[0]?.id] && !plan.endgame && tacticalHits >= 3) {
    return h('section', {},
      h('h2', {}, title),
      h('p', {}, `Las preguntas tácticas han dado ${tacticalHits} "síes". Cuando la táctica funciona, la estrategia puede esperar.`),
      h('div', { class: 'actions' },
        h('button', { class: 'primary', onClick: () => go('decision') }, 'Ir a decidir'),
        h('button', { onClick: () => { state.forceStrategy = true; render(); } }, 'Hacer igualmente las preguntas'),
      ),
      candidateReminder(),
    );
  }
  return questionView(plan.strategic, title, intro, () => queueMicrotask(() => go('decision')));
}

// ------------------------------------------------------------- decisión

function decision() {
  const rows = state.candidates.map((c, i) =>
    h('tr', {},
      h('td', {}, h('strong', {}, c.san)),
      h('td', { class: 'yes' }, String(c.yesCount)),
      h('td', {}, c.tags.length ? h('ul', {}, c.tags.map((t) => h('li', {}, t.text))) : h('span', { class: 'muted' }, '—'),
        c.warnings.length ? h('ul', { class: 'warnings' }, c.warnings.map((w) => h('li', {}, `⚠ ${w}`))) : null),
      h('td', {},
        h('button', { class: 'primary', onClick: () => playFirstMove(c.move) }, 'Jugar'),
        h('button', { class: 'link', onClick: () => removeCandidate(i) }, 'quitar'),
      ),
    ),
  );
  const full = state.candidates.length >= MAX_CANDIDATES;
  const adding = state.addingCandidate;
  return h('section', {},
    h('h2', {}, '5. Decide'),
    h('p', {}, 'La mejor jugada suele responder SÍ a varias preguntas. Compara tus candidatas y revisa los avisos (qué dejas colgado).'),
    state.candidates.length
      ? h('table', { class: 'decision' }, h('thead', {}, h('tr', {}, h('th', {}, 'Jugada'), h('th', {}, 'Síes'), h('th', {}, 'Qué consigue'), h('th', {}))), h('tbody', {}, rows))
      : h('p', { class: 'muted' }, 'No apuntaste candidatas.'),
    noticeView(),
    h('div', { class: 'actions' },
      h('button', {
        class: adding ? 'toggle on' : 'toggle',
        'aria-pressed': String(adding),
        disabled: full,
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
    h('h2', {}, `1. ${s.text}`),
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
    h('h2', {}, `2. ${s.text}`),
    h('p', {}, s.hint),
    h('h3', {}, `Tu jugada: ${ev.san}`),
    ev.tags.length ? h('ul', {}, ev.tags.map((t) => h('li', {}, t.text))) : h('p', { class: 'muted' }, 'No da jaque, no captura y no amenaza nada concreto.'),
    ev.warnings.length
      ? h('ul', { class: 'warnings' }, ev.warnings.map((w) => h('li', {}, `⚠ ${w}`)))
      : h('p', { class: 'ok' }, 'No deja nada colgado a primera vista.'),
    dangers.length ? h('div', {}, h('p', {}, 'Antes de mover, peligros que ya había en la posición:'), findingsList(dangers)) : null,
    h('div', { class: 'actions' },
      h('button', { class: 'primary', onClick: () => onBoardMove(ev.move) }, `Jugar ${ev.san}`),
      h('button', { onClick: () => { state.intuition = null; go('intuicion'); } }, 'Cambiar de jugada'),
    ),
  );
}

// ------------------------------------------------------------- resolver

function onBoardMove(move) {
  if (!state) return;
  switch (state.step) {
    case 'candidatas':
      addCandidate(move);
      return render();
    case 'tactica':
    case 'estrategia':
      // La lista queda debajo de la pregunta: un aviso confirma que se apuntó (y que no se jugó).
      if (addCandidate(move)) state.notice = `${state.candidates.at(-1).san} apuntada como candidata.`;
      return render();
    case 'intuicion': {
      const ev = evaluateWithIdea(state.puzzle.fen, withPromotion(move));
      if (!ev) return;
      state.intuition = ev;
      return go('comprobacion');
    }
    case 'decision':
      if (!state.addingCandidate) return playFirstMove(move);
      // Si no se apunta (repetida), el modo sigue activo: el siguiente movimiento tampoco se juega.
      if (addCandidate(move)) state.addingCandidate = false;
      return render();
    case 'comprobacion':
      return playFirstMove(move);
    case 'resolver':
      return playUserMove(move);
    case 'remate':
      return finaleMove(move);
    default:
      return undefined;
  }
}

/** Primera jugada del ejercicio, desde Decisión o Comprobar. */
function playFirstMove(move) {
  go('resolver');
  playUserMove(move);
}

function playUserMove(move) {
  const { puzzle } = state;
  const expected = puzzle.solution[state.ply];
  if (!expected) return;
  const full = withPromotion(move);
  const chess = load(state.playFen);
  let played;
  try {
    played = chess.move(full);
  } catch {
    return;
  }
  const uci = moveToUci(played);
  // Lichess acepta cualquier mate aunque no sea la jugada registrada.
  const correct = uci === expected || chess.isCheckmate();
  log('move', { uci, expected, correct });
  if (!correct) {
    const ev = evaluateMove(state.playFen, full);
    state.mistakes.push({ ply: state.ply, fen: state.playFen, uci, san: played.san, expected, ev });
    saveProgress(false);
    state.feedback = { type: 'ko', ev };
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
  render();
  board.setInteractive(false);
  const current = state;
  setTimeout(() => {
    if (state !== current || current.revealed) return;
    const reply = chess.move(uciToMove(puzzle.solution[state.ply]));
    state.ply++;
    state.hint = 0;
    state.playFen = chess.fen();
    state.lastMove = { from: reply.from, to: reply.to };
    state.feedback = { type: 'reply', san: reply.san };
    board.setPosition(state.playFen, { lastMove: state.lastMove });
    render();
  }, 600);
}

function revealSolution() {
  if (state.revealed) return;
  state.revealed = true;
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
  const children = [h('h2', {}, settings.mode === 'tiempo' ? '6. Juega tu decisión' : '3. Juega')];
  if (!feedback) children.push(h('p', {}, 'Mueve en el tablero. El rival responderá automáticamente.'));
  else if (feedback.type === 'ok') children.push(h('p', { class: 'ok' }, `✔ ${feedback.san} es correcta.`));
  else if (feedback.type === 'reply') children.push(h('p', {}, `El rival responde ${feedback.san}. Tu turno: vuelve a hacerte las preguntas tácticas, sobre todo "¿hay mate?".`));
  else if (feedback.type === 'ko') {
    const { ev } = feedback;
    children.push(
      h('p', { class: 'ko' }, `✘ ${ev.san} no es la jugada del ejercicio.`),
      ev.warnings.length ? h('ul', { class: 'warnings' }, ev.warnings.map((w) => h('li', {}, `⚠ ${w}`))) : h('p', { class: 'muted' }, 'No deja nada colgado a simple vista, pero hay algo más fuerte.'),
      h('p', {}, 'Pista: ¿qué preguntas responden SÍ? Busca jaques, capturas y amenazas, para ti y para el rival.'),
    );
  }
  if (state.revealed) {
    children.push(h('p', { class: 'muted' }, 'Mostrando la solución…'));
    return h('section', {}, ...children);
  }
  if (state.hint) children.push(hintView());
  children.push(h('div', { class: 'actions' },
    state.hint < 3 ? h('button', { onClick: nextHint }, `Pista (${state.hint + 1}/3)`) : null,
    h('button', { onClick: revealSolution }, 'Ver la solución'),
  ));
  return h('section', {}, ...children);
}

const QUESTION_BY_ID = Object.fromEntries(TACTICAL_QUESTIONS.map((q) => [q.id, q.text]));

function nextHint() {
  state.hint++;
  state.hintsUsed++;
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
  history.unshift({ id: puzzle.id, rating: puzzle.rating, solved: state.solved, clean: state.success, mistakes: state.mistakes.length, level: settings.level, mode: settings.mode, date: new Date().toISOString() });
  storage.set('history', history.slice(0, 200));
  // Estadísticas por pregunta: qué preguntas señalaban la jugada clave.
  const key = evaluateWithIdea(puzzle.fen, uciToMove(puzzle.solution[0]));
  const tried = settings.mode === 'tiempo' ? state.candidates.map((c) => c.uci) : [state.intuition?.uci].filter(Boolean);
  state.keyInCandidates = tried.includes(puzzle.solution[0]);
  state.blind = blindSpots(puzzle.fen, puzzle.solution[0], tried);
  storage.set('stats', recordExercise(storage.get('stats', emptyStats()), {
    answers: state.answers,
    notes: state.notes,
    keyQuestions: key ? [...new Set(key.tags.map((t) => t.q))] : [],
    keyInCandidates: settings.mode === 'tiempo' ? state.keyInCandidates : null,
    blind: state.blind,
    hintsUsed: state.hintsUsed,
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
    settings.mode === 'tiempo'
      ? h('p', { class: state.keyInCandidates ? 'ok' : 'ko' }, state.keyInCandidates ? 'La jugada clave estaba entre tus candidatas. La técnica de candidatas funciona.' : 'La jugada clave no estaba entre tus candidatas. Repasa: ¿qué pregunta te habría llevado a ella?')
      : h('p', { class: state.keyInCandidates ? 'ok' : 'ko' }, state.keyInCandidates ? 'Tu intuición acertó.' : `Tu intuición fue ${state.intuition?.san ?? '—'}. Con más tiempo, el proceso completo ayuda a corregirla.`),
    !state.keyInCandidates && state.blind?.length
      ? h('p', { class: 'blind' }, h('strong', {}, 'Por qué pudo costarte verla: '), `es ${state.blind.map((b) => BLIND_SPOTS[b]).join('; ')}. Estos son puntos ciegos frecuentes: tenlos en cuenta en el barrido.`)
      : null,
    missed.length ? h('div', {}, h('p', {}, 'Preguntas en las que tu respuesta no coincidió con el análisis:'), h('ul', {}, missed.map(([id]) => h('li', {}, questionText(id))))) : null,
    state.firstImpression ? h('p', {}, h('strong', {}, 'Tu primera impresión: '), state.firstImpression) : null,
    progressNote(),
    state.hintsUsed ? h('p', { class: 'muted small' }, `Pistas usadas: ${state.hintsUsed}.`) : null,
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
    evaluateShownPosition();
  } catch (err) {
    if (run !== engineRun) return;
    console.error(err);
    Object.assign(state.engine, { status: 'error', error: err.message });
  }
  render();
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
    m = chess.move(withPromotion(move));
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
