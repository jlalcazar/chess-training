import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyMove, graphPaths } from '../src/evalgraph.js';

test('clasificación por pérdida de probabilidad de ganar', () => {
  assert.equal(classifyMove(0.6, 0.6).id, 'excelente');
  assert.equal(classifyMove(0.6, 0.62, { sacrifice: true }).id, 'brillante');
  assert.equal(classifyMove(0.3, 0.3, { sacrifice: true }).id, 'excelente', 'un sacrificio que deja la posición perdida no es brillante');
  assert.equal(classifyMove(0.6, 0.56).id, 'buena');
  assert.equal(classifyMove(0.6, 0.52).id, 'imprecision');
  assert.equal(classifyMove(0.6, 0.45).id, 'error');
  assert.equal(classifyMove(0.9, 0.2).id, 'grave');
  assert.equal(classifyMove(0.9, 0.2).loss, 70);
});

test('trazado de la gráfica', () => {
  const g = graphPaths([0.5, 1, null, 0], { width: 300, height: 100 });
  assert.equal(g.line, 'M0.0,50.0 L100.0,0.0 L200.0,0.0 L300.0,100.0');
  assert.match(g.area, /^M0,100 L0.0,50.0 .* L300.0,100 Z$/);
  assert.equal(graphPaths([]).line, '');
});
