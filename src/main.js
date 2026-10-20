import './styles.css';
import { Board } from './board.js';
import { COLOR_NAMES, evaluateMove, load } from './analysis.js';
import { DEFAULT_DEPTH, ENGINE_SOURCES, StockfishEngine, evaluateMoves, formatScore, pvToSan, toCp, verdict } from './engine.js';
import { DIFFICULTIES, THEMES, fetchDailyPuzzle, fetchNextPuzzle, fetchPuzzleById, themeName } from './lichess.js';
import {
  BREATHING,
  INTUITION_SECONDS,
  LEVELS,
  MAX_CANDIDATES,
  MODES,
  NO_TIME_STEPS,
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
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* almacenamiento no disponible: no pasa nada */
    }
  },
};

const uciToMove = (uci) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });

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
    intuition: null,
    questionIndex: 0,
    answers: {}, // id -> { user: boolean, result }
    ply: 0,
    playFen: puzzle.fen,
    lastMove: puzzle.lastMove,
    mistakes: [],
    feedback: null,
    revealed: false,
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
  $('#settings').replaceChildren(
    h('label', {}, 'Nivel ', select('level', levelOptions)),
    h('label', {}, 'Modo ', select('mode', MODES)),
    h('label', {}, 'Tema ', select('angle', THEMES)),
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
  );
}

async function loadPuzzle(source) {
  stopTimer();
  cancelEngine();
  panel.replaceChildren(h('p', { class: 'muted' }, 'Pidiendo un ejercicio a Lichess…'));
  try {
    const puzzle =
      source === 'daily'
        ? await fetchDailyPuzzle()
        : source
          ? await fetchPuzzleById(source)
          : await fetchNextPuzzle({ angle: settings.angle, difficulty: settings.difficulty });
    log('puzzle', puzzle);
    state = newState(puzzle);
    // Muestra la posición anterior y luego la jugada del rival, como en Lichess.
    board.setInteractive(false);
    board.setMarks({});
    board.setArrows([]);
    board.setPosition(puzzle.fenBefore, { orientation: puzzle.heroColor });
    setTimeout(() => {
      board.setPosition(puzzle.fen, { orientation: puzzle.heroColor, lastMove: puzzle.lastMove });
      render();
    }, 700);
    panel.replaceChildren(h('p', { class: 'muted' }, `El rival juega ${puzzle.lastMove?.san ?? ''}…`));
  } catch (err) {
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
  log('step', step);
  render();
}

function render() {
  if (!state) return;
  const { puzzle } = state;
  const header = h(
    'div',
    { class: 'puzzle-head' },
    h('span', { class: `side side-${puzzle.heroColor}` }, `Juegan ${COLOR_NAMES[puzzle.heroColor]}`),
    h('span', { class: 'muted' }, ` · Rival: ${puzzle.lastMove?.san} · Puzzle ${puzzle.id}${state.step === 'resumen' ? ` (${puzzle.rating})` : ''}`),
  );
  const steps = settings.mode === 'tiempo'
    ? [['calma', 'Calma'], ['candidatas', 'Candidatas'], ['tactica', 'Táctica'], ['estrategia', state.plan.endgame ? 'Final' : 'Estrategia'], ['decision', 'Decisión'], ['resolver', 'Jugar'], ['resumen', 'Repaso']]
    : [['intuicion', 'Intuición'], ['comprobacion', 'Comprobar'], ['resolver', 'Jugar'], ['resumen', 'Repaso']];
  const idx = steps.findIndex(([id]) => id === state.step);
  const stepper = h('ol', { class: 'stepper' }, steps.map(([id, label], i) => h('li', { class: i < idx ? 'done' : i === idx ? 'current' : '' }, label)));

  const views = { calma, candidatas, tactica, estrategia, decision, resolver, resumen, intuicion, comprobacion };
  panel.replaceChildren(header, stepper, views[state.step]());
  if (DEBUG) panel.append(h('details', { class: 'debug' }, h('summary', {}, 'Depuración'), h('pre', {}, JSON.stringify({ ...state, plan: undefined }, null, 2))));
  syncBoard();
}

function syncBoard() {
  const { step } = state;
  board.setInteractive(['candidatas', 'intuicion', 'decision', 'resolver'].includes(step) && !(step === 'resolver' && state.ply >= state.puzzle.solution.length));
  if (step === 'candidatas' || step === 'decision') {
    board.setArrows(state.candidates.map((c) => ({ from: c.move.from, to: c.move.to, tone: 'candidate' })));
  } else if (step === 'comprobacion' && state.intuition) {
    board.setArrows([{ from: state.intuition.move.from, to: state.intuition.move.to, tone: 'candidate' }]);
  } else if (step !== 'tactica' && step !== 'estrategia') {
    board.setArrows([]);
  }
  if (!['tactica', 'estrategia'].includes(step)) board.setMarks({});
  if (step === 'resumen' && state.engineFocus) {
    const { uci, tone } = state.engineFocus;
    board.setPosition(state.puzzle.fen, { lastMove: state.puzzle.lastMove });
    board.setArrows([{ from: uci.slice(0, 2), to: uci.slice(2, 4), tone }]);
  }
}

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

function addCandidate(move) {
  const ev = evaluateMove(state.puzzle.fen, move);
  if (!ev || state.candidates.some((c) => c.uci === ev.uci)) return;
  if (state.candidates.length >= MAX_CANDIDATES) return;
  state.candidates.push(ev);
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
        removable &&
          h('button', {
            class: 'link',
            onClick: () => {
              state.candidates.splice(i, 1);
              render();
            },
          }, 'quitar'),
      ),
    ),
  );
}

