// Evaluación real de jugadas: Stockfish WASM en un Web Worker o la nube de
// análisis de Lichess. Todas las puntuaciones se devuelven desde el punto de
// vista de quien resuelve el ejercicio (positivo = bueno para ti).
import { Chess } from 'chess.js';

export const ENGINE_SOURCES = {
  stockfish: 'Stockfish 19 (WASM, en tu navegador)',
  cloud: 'Nube de análisis de Lichess',
};

export const STOCKFISH_URL = `${import.meta.env?.BASE_URL ?? '/'}stockfish/stockfish-19-lite-single.js`;
export const DEFAULT_DEPTH = 15;
const MATE_CP = 100000;

/** Convierte una puntuación en centipeones comparables (los mates, al extremo). */
export function toCp({ cp, mate }) {
  if (mate != null) return mate > 0 ? MATE_CP - mate : -MATE_CP - mate;
  return cp ?? 0;
}

export function formatScore(score) {
  if (!score) return '—';
  if (score.mate != null) return score.mate > 0 ? `#${score.mate}` : `#-${-score.mate}`;
  const v = score.cp / 100;
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
}

/** Clasificación por pérdida respecto a la mejor jugada (umbrales tipo Lichess). */
export function verdict(loss, score) {
  if (score?.mate != null && score.mate > 0 && loss <= 0) return { label: 'Mejor', tone: 'good' };
  if (loss <= 20) return { label: 'Mejor', tone: 'good' };
  if (loss <= 50) return { label: 'Buena', tone: 'good' };
  if (loss <= 100) return { label: 'Imprecisión', tone: 'info' };
  if (loss <= 300) return { label: 'Error', tone: 'bad' };
  return { label: 'Error grave', tone: 'bad' };
}

/** Lee una línea UCI "info ... score ... pv ..." (puntuación para el bando que mueve). */
export function parseInfo(line) {
  if (!line.startsWith('info') || !line.includes(' score ')) return null;
  const t = line.split(' ');
  const at = (key) => t.indexOf(key);
  const s = at('score');
  const kind = t[s + 1];
  const value = Number(t[s + 2]);
  if (t[s + 3] === 'lowerbound' || t[s + 3] === 'upperbound') return null;
  const pvAt = at('pv');
  return {
    depth: Number(t[at('depth') + 1]),
    multipv: at('multipv') >= 0 ? Number(t[at('multipv') + 1]) : 1,
    score: kind === 'mate' ? { mate: value } : { cp: value },
    pv: pvAt >= 0 ? t.slice(pvAt + 1) : [],
  };
}

/** Pasa una línea en UCI a notación SAN desde `fen`. */
export function pvToSan(fen, pv, limit = 6) {
  const chess = new Chess(fen);
  const out = [];
  for (const uci of pv.slice(0, limit)) {
    try {
      out.push(chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san);
    } catch {
      break;
    }
  }
  return out;
}

const negate = (s) => (s.mate != null ? { mate: -s.mate } : { cp: -s.cp });

// ----------------------------------------------------------------- Stockfish

export class StockfishEngine {
  constructor(url = STOCKFISH_URL, WorkerImpl = globalThis.Worker) {
    this.url = url;
    this.WorkerImpl = WorkerImpl;
    this.worker = null;
    this.listeners = new Set();
    this.queue = Promise.resolve();
  }

