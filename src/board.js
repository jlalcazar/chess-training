// Tablero DOM sencillo: clic para mover o para señalar casillas, marcas,
// tintes, flechas (numeradas) y dibujos del usuario con el botón derecho.
import { Chess } from 'chess.js';

// Piezas cburnett, el juego por defecto de Lichess (public/pieces/cburnett).
const PIECE_BASE = `${import.meta.env?.BASE_URL ?? '/'}pieces/cburnett/`;
const FILES = 'abcdefgh';
const SVG_NS = 'http://www.w3.org/2000/svg';
export const ARROW_TONES = ['good', 'bad', 'info', 'candidate', 'mine', 'theirs', 'user', 'muted'];

export class Board {
  /**
   * @param {HTMLElement} el
   * @param {{ onMove?: (move: {from: string, to: string}) => void, onPick?: (sq: string) => void }} options
   */
  constructor(el, { onMove, onPick } = {}) {
    this.el = el;
    this.onMove = onMove;
    this.onPick = onPick;
    this.fen = new Chess().fen();
    this.moveFen = null; // posición "en la cabeza" para generar jugadas (línea a ciegas)
    this.showTargets = true;
    this.orientation = 'w';
    this.interactive = false;
    this.pickMode = false;
    this.selected = null;
    this.lastMove = null;
    this.marks = {};
    this.tints = {};
    this.labels = {};
    this.arrows = [];
    this.shapes = []; // dibujos del usuario: { from, to } (flecha) o { from } (círculo)
    this.drawStart = null;
    this.el.classList.add('board');
    this.el.addEventListener('click', (ev) => this.#click(ev));
    this.el.addEventListener('contextmenu', (ev) => ev.preventDefault());
    this.el.addEventListener('mousedown', (ev) => this.#drawDown(ev));
    this.el.addEventListener('mouseup', (ev) => this.#drawUp(ev));
  }

  setPosition(fen, { orientation = this.orientation, lastMove = null } = {}) {
    // Los dibujos del usuario son de una posición: al cambiarla se borran.
    if (fen !== this.fen) this.shapes = [];
    this.fen = fen;
    this.orientation = orientation;
    this.lastMove = lastMove;
    this.selected = null;
    this.render();
  }

  setInteractive(on) {
    this.interactive = on;
    this.selected = null;
    this.el.classList.toggle('interactive', on);
    this.render();
  }

  /** Modo de señalar: un clic en una casilla llama a onPick en lugar de mover. */
  setPickMode(on) {
    this.pickMode = on;
    this.selected = null;
    this.el.classList.toggle('picking', on);
    this.render();
  }

  /** Genera las jugadas desde otra posición (la que el jugador tiene en la cabeza). */
  setMoveFen(fen, { showTargets = true } = {}) {
    this.moveFen = fen;
    this.showTargets = showTargets;
    this.selected = null;
    this.render();
  }

  /** marks: { e4: 'good' | 'bad' | 'info' | 'focus' | 'pick' | 'found' | 'missed' | 'false' } */
  setMarks(marks = {}) {
    this.marks = marks;
    this.render();
  }

  /** tints: { e4: 'w' | 'b' | 'contested' | 'hole' | 'outpost' } (mapa de control) */
  setTints(tints = {}) {
    this.tints = tints;
    this.render();
  }

  /** labels: { e4: '1' } (número de la ruta, por ejemplo) */
  setLabels(labels = {}) {
    this.labels = labels;
    this.render();
  }

  /** arrows: [{ from, to, tone, label }] */
  setArrows(arrows = []) {
    this.arrows = arrows;
    this.render();
  }

  clearShapes() {
    if (!this.shapes.length) return;
    this.shapes = [];
    this.render();
  }

  #squares() {
    const ranks = this.orientation === 'w' ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
    const files = this.orientation === 'w' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
    const out = [];
    for (const r of ranks) for (const f of files) out.push({ sq: FILES[f] + (r + 1), f, r });
    return out;
  }

  #center(sq) {
    const f = FILES.indexOf(sq[0]);
    const r = Number(sq[1]) - 1;
    const x = this.orientation === 'w' ? f : 7 - f;
    const y = this.orientation === 'w' ? 7 - r : r;
    return [x + 0.5, y + 0.5];
  }

  #game() {
    try {
      return new Chess(this.moveFen ?? this.fen);
    } catch {
      return new Chess(this.fen);
    }
  }