function candidatas() {
  return h(
    'section',
    {},
    h('h2', {}, `2. Hasta ${MAX_CANDIDATES} jugadas candidatas, sin calcular`),
    h('p', {}, 'Mueve en el tablero las jugadas que se te ocurran (no se juegan, solo se apuntan). No entres en variantes todavía: muchos cálculos acaban en líneas que nunca aparecen.'),
    candidateList(true),
    h('div', { class: 'actions' },
      h('button', { class: 'primary', onClick: () => go('tactica') }, state.candidates.length ? 'Pasar a las preguntas' : 'No se me ocurre nada: hazme preguntas'),
    ),
    h('p', { class: 'muted small' }, 'Si no te convence lo que ves, las preguntas te ayudarán a generar candidatas.'),
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
    children.push(h('div', { class: 'actions' }, h('button', { onClick: () => pick(true) }, 'Sí'), h('button', { onClick: () => pick(false) }, 'No'), h('button', { class: 'link', onClick: () => pick(null) }, 'No lo sé')));
  } else {
    const { user, result } = answer;
    const verdict = user === null ? 'Lo importante es hacerse la pregunta. Mira lo que hay:' : user === result.yes ? '¡Bien visto!' : result.yes ? 'Había algo: revisa con calma.' : 'Esta vez no había nada relevante.';
    children.push(
      h('p', { class: `verdict ${user === result.yes ? 'ok' : 'ko'}` }, verdict),
      findingsList(result.findings),
      h('p', { class: 'muted small' }, 'Pulsa una línea para verla en el tablero. Verde: a tu favor. Rojo: peligro para ti.'),
      h('div', { class: 'actions' },
        h('button', { class: 'primary', onClick: () => { state.questionIndex++; board.setMarks({}); render(); } }, state.questionIndex + 1 < questions.length ? 'Siguiente pregunta' : 'Continuar'),
      ),
    );
    if (state.step === 'tactica' || state.step === 'estrategia') children.push(candidateReminder());
  }
  return h('section', {}, ...children);
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
  return h('details', { class: 'reminder' },
    h('summary', {}, `¿Te sugiere una candidata nueva? (${state.candidates.length}/${MAX_CANDIDATES})`),
    h('p', { class: 'small' }, 'Puedes añadirla en el paso de decisión.'),
    candidateList(false),
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
    );
  }
  return questionView(plan.strategic, title, intro, () => queueMicrotask(() => go('decision')));
}

// ------------------------------------------------------------- decisión