  #send(cmd) {
    this.worker.postMessage(cmd);
  }

  #waitFor(predicate, onLine) {
    return new Promise((resolve, reject) => {
      const listener = (line) => {
        onLine?.(line);
        if (predicate(line)) {
          this.listeners.delete(listener);
          resolve(line);
        }
      };
      listener.reject = reject;
      this.listeners.add(listener);
    });
  }

  async init() {
    if (this.worker) return;
    this.worker = new this.WorkerImpl(this.url);
    this.worker.onmessage = (ev) => {
      const line = typeof ev.data === 'string' ? ev.data : String(ev.data);
      for (const l of [...this.listeners]) l(line);
    };
    this.worker.onerror = (ev) => {
      for (const l of [...this.listeners]) l.reject?.(new Error(`No se pudo cargar Stockfish (${ev.message ?? 'error del worker'})`));
      this.listeners.clear();
    };
    const ready = this.#waitFor((l) => l === 'uciok');
    this.#send('uci');
    await ready;
    const ok = this.#waitFor((l) => l === 'readyok');
    this.#send('isready');
    await ok;
  }

  /** Evalúa `fen` (opcionalmente solo la jugada `move`). Las búsquedas se encolan. */
  evaluate(fen, { depth = DEFAULT_DEPTH, move, multipv = 1 } = {}) {
    const run = async () => {
      await this.init();
      const lines = new Map();
      const done = this.#waitFor(
        (l) => l.startsWith('bestmove'),
        (l) => {
          const info = parseInfo(l);
          if (info) lines.set(info.multipv, info);
        },
      );
      this.#send(`setoption name MultiPV value ${multipv}`);
      this.#send(`position fen ${fen}`);
      this.#send(`go depth ${depth}${move ? ` searchmoves ${move}` : ''}`);
      const best = await done;
      const bestMove = best.split(' ')[1];
      const last = lines.get(1);
      // Las mejores `multipv` líneas, ordenadas (solo las de la última profundidad completa).
      const top = [...lines.values()].filter((x) => x.depth === last?.depth).sort((a, b) => a.multipv - b.multipv).map((x) => ({ score: x.score, pv: x.pv }));
      if (!last) return { score: { cp: 0 }, pv: bestMove && bestMove !== '(none)' ? [bestMove] : [], depth: 0, top: [] };
      return { score: last.score, pv: last.pv, depth: last.depth, top };
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  terminate() {
    this.worker?.terminate();
    this.worker = null;
    for (const l of this.listeners) l.reject?.(new Error('Motor detenido'));
    this.listeners.clear();
    this.queue = Promise.resolve();
  }
}

// ------------------------------------------------------- Nube de Lichess

/** Evaluación de la nube (desde el punto de vista de las blancas), o null si no la hay. */
export async function fetchCloudEval(fen, { multiPv = 5 } = {}, fetchImpl = fetch) {
  const url = `https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(fen)}&multiPv=${multiPv}`;
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  if (res.status === 404) return null;
  if (res.status === 429) throw new Error('Lichess pide esperar un minuto (429).');
  if (!res.ok) throw new Error(`La nube de Lichess respondió ${res.status}`);
  const data = await res.json();
  return {
    depth: data.depth,
    pvs: data.pvs.map((p) => ({ score: p.mate != null ? { mate: p.mate } : { cp: p.cp }, pv: p.moves.split(' ') })),
  };
}

// ------------------------------------------------- Evaluar las candidatas

/**
 * Evalúa la mejor jugada y una lista de jugadas (UCI) en `fen`.
 * Devuelve { best, rows: [{ uci, score, pv, available }] } con puntuaciones
 * desde el punto de vista del bando que mueve en `fen`.
 */
