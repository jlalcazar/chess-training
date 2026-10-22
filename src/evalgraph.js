// Gráfica de evaluación (estilo Chesskit) y clasificación de cada jugada por
// la probabilidad de ganar que pierde (estilo freechess). Funciones puras: la
// probabilidad de ganar viene de engine.winChance (0-1, desde tu lado).

export const MOVE_CLASSES = {
  brillante: { label: 'Brillante', symbol: '!!', tone: 'good' },
  excelente: { label: 'Excelente', symbol: '!', tone: 'good' },
  buena: { label: 'Buena', symbol: '', tone: 'good' },
  imprecision: { label: 'Imprecisión', symbol: '?!', tone: 'info' },
  error: { label: 'Error', symbol: '?', tone: 'bad' },
  grave: { label: 'Error grave', symbol: '??', tone: 'bad' },
};

/**
 * Clasifica una jugada por lo que pierde en probabilidad de ganar (en
 * puntos porcentuales): ≤2 excelente, ≤5 buena, ≤10 imprecisión, ≤20 error y
 * más, error grave. Brillante: un sacrificio que no pierde nada y deja la
 * posición ganada o mejor.
 */
export function classifyMove(winBefore, winAfter, { sacrifice = false } = {}) {
  const loss = Math.max(0, (winBefore - winAfter) * 100);
  let id;
  if (loss <= 2) id = sacrifice && winAfter >= 0.5 ? 'brillante' : 'excelente';
  else if (loss <= 5) id = 'buena';
  else if (loss <= 10) id = 'imprecision';
  else if (loss <= 20) id = 'error';
  else id = 'grave';
  return { id, loss: Math.round(loss * 10) / 10, ...MOVE_CLASSES[id] };
}

/**
 * Trazado SVG de la probabilidad de ganar a lo largo de las posiciones
 * (`values`: 0-1 o null si aún no hay evaluación). Devuelve la línea y el
 * área (rellena desde abajo) en un lienzo de `width` × `height`.
 */
export function graphPaths(values, { width = 600, height = 120 } = {}) {
  const n = values.length;
  if (!n) return { line: '', area: '', x: () => 0 };
  const x = (i) => (n === 1 ? width / 2 : (i / (n - 1)) * width);
  const y = (v) => height - v * height;
  // Los huecos (sin evaluación) se rellenan con el último valor conocido para no romper la curva.
  let last = 0.5;
  const filled = values.map((v) => (v == null ? last : (last = v)));
  const pts = filled.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const line = `M${pts.join(' L')}`;
  const area = `M0,${height} L${pts.join(' L')} L${x(n - 1).toFixed(1)},${height} Z`;
  return { line, area, x };
}
