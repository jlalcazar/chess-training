import test from 'node:test';
import assert from 'node:assert/strict';
import { recordThread, threadReport, threadSummary } from '../src/thread.js';

test('threadReport: hilo completo', () => {
  const r = threadReport({ pointing: ['mate'], seen: ['mate'], noted: true, chosen: true });
  assert.equal(r.brokeAt, null);
  assert.equal(r.score, 100);
});

test('threadReport: no lo viste, lo viste y no lo apuntaste, lo apuntaste y no lo elegiste', () => {
  assert.equal(threadReport({ pointing: ['mate'], seen: [], noted: false }).brokeAt, 'ver');
  const seen = threadReport({ pointing: ['mate'], seen: ['mate'], noted: false });
  assert.equal(seen.brokeAt, 'apuntar');
  assert.equal(seen.score, 30);
  const noted = threadReport({ pointing: ['mate'], seen: ['mate'], noted: true, chosen: false });
  assert.equal(noted.brokeAt, 'elegir');
  assert.equal(noted.score, 70);
});

test('threadReport: sin pregunta que la señalara, «ver» no cuenta; la intuición salva el eslabón', () => {
  const r = threadReport({ pointing: [], noted: true, chosen: true });
  assert.equal(r.stages.ver, null);
  assert.equal(r.score, 100);
  assert.equal(threadReport({ pointing: [], noted: false }).brokeAt, 'apuntar');
  assert.equal(threadReport({ pointing: ['mate'], seen: [], noted: true, chosen: true }).brokeAt, null);
});

test('recordThread y threadSummary: nota media y eslabón que más se rompe', () => {
  let b = null;
  b = recordThread(b, threadReport({ pointing: ['mate'], seen: ['mate'], noted: true, chosen: true }));
  b = recordThread(b, threadReport({ pointing: ['mate'], seen: ['mate'], noted: false }));
  b = recordThread(b, threadReport({ pointing: ['mate'], seen: ['mate'], noted: false }));
  const s = threadSummary(b);
  assert.equal(s.n, 3);
  assert.equal(s.complete, 1);
  assert.equal(s.worst, 'apuntar');
  assert.equal(Math.round(s.avg), 53);
  assert.equal(threadSummary(null), null);
});
