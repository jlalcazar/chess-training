// Tablero DOM sencillo: piezas unicode, clic para mover, marcas y flechas.
import { Chess } from 'chess.js';

// Piezas cburnett, el juego por defecto de Lichess (public/pieces/cburnett).
const PIECE_BASE = `${import.meta.env?.BASE_URL ?? '/'}pieces/cburnett/`;
const FILES = 'abcdefgh';
const SVG_NS = 'http://www.w3.org/2000/svg';
// Orden de Lichess: dama, caballo, torre, alfil.
const PROMOTION_PIECES = [['q', 'dama'], ['n', 'caballo'], ['r', 'torre'], ['b', 'alfil']];

export class Board {
  /**
   * @param {HTMLElement} el
   * @param {{ onMove?: (move: {from: string, to: string, promotion?: string}) => void }} options
   */
  constructor(el, { onMove } = {}) {
    this.el = el;
    this.onMove = onMove;
    this.fen = new Chess().fen();
    this.orientation = 'w';
    this.interactive = false;
    this.selected = null;
    this.promotion = null; // { from, to, color } mientras se elige la pieza de la coronación
    this.lastMove = null;
    this.marks = {};
    this.arrows = [];
    this.el.classList.add('board');
    this.el.addEventListener('click', (ev) => this.#click(ev));
    this.el.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape' || !this.promotion) return;
      this.promotion = null;
      this.render();
    });
  }

  setPosition(fen, { orientation = this.orientation, lastMove = null } = {}) {
    // Redibujar la misma posición no quita la pieza seleccionada ni el selector de coronación.
    if (fen !== this.fen || orientation !== this.orientation) {
      this.selected = null;
      this.promotion = null;
    }
    this.fen = fen;
    this.orientation = orientation;
    this.lastMove = lastMove;
    this.render();
  }

  setInteractive(on) {
    this.interactive = on;
    if (!on) {
      this.selected = null;
      this.promotion = null;
    }
    this.el.classList.toggle('interactive', on);
    this.render();
  }

  /** marks: { e4: 'good' | 'bad' | 'info' | 'focus' } */
  setMarks(marks = {}) {
    this.marks = marks;
    this.render();
  }

  /** arrows: [{ from, to, tone }] */
  setArrows(arrows = []) {
    this.arrows = arrows;
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

  render() {
    const focused = this.promotion ? document.activeElement?.dataset?.promotion : null;
    const chess = new Chess(this.fen);
    const targets = new Set(this.selected ? chess.moves({ square: this.selected, verbose: true }).map((m) => m.to) : []);
    const frag = document.createDocumentFragment();
    for (const { sq, f, r } of this.#squares()) {
      const cell = document.createElement('div');
      cell.className = `sq ${(f + r) % 2 ? 'light' : 'dark'}`;
      cell.dataset.square = sq;
      if (this.lastMove && (sq === this.lastMove.from || sq === this.lastMove.to)) cell.classList.add('last');
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
      const showFile = (this.orientation === 'w' ? r === 0 : r === 7);
      const showRank = (this.orientation === 'w' ? f === 0 : f === 7);
      if (showFile) cell.append(Object.assign(document.createElement('span'), { className: 'coord file', textContent: sq[0] }));
      if (showRank) cell.append(Object.assign(document.createElement('span'), { className: 'coord rank', textContent: sq[1] }));
      frag.append(cell);
    }
    frag.append(this.#arrowLayer());
    if (this.promotion) frag.append(this.#promotionLayer());
    this.el.replaceChildren(frag);
    if (focused) this.el.querySelector(`[data-promotion="${focused}"]`).focus({ preventScroll: true });
  }

  /** Selector de coronación, como en Lichess: una columna de piezas desde la casilla hacia el centro. */
  #promotionLayer() {
    const { to, color } = this.promotion;
    const [x, y] = this.#center(to);
    const dir = y < 4 ? 1 : -1;
    const layer = document.createElement('div');
    layer.className = 'promotion';
    PROMOTION_PIECES.forEach(([type, name], i) => {
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.className = 'promotion-choice';
      choice.dataset.promotion = type;
      choice.title = `Coronar ${name}`;
      choice.setAttribute('aria-label', choice.title);
      choice.style.left = `${(x - 0.5) * 12.5}%`;
      choice.style.top = `${(y - 0.5 + i * dir) * 12.5}%`;
      choice.style.backgroundImage = `url(${PIECE_BASE}${color}${type.toUpperCase()}.svg)`;
      layer.append(choice);
    });
    return layer;
  }

  #arrowLayer() {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 8 8');
    svg.classList.add('arrows');
    const defs = document.createElementNS(SVG_NS, 'defs');
    for (const tone of ['good', 'bad', 'info', 'candidate']) {
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
    for (const { from, to, tone = 'candidate' } of this.arrows) {
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
    }
    return svg;
  }

  #click(ev) {
    if (!this.interactive) return;
    if (this.promotion) {
      // Elegir una pieza corona; un clic fuera del selector lo cierra sin mover.
      const choice = ev.target.closest('[data-promotion]')?.dataset.promotion;
      const { from, to } = this.promotion;
      this.promotion = null;
      this.render();
      if (choice) this.onMove?.({ from, to, promotion: choice });
      return;
    }
    const cell = ev.target.closest('.sq');
    if (!cell) return;
    const sq = cell.dataset.square;
    const chess = new Chess(this.fen);
    const piece = chess.get(sq);
    if (this.selected) {
      const legal = chess.moves({ square: this.selected, verbose: true }).find((m) => m.to === sq);
      const from = this.selected;
      if (legal) {
        this.selected = null;
        if (legal.promotion) {
          this.promotion = { from, to: sq, color: legal.color };
          this.render();
          this.el.querySelector('.promotion-choice').focus({ preventScroll: true });
          return;
        }
        this.render();
        this.onMove?.({ from, to: sq });
        return;
      }
    }
    this.selected = piece && piece.color === chess.turn() && sq !== this.selected ? sq : null;
    this.render();
  }
}
