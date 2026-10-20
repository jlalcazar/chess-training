// Tablero DOM sencillo: piezas unicode, clic para mover, marcas y flechas.
import { Chess } from 'chess.js';

const GLYPHS = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const FILES = 'abcdefgh';
const SVG_NS = 'http://www.w3.org/2000/svg';

export class Board {
  /**
   * @param {HTMLElement} el
   * @param {{ onMove?: (move: {from: string, to: string}) => void }} options
   */
  constructor(el, { onMove } = {}) {
    this.el = el;
    this.onMove = onMove;
    this.fen = new Chess().fen();
    this.orientation = 'w';
    this.interactive = false;
    this.selected = null;
    this.lastMove = null;
    this.marks = {};
    this.arrows = [];
    this.el.classList.add('board');
    this.el.addEventListener('click', (ev) => this.#click(ev));
  }

  setPosition(fen, { orientation = this.orientation, lastMove = null } = {}) {
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
        const span = document.createElement('span');
        span.className = `piece ${piece.color === 'w' ? 'white' : 'black'}`;
        span.textContent = GLYPHS[piece.type] + '︎';
        cell.append(span);
      }
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
    const cell = ev.target.closest('.sq');
    if (!cell) return;
    const sq = cell.dataset.square;
    const chess = new Chess(this.fen);
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
