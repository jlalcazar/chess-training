// Golpe de vista calibrado: la primera jugada que sale en 10 s y lo seguro
// que estás de ella. Mide si tu seguridad se corresponde con tus aciertos
// (calibración) con la puntuación de Brier. Funciones puras.

export const GLANCE_SECONDS = 10;

/** Niveles de seguridad y la probabilidad de acierto que expresan. */
export const CONFIDENCE = {
  segura: { label: 'Segura', p: 0.9 },
  probable: { label: 'Probable', p: 0.65 },
  corazonada: { label: 'Corazonada', p: 0.35 },
};

/** Los cuatro casos del resumen (más "otra": fallaste y jugaste otra jugada errónea). */
export const GLANCE_CASES = {
  acertoJugo: { label: 'Acertó y la jugaste', text: 'Tu intuición vio la jugada y la confirmaste con el método.', tone: 'good' },
  acertoCambio: { label: 'Acertó pero la cambiaste', text: 'Tu primera idea era buena y la abandonaste: revisa qué te hizo dudar.', tone: 'info' },
  falloCorregido: { label: 'Falló y el método te corrigió', text: 'El proceso hizo su trabajo: encontró algo mejor que tu primera idea.', tone: 'good' },
  falloJugo: { label: 'Falló y la jugaste', text: 'Te quedaste con la primera idea sin comprobarla: el método no llegó a corregirla.', tone: 'bad' },
};

/**
 * Clasifica un ejercicio con golpe de vista. `glance` y `played` son jugadas
 * UCI (`played` es tu primera jugada en el tablero); `key`, la jugada clave.
 * `mate`: la jugada del golpe de vista da mate (también es un acierto).
 */
export function glanceCase({ glance, played, key, glanceMates = false }) {
  if (!glance) return null;
  const right = glance === key || glanceMates;
  if (right) return played === glance ? 'acertoJugo' : 'acertoCambio';
  if (played === glance) return 'falloJugo';
  return played === key ? 'falloCorregido' : 'otra';
}

export const emptyIntuition = () => ({ n: 0, correct: 0, brierSum: 0, byConfidence: {}, cases: {} });

/** Suma un golpe de vista (sin modificar `block`). */
export function recordGlance(block, { confidence, correct, kase }) {
  const next = structuredClone(block ?? emptyIntuition());
  const c = CONFIDENCE[confidence];
  if (!c) return next;
  next.n++;
  if (correct) next.correct++;
  next.brierSum += (c.p - (correct ? 1 : 0)) ** 2;
  const b = (next.byConfidence[confidence] ??= { n: 0, correct: 0 });
  b.n++;
  if (correct) b.correct++;
  if (kase) next.cases[kase] = (next.cases[kase] ?? 0) + 1;
  return next;
}

/**
 * Resumen para Estadísticas: acierto por nivel de seguridad frente a lo que
 * prometía, Brier (0 = perfecto, 0,25 = como decir siempre 50 %) y un
 * diagnóstico de exceso o falta de confianza.
 */
export function intuitionSummary(block) {
  if (!block?.n) return null;
  const rows = Object.entries(CONFIDENCE).map(([id, c]) => {
    const b = block.byConfidence[id] ?? { n: 0, correct: 0 };
    return { id, label: c.label, expected: c.p, n: b.n, correct: b.correct, rate: b.n ? b.correct / b.n : null };
  });
  const brier = block.brierSum / block.n;
  const judged = rows.filter((r) => r.n >= 3);
  const gap = judged.length ? judged.reduce((sum, r) => sum + (r.expected - r.rate) * r.n, 0) / judged.reduce((sum, r) => sum + r.n, 0) : 0;
  const diagnosis = !judged.length
    ? null
    : gap > 0.15
      ? 'Exceso de confianza: aciertas menos de lo que crees. Comprueba más antes de jugar.'
      : gap < -0.15
        ? 'Falta de confianza: tu intuición es mejor de lo que crees.'
        : 'Bien calibrado: tu seguridad se corresponde con tus aciertos.';
  return { n: block.n, rate: block.correct / block.n, brier, rows, diagnosis, cases: block.cases };
}