function decision() {
  const rows = state.candidates.map((c) =>
    h('tr', {},
      h('td', {}, h('strong', {}, c.san)),
      h('td', { class: 'yes' }, String(c.yesCount)),
      h('td', {}, c.tags.length ? h('ul', {}, c.tags.map((t) => h('li', {}, t.text))) : h('span', { class: 'muted' }, '—'),
        c.warnings.length ? h('ul', { class: 'warnings' }, c.warnings.map((w) => h('li', {}, `⚠ ${w}`))) : null),
      h('td', {}, h('button', { class: 'primary', onClick: () => onBoardMove(c.move) }, 'Jugar')),
    ),
  );
  return h('section', {},
    h('h2', {}, '5. Decide'),
    h('p', {}, 'La mejor jugada suele responder SÍ a varias preguntas. Compara tus candidatas y revisa los avisos (qué dejas colgado).'),
    state.candidates.length
      ? h('table', { class: 'decision' }, h('thead', {}, h('tr', {}, h('th', {}, 'Jugada'), h('th', {}, 'Síes'), h('th', {}, 'Qué consigue'), h('th', {}))), h('tbody', {}, rows))
      : h('p', { class: 'muted' }, 'No apuntaste candidatas.'),
    h('p', { class: 'small' }, 'También puedes jugar directamente cualquier jugada en el tablero.'),
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
      return addCandidate(move);
    case 'intuicion': {
      const ev = evaluateMove(state.puzzle.fen, withPromotion(move, 0));
      if (!ev) return;
      state.intuition = ev;
      return go('comprobacion');
    }
    case 'decision':
      go('resolver');
      return playUserMove(move);
    case 'comprobacion':
      go('resolver');
      return playUserMove(move);
    case 'resolver':
      return playUserMove(move);
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
  if (!correct) {
    const ev = evaluateMove(state.playFen, full);
    state.mistakes.push({ ply: state.ply, san: played.san, expected, ev });
    state.feedback = { type: 'ko', ev };
    render();
    return;
  }
  state.feedback = { type: 'ok', san: played.san };
  state.ply++;
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
  setTimeout(() => {
    const reply = chess.move(uciToMove(puzzle.solution[state.ply]));
    state.ply++;
    state.playFen = chess.fen();
    state.lastMove = { from: reply.from, to: reply.to };
    state.feedback = { type: 'reply', san: reply.san };
    board.setPosition(state.playFen, { lastMove: state.lastMove });
    render();
  }, 600);
}

function revealSolution() {
  state.revealed = true;
  const chess = load(state.playFen);
  const rest = state.puzzle.solution.slice(state.ply);
  const sans = rest.map((u) => chess.move(uciToMove(u)).san);
  state.revealedLine = sans;
  let i = 0;
  const replay = load(state.playFen);
  board.setInteractive(false);
  const stepFn = () => {
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
  children.push(h('div', { class: 'actions' }, h('button', { onClick: revealSolution }, 'Ver la solución')));
  return h('section', {}, ...children);
}

// --------------------------------------------------------------- resumen

function finish(solved) {
  const { puzzle } = state;
  state.solved = solved && state.mistakes.length === 0;
  const history = storage.get('history', []);
  history.unshift({ id: puzzle.id, rating: puzzle.rating, solved: state.solved, mistakes: state.mistakes.length, level: settings.level, mode: settings.mode, date: new Date().toISOString() });
  storage.set('history', history.slice(0, 200));
  go('resumen');
  if (settings.engineOn) startEngine();
}

function resumen() {
  const { puzzle } = state;
  const key = evaluateMove(puzzle.fen, uciToMove(puzzle.solution[0]));
  const solutionInCandidates = state.candidates.some((c) => c.uci === key.uci) || state.intuition?.uci === key.uci;
  const missed = Object.entries(state.answers).filter(([, a]) => a && a.user !== null && a.user !== a.result.yes);
  const history = storage.get('history', []);
  const solvedCount = history.filter((x) => x.solved).length;
  const line = (() => {
    const c = load(puzzle.fen);
    return puzzle.solution.map((u) => c.move(uciToMove(u)).san).join(' ');
  })();

  return h('section', {},
    h('h2', {}, state.solved ? '¡Resuelto!' : state.mistakes.length ? 'Resuelto con errores' : 'Solución vista'),
    h('p', {}, h('strong', {}, 'Solución: '), line),
    h('p', {}, h('strong', {}, 'Temas: '), puzzle.themes.map(themeName).join(', ')),
    h('p', {}, h('strong', {}, `Clave ${key.san}: `), key.tags.length ? key.tags.map((t) => t.text).join('; ') : 'jugada tranquila: no da jaque ni captura; aquí cuentan las preguntas estratégicas.'),
    settings.mode === 'tiempo'
      ? h('p', { class: solutionInCandidates ? 'ok' : 'ko' }, solutionInCandidates ? 'La jugada clave estaba entre tus candidatas. La técnica de candidatas funciona.' : 'La jugada clave no estaba entre tus candidatas. Repasa: ¿qué pregunta te habría llevado a ella?')
      : h('p', { class: state.intuition?.uci === key.uci ? 'ok' : 'ko' }, state.intuition?.uci === key.uci ? 'Tu intuición acertó.' : `Tu intuición fue ${state.intuition?.san ?? '—'}. Con más tiempo, el proceso completo ayuda a corregirla.`),
    missed.length ? h('div', {}, h('p', {}, 'Preguntas en las que tu respuesta no coincidió con el análisis:'), h('ul', {}, missed.map(([id]) => h('li', {}, questionText(id))))) : null,
    state.firstImpression ? h('p', {}, h('strong', {}, 'Tu primera impresión: '), state.firstImpression) : null,
    h('p', { class: 'muted small' }, `Dificultad Lichess: ${puzzle.rating} · Has resuelto ${solvedCount} de ${history.length} ejercicios en este navegador.`),
    h('p', {}, h('a', { href: puzzle.puzzleUrl, target: '_blank', rel: 'noopener' }, 'Ver en Lichess'), ' · ', h('a', { href: puzzle.gameUrl, target: '_blank', rel: 'noopener' }, 'Partida original')),
    engineSection(),
    h('div', { class: 'actions' }, h('button', { class: 'primary', onClick: () => loadPuzzle() }, 'Siguiente ejercicio')),
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
  for (const m of state.mistakes) if (m.ply === 0) add(m.ev.uci, 'jugada fallida');
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
    if (source === 'stockfish') engine ??= new StockfishEngine();
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
  } catch (err) {
    if (run !== engineRun) return;
    console.error(err);
    Object.assign(state.engine, { status: 'error', error: err.message });
  }
  render();
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
  } else if (ev.source === 'cloud' && ev.status !== 'running') {
    box.append(h('p', { class: 'muted small' }, 'La nube de Lichess no tiene esta posición analizada. Prueba con Stockfish.'));
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
          syncBoard();
        };
        return h('tr', { class: state.engineFocus?.uci === r.uci ? 'focus' : '', onClick: focus },
          h('td', {}, h('strong', {}, san[0] ?? r.uci), h('div', { class: 'muted small' }, ev.origin.get(r.uci)?.join(', '))),
          h('td', { class: 'score' }, r.available ? formatScore(r.score) : '—'),
          h('td', {}, v ? h('span', { class: `badge tone-${v.tone}` }, v.label) : h('span', { class: 'muted small' }, 'sin datos en la nube')),
          h('td', { class: 'muted small' }, san.slice(1).join(' ')),
        );
      })),
    ));
  }
  if (ev.status === 'running') {
    const total = ev.origin.size;
    box.append(h('p', { class: 'muted small' }, `Analizando… ${ev.rows.length}/${total}${ev.source === 'stockfish' ? ` (profundidad ${DEFAULT_DEPTH})` : ''}`));
  } else {
    box.append(h('p', { class: 'muted small' }, 'Pulsa una jugada para verla en el tablero. Evaluación desde tu punto de vista: positivo es bueno para ti.'));
  }
  return box;
}

function questionText(id) {
  return [...state.plan.tactical, ...state.plan.strategic].find((q) => q.id === id)?.text ?? id;
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