export async function evaluateMoves(source, fen, moves, { engine, depth = DEFAULT_DEPTH, fetchImpl = fetch, onProgress } = {}) {
  const hero = fen.split(' ')[1];
  const unique = [...new Set(moves)];
  const rows = [];

  if (source === 'stockfish') {
    const best = { ...(await engine.evaluate(fen, { depth, multipv: 3 })), via: 'stockfish' };
    onProgress?.({ best, rows });
    for (const uci of unique) {
      const r = await engine.evaluate(fen, { depth, move: uci });
      rows.push({ uci, score: r.score, pv: r.pv, available: true, via: 'stockfish' });
      onProgress?.({ best, rows });
    }
    return { best, rows };
  }

  // Nube: la raíz da las mejores jugadas; el resto se evalúa tras jugarlas.
  // Lo que la nube no tiene se completa con Stockfish si hay `engine`.
  const fromWhite = (s) => (hero === 'w' ? s : negate(s));
  const root = await fetchCloudEval(fen, { multiPv: 5 }, fetchImpl);
  const rootPvs = root ? root.pvs.map((p) => ({ ...p, score: fromWhite(p.score) })) : [];
  let best = rootPvs[0] ? { score: rootPvs[0].score, pv: rootPvs[0].pv, depth: root.depth, via: 'cloud', top: rootPvs.slice(0, 3) } : null;
  if (!best && engine) best = { ...(await engine.evaluate(fen, { depth, multipv: 3 })), via: 'stockfish' };
  onProgress?.({ best, rows });
  for (const uci of unique) {
    const known = rootPvs.find((p) => p.pv[0] === uci);
    if (known) {
      rows.push({ uci, score: known.score, pv: known.pv, available: true, via: 'cloud' });
    } else {
      const chess = new Chess(fen);
      let after;
      try {
        chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
        after = chess.fen();
      } catch {
        continue;
      }
      if (chess.isCheckmate()) {
        rows.push({ uci, score: { mate: 1 }, pv: [uci], available: true, via: 'cloud' });
      } else {
        const ev = await fetchCloudEval(after, { multiPv: 1 }, fetchImpl);
        if (ev) {
          rows.push({ uci, score: fromWhite(ev.pvs[0].score), pv: [uci, ...ev.pvs[0].pv], available: true, via: 'cloud' });
        } else if (engine) {
          const r = await engine.evaluate(fen, { depth, move: uci });
          rows.push({ uci, score: r.score, pv: r.pv, available: true, via: 'stockfish' });
        } else {
          rows.push({ uci, score: null, pv: [uci], available: false });
        }
      }
    }
    onProgress?.({ best, rows });
  }
  return { best, rows };
}

/** Evaluación de una posición suelta (para navegar por la partida). */
export async function evaluatePosition(source, fen, { engine, depth = DEFAULT_DEPTH, fetchImpl = fetch } = {}) {
  const chess = new Chess(fen);
  if (chess.isGameOver()) return null;
  const toMove = chess.turn();
  if (source === 'cloud') {
    const root = await fetchCloudEval(fen, { multiPv: 1 }, fetchImpl);
    if (root) return { score: toMove === 'w' ? root.pvs[0].score : negate(root.pvs[0].score), pv: root.pvs[0].pv, via: 'cloud', toMove };
  }
  if (!engine) return null;
  return { ...(await engine.evaluate(fen, { depth })), via: 'stockfish', toMove };
}

/** Probabilidad de ganar (0-1) para el bando de `score`, con la fórmula que usa Lichess. */
export function winChance(score) {
  if (!score) return 0.5;
  if (score.mate != null) return score.mate > 0 ? 1 : 0;
  const cp = Math.max(-1000, Math.min(1000, score.cp));
  return 1 / (1 + Math.exp(-0.00368208 * cp));
}

/** La evaluación en palabras, desde el punto de vista de quien resuelve. */
export function describeAdvantage(score) {
  if (!score) return '';
  if (score.mate != null) {
    if (score.mate === 0) return 'mate';
    return score.mate > 0 ? `das mate en ${score.mate}` : `recibes mate en ${-score.mate}`;
  }
  const a = Math.abs(score.cp);
  const who = score.cp > 0 ? 'para ti' : 'para el rival';
  if (a < 50) return 'posición igualada';
  if (a < 150) return `ligera ventaja ${who}`;
  if (a < 300) return `ventaja clara ${who}`;
  return `ventaja decisiva ${who}`;
}

/** La mejor jugada (UCI) para jugar contra el motor, con una búsqueda corta. */
export async function engineMove(engine, fen, { depth = 12 } = {}) {
  const r = await engine.evaluate(fen, { depth });
  return r.pv[0] ?? null;
}
