# chess-training

Entrenador web (JavaScript) que enseña **cómo pensar la siguiente jugada** con
ejercicios reales de la [API de Lichess](https://lichess.org/api#tag/Puzzles).
Cada ejercicio se resuelve siguiendo, paso a paso, el método de pensamiento
del documento de referencia (privado, no está en el repositorio).

## Uso

Requiere **Node.js 20.19 o superior** (recomendado 22). Comprueba tu versión con
`node --version`; si es antigua, con [nvm](https://github.com/nvm-sh/nvm):
`nvm install 22 && nvm use 22`.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # tests del análisis y del cliente de Lichess
npm run build    # versión estática en dist/
```

Parámetros de URL útiles para depurar:

- `?puzzle=S14en` carga un puzzle concreto de Lichess.
- `?debug=1` muestra el estado interno en el panel y registra en consola (`[trainer]`).

## El proceso que guía la app

**Modo "con tiempo"** (proceso completo):

1. **Calma**: 30 s de respiración (inhalar 7 s, exhalar 5 s) mirando la posición sin calcular.
2. **Candidatas**: hasta 5 jugadas marcadas en el tablero, sin calcular variantes.
3. **Preguntas tácticas** (siempre, para los dos colores): ¿mate?, ¿piezas desprotegidas?,
   ¿piezas amenazadas?, ¿piezas alineadas / a salto de caballo / doble de peón?
4. **Preguntas estratégicas** según el nivel (Casual, Intermedio, Avanzado, Experto):
   debilidades, peor pieza (C-A-T-D), qué quiere el rival, cambios de piezas, cambios de estructura.
   Si no hay damas, se usan las **preguntas de finales** (coronar, activar la torre, fijar
   debilidades, qué cambiar, mejores casillas).
   Las preguntas que no tienen respuesta de sí o no (peor pieza, plan del rival, cambios,
   estructura…) son **abiertas**: escribes tu idea y la contrastas con el análisis.
5. **Decisión**: cada candidata muestra cuántos "síes" consigue, qué deja colgado y si abre
   una **idea forzada de varias jugadas** (p. ej. "da jaque → ataque doble → ganas material"),
   sin desvelar las jugadas.
6. **Jugar** la línea contra las respuestas del puzzle.
7. **Repaso**: solución explicada paso a paso, temas, si la clave estaba entre tus candidatas y en
   qué preguntas fallaste. Bajo el tablero puedes **navegar por toda la partida** (⏮ ◀ Ejercicio ▶ ⏭
   o las flechas del teclado), desde la posición inicial hasta el final de la solución.
   Aquí, y solo aquí, se puede **activar el motor** (botón "Activar motor") para evaluar
   la solución, tus candidatas, tu intuición y tus fallos, con una de dos fuentes:
   - **Stockfish 19 WASM** (por defecto): versión *lite* de un hilo, corre en tu navegador sin servidor ni cabeceras especiales.
   - **Nube de análisis de Lichess** (`/api/cloud-eval`): instantánea, pero solo tiene las posiciones que alguien ya analizó; lo que falta se completa con Stockfish.

   Con el motor activo:
   - la navegación muestra una **barra de ventaja** (con la evaluación en palabras: "ventaja clara
     para ti", "recibes mate en 2"…) y una flecha con la mejor jugada de la posición del tablero;
   - **"Por qué fallaron tus jugadas"**: para cada jugada errónea, Stockfish muestra la refutación
     del rival y lo que era mejor.

**Estadísticas por pregunta** (botón "Estadísticas"): al terminar cada ejercicio se guarda, en
tu navegador, cómo respondiste a cada pregunta: aciertos, "no lo viste" (había algo y dijiste que
no), falsas alarmas, "no lo sé" y, sobre todo, cuántas veces la pregunta llevaba a la jugada clave
y no la viste. Con eso señala la pregunta que más te cuesta (a partir de 3 respuestas) y el
porcentaje de ejercicios en que la clave estaba entre tus candidatas. Una pregunta solo cuenta
como "llevaba a la clave" si el análisis respondía SÍ en esa posición. Las preguntas abiertas no
se puntúan: solo cuentan cuántas veces las pensaste y escribiste tu idea. Solo registran los
ejercicios del modo "con tiempo" (el modo "sin tiempo" no hace preguntas).

**Ayudas para no pasar por alto la jugada y entender la solución:**

- **Barrido** antes de cerrar las candidatas: cuántos jaques, capturas y amenazas hay (sin decir
  cuáles) y si tus candidatas incluyen alguno de cada tipo; también los del rival.
- **Pistas graduadas** mientras juegas: qué pregunta responde SÍ → qué pieza mueve → casilla destino.
- **Puntos ciegos**: si la clave no estaba entre tus candidatas, por qué pudo costarte verla
  (sacrificio, jugada hacia atrás, tranquila, movimiento largo, caballo, pieza olvidada), con
  estadísticas acumuladas.
- **La línea ganadora jugada a jugada**, con los temas detectados en cada jugada (sacrificio,
  atracción, desviación, ataque doble, clavada…; reglas inspiradas en el etiquetador de
  [lichess-puzzler](https://github.com/ornicar/lichess-puzzler)) y un botón para reproducirla
  explicada en el tablero.
- **Temas de Lichess explicados**, señalando la jugada del ejercicio donde aparece cada uno.
- Con Stockfish: **las 3 mejores jugadas** (MultiPV) frente a tus candidatas, **defensas
  alternativas del rival** en cada jugada suya, y **rematar contra Stockfish** desde la posición
  final para demostrar que sabes convertir la ventaja.

**Temas y repaso espaciado:**

- **Temas**: cada ejercicio terminado se clasifica por sus temas de Lichess como *resuelto*
  (sin errores, sin pistas y sin ver la solución) o *no resuelto*, según el primer intento.
  Se agrupan en motivos tácticos, mates, fases de la partida, longitud, tipo de ventaja y
  origen; cada tema despliega sus ejercicios resueltos y no resueltos (con enlace a Lichess y
  botón para repetirlos). Arriba aparecen las **áreas a estudiar** (los temas con peor
  porcentaje, con al menos 3 ejercicios) y los **puntos fuertes**, con un botón para entrenar
  ese tema.
- **Repaso (N)**: los ejercicios no resueltos se guardan y vuelven a los 1, 3, 7, 14 y 30 días
  (sistema Leitner). Si lo aciertas cuando toca, pasa a la siguiente caja; si fallas, vuelve a
  empezar; al superar la última, queda aprendido. "Empezar repaso" encadena los pendientes del
  día. Los ejercicios guardados se repiten sin conexión.

Todo se guarda en tu navegador (`localStorage`). Los ejercicios hechos antes de esta versión no
guardaban sus temas.

**Modo "sin tiempo"**: intuición (cuenta atrás de 20 s), comprobación de que no te dejas nada, jugar.

## Estructura

| Archivo | Qué hace |
| --- | --- |
| `src/lichess.js` | Cliente de la API (`/api/puzzle/next`, `/api/puzzle/{id}`, `/api/puzzle/daily`) y reconstrucción de la posición desde el PGN. |
| `src/analysis.js` | Análisis heurístico sin motor: mates en 1, piezas colgadas/amenazadas, ataques dobles, clavadas/enfiladas, estructura de peones, movilidad, ideas del rival y una búsqueda táctica de jugadas forzadas (jaques y capturas) para las ideas de varias jugadas. |
| `src/method.js` | El método: niveles, preguntas y su respuesta calculada sobre la posición. |
| `src/engine.js` | Evaluación real: Stockfish WASM en un Web Worker (UCI, `searchmoves` por candidata) y la nube de Lichess. |
| `scripts/copy-stockfish.mjs` | Copia el motor de `node_modules/stockfish` a `public/stockfish/` (se ejecuta al instalar, en `dev` y en `build`). |
| `src/progress.js` | Progreso por tema (primer intento) y repaso espaciado Leitner de los ejercicios fallados. |
| `src/stats.js` | Estadísticas por pregunta: registro por ejercicio y resumen ordenado por dificultad. |
| `src/board.js` | Tablero DOM con marcas y flechas. |
| `src/main.js` | Flujo de pasos e interfaz. |

## Próximas iteraciones

Ideas sacadas de proyectos de código abierto (ver la conversación del 20/10/2026):

- Gráfica de evaluación de la línea y clasificación tipo "brillante/excelente" (Chesskit, freechess).
- Tablero chessground (el de Lichess) con flechas dibujables por el usuario y animaciones.

## Créditos

Motor [Stockfish](https://stockfishchess.org/) (GPLv3) compilado a WASM por
[stockfish.js](https://github.com/nmrugg/stockfish.js) de Nathan Rugg.

Piezas *cburnett* de [Colin M.L. Burnett](https://en.wikipedia.org/wiki/User:Cburnett)
(GPLv2+ / CC BY-SA 3.0), las mismas que usa Lichess por defecto, copiadas de
[lichess-org/lila](https://github.com/lichess-org/lila/tree/master/public/piece/cburnett).
