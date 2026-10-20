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
5. **Decisión**: cada candidata muestra cuántos "síes" consigue y qué deja colgado.
6. **Jugar** la línea contra las respuestas del puzzle.
7. **Repaso**: solución, temas, si la clave estaba entre tus candidatas y en qué preguntas fallaste.
   Aquí, y solo aquí, se puede **activar el motor** (botón "Activar motor") para evaluar
   la solución, tus candidatas, tu intuición y tus fallos, con una de dos fuentes:
   - **Stockfish 19 WASM** (por defecto): versión *lite* de un hilo, corre en tu navegador sin servidor ni cabeceras especiales.
   - **Nube de análisis de Lichess** (`/api/cloud-eval`): instantánea, pero solo tiene las posiciones que alguien ya analizó.

**Modo "sin tiempo"**: intuición (cuenta atrás de 20 s), comprobación de que no te dejas nada, jugar.

## Estructura

| Archivo | Qué hace |
| --- | --- |
| `src/lichess.js` | Cliente de la API (`/api/puzzle/next`, `/api/puzzle/{id}`, `/api/puzzle/daily`) y reconstrucción de la posición desde el PGN. |
| `src/analysis.js` | Análisis heurístico sin motor: mates en 1, piezas colgadas/amenazadas, ataques dobles, clavadas/enfiladas, estructura de peones, movilidad, ideas del rival. |
| `src/method.js` | El método: niveles, preguntas y su respuesta calculada sobre la posición. |
| `src/engine.js` | Evaluación real: Stockfish WASM en un Web Worker (UCI, `searchmoves` por candidata) y la nube de Lichess. |
| `scripts/copy-stockfish.mjs` | Copia el motor de `node_modules/stockfish` a `public/stockfish/` (se ejecuta al instalar, en `dev` y en `build`). |
| `src/board.js` | Tablero DOM con marcas y flechas. |
| `src/main.js` | Flujo de pasos e interfaz. |

## Próximas iteraciones

- Detectar ideas de más de una jugada (p. ej. jaque y luego ataque doble).
- Estadísticas por pregunta para saber qué te cuesta más.

## Créditos

Motor [Stockfish](https://stockfishchess.org/) (GPLv3) compilado a WASM por
[stockfish.js](https://github.com/nmrugg/stockfish.js) de Nathan Rugg.

Piezas *cburnett* de [Colin M.L. Burnett](https://en.wikipedia.org/wiki/User:Cburnett)
(GPLv2+ / CC BY-SA 3.0), las mismas que usa Lichess por defecto, copiadas de
[lichess-org/lila](https://github.com/lichess-org/lila/tree/master/public/piece/cburnett).