  render() {
    const chess = new Chess(this.fen);
    const game = this.moveFen ? this.#game() : chess;
    const targets = new Set(this.selected && this.showTargets ? game.moves({ square: this.selected, verbose: true }).map((m) => m.to) : []);
    const frag = document.createDocumentFragment();
    for (const { sq, f, r } of this.#squares()) {
      const cell = document.createElement('div');
      cell.className = `sq ${(f + r) % 2 ? 'light' : 'dark'}`;
      cell.dataset.square = sq;
      if (this.lastMove && (sq === this.lastMove.from || sq === this.lastMove.to)) cell.classList.add('last');
      if (this.tints[sq]) cell.classList.add(`tint-${this.tints[sq]}`);
      if (this.marks[sq]) cell.classList.add(`mark-${this.marks[sq]}`);
      if (sq === this.selected) cell.classList.add('selected');
      if (targets.has(sq)) cell.classList.add('target');
      const piece = chess.get(sq);
      if (piece) {
        const img = document.createElement('div');
        img.className = 'piece';
        img.style.backgroundImage = `url(${PIECE_BASE}${piece.color}${piece.type.toUpperCase()}.svg)`;
        cell.append(img);
      }
      if (this.labels[sq]) cell.append(Object.assign(document.createElement('span'), { className: 'sq-label', textContent: this.labels[sq] }));
      const showFile = (this.orientation === 'w' ? r === 0 : r === 7);
      const showRank = (this.orientation === 'w' ? f === 0 : f === 7);
      if (showFile) cell.append(Object.assign(document.createElement('span'), { className: 'coord file', textContent: sq[0] }));
      if (showRank) cell.append(Object.assign(document.createElement('span'), { className: 'coord rank', textContent: sq[1] }));
      frag.append(cell);
    }
    frag.append(this.#arrowLayer());
    this.el.replaceChildren(frag);
  }

  #arrowLayer() {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 8 8');
    svg.classList.add('arrows');
    const defs = document.createElementNS(SVG_NS, 'defs');
    for (const tone of ARROW_TONES) {
      const marker = document.createElementNS(SVG_NS, 'marker');
      marker.setAttribute('id', `head-${tone}`);
      marker.setAttribute('markerWidth', '4');
      marker.setAttribute('markerHeight', '4');
      marker.setAttribute('refX', '2');
      marker.setAttribute('refY', '2');
      marker.setAttribute('orient', 'auto');
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', 'M0,0 L4,2 L0,4 z');
      path.classList.add(`arrow-${tone}`);
      marker.append(path);
      defs.append(marker);
    }
    svg.append(defs);
    const userArrows = this.shapes.filter((s) => s.to).map((s) => ({ ...s, tone: 'user' }));
    for (const { from, to, tone = 'candidate', label } of [...this.arrows, ...userArrows]) {
      if (!from || !to || from === to) continue;
      const [x1, y1] = this.#center(from);
      const [x2, y2] = this.#center(to);
      const len = Math.hypot(x2 - x1, y2 - y1);
      const shorten = 0.35 / len;
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', x1);
      line.setAttribute('y1', y1);
      line.setAttribute('x2', x2 - (x2 - x1) * shorten);
      line.setAttribute('y2', y2 - (y2 - y1) * shorten);
      line.setAttribute('marker-end', `url(#head-${tone})`);
      line.classList.add(`arrow-${tone}`);
      svg.append(line);
      if (label != null) {
        // El número va en el centro de la flecha.
        const g = document.createElementNS(SVG_NS, 'g');
        g.classList.add('arrow-label', `arrow-label-${tone}`);
        const cx = (x1 + x2) / 2;
        const cy = (y1 + y2) / 2;
        const circle = document.createElementNS(SVG_NS, 'circle');
        circle.setAttribute('cx', cx);
        circle.setAttribute('cy', cy);
        circle.setAttribute('r', '0.22');
        const text = document.createElementNS(SVG_NS, 'text');
        text.setAttribute('x', cx);
        text.setAttribute('y', cy + 0.01);
        text.textContent = String(label);
        g.append(circle, text);
        svg.append(g);
      }
    }
    for (const s of this.shapes.filter((x) => !x.to)) {
      const [cx, cy] = this.#center(s.from);
      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', cx);
      circle.setAttribute('cy', cy);
      circle.setAttribute('r', '0.45');
      circle.classList.add('user-circle');
      svg.append(circle);
    }
    return svg;
  }

  #squareAt(ev) {
    return ev.target.closest?.('.sq')?.dataset.square ?? null;
  }

  // Dibujos del usuario (como chessground): botón derecho y arrastrar = flecha;
  // botón derecho sin arrastrar = círculo; repetirlo lo quita.
  #drawDown(ev) {
    if (ev.button !== 2) return;
    this.drawStart = this.#squareAt(ev);
  }

  #drawUp(ev) {
    if (ev.button !== 2 || !this.drawStart) return;
    const from = this.drawStart;
    const to = this.#squareAt(ev);
    this.drawStart = null;
    if (!to) return;
    const same = (s) => s.from === from && (s.to ?? null) === (to === from ? null : to);
    const i = this.shapes.findIndex(same);
    if (i >= 0) this.shapes.splice(i, 1);
    else this.shapes.push(to === from ? { from } : { from, to });
    this.render();
  }

  #click(ev) {
    // Un clic normal borra los dibujos, como en Lichess.
    if (this.shapes.length) {
      this.shapes = [];
      if (!this.interactive && !this.pickMode) this.render();
    }
    const cell = ev.target.closest('.sq');
    if (!cell) return;
    const sq = cell.dataset.square;
    if (this.pickMode) {
      this.render();
      this.onPick?.(sq);
      return;
    }
    if (!this.interactive) return;
    const chess = this.#game();
    const piece = chess.get(sq);
    if (this.selected) {
      const legal = chess.moves({ square: this.selected, verbose: true }).some((m) => m.to === sq);
      const from = this.selected;
      if (legal) {
        this.selected = null;
        this.render();
        this.onMove?.({ from, to: sq });
        return;
      }
    }
    this.selected = piece && piece.color === chess.turn() && sq !== this.selected ? sq : null;
    this.render();
  }
}
