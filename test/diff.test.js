import { test } from 'node:test';
import assert from 'node:assert/strict';
import { between, lastMoveDiff } from '../src/analysis.js';

test('between: casillas entre dos casillas alineadas', () => {
  assert.deepEqual(between('a1', 'd4'), ['b2', 'c3']);
  assert.deepEqual(between('e1', 'e4'), ['e2', 'e3']);
  assert.deepEqual(between('a1', 'b3'), []);
});

test('lastMoveDiff: la dama que se va deja sin defensa y ataca algo nuevo (S14en)', () => {
  // El rival jugó Qd3-d2: la dama deja de defender... y queda alineada con el rey g2.
  const before = '5r1k/ppp2q2/7p/4P1p1/1P1P4/2PQ2RP/P5K1/8 w - - 2 36';
  const after = '5r1k/ppp2q2/7p/4P1p1/1P1P4/2P3RP/P2Q2K1/8 b - - 3 36';
  const d = lastMoveDiff(before, after, { from: 'd3', to: 'd2' });
  assert.equal(d.piece.type, 'q');
  assert.ok(d.undefended.some((p) => p.square === 'g3'), JSON.stringify(d.undefended));
});

test('lastMoveDiff: ataque a la descubierta y línea cortada', () => {
  // Blancas: alfil b2 detrás del caballo d4; al irse el caballo, el alfil ataca la torre h8.
  const before = 'k6r/8/8/8/3N4/8/1B6/4K3 w - - 0 1';
  const after = 'k6r/8/1N6/8/8/8/1B6/4K3 b - - 1 1';
  const d = lastMoveDiff(before, after, { from: 'd4', to: 'b6' });
  assert.ok(d.opened.some((o) => o.by.square === 'b2' && o.target.square === 'h8'), JSON.stringify(d.opened));
  // El caballo da jaque al rey de a8.
  assert.ok(d.attacks.some((p) => p.square === 'a8'));
  assert.equal(d.check, true);
  // Línea cortada: el caballo se interpone entre la dama a1 y el rey e1.
  const b2 = '4k3/8/8/8/8/2n5/8/q3K3 b - - 0 1';
  const a2 = '4k3/8/8/8/8/8/8/qn2K3 w - - 1 1';
  const d2 = lastMoveDiff(b2, a2, { from: 'c3', to: 'b1' });
  assert.ok(d2.blocked.some((x) => x.by.square === 'a1' && x.target.square === 'e1'), JSON.stringify(d2.blocked));
});

test('changeFindings y changeLink: S14en', async () => {
  const { changeFindings, changeLink } = await import('../src/method.js');
  const before = '5r1k/ppp2q2/7p/4P1p1/1P1P4/2PQ2RP/P5K1/8 w - - 2 36';
  const after = '5r1k/ppp2q2/7p/4P1p1/1P1P4/2P3RP/P2Q2K1/8 b - - 3 36';
  const d = lastMoveDiff(before, after, { from: 'd3', to: 'd2' });
  const f = changeFindings(d, 'b');
  assert.ok(f.every((x) => Array.isArray(x.targets)));
  assert.ok(f.some((x) => x.targets.includes('g3')));
  // La clave Qf1+ no captura en g3: no hay enlace forzado, pero no rompe.
  const link = changeLink(d, after, 'f7f1');
  assert.ok(link === null || typeof link === 'string');
});
