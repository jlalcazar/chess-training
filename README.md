# chess-training

Entrenador web (JavaScript) que enseña **cómo pensar la siguiente jugada** con
ejercicios reales de la [API de Lichess](https://lichess.org/api#tag/Puzzles).
Cada ejercicio se resuelve siguiendo, paso a paso, el método de pensamiento
del documento de referencia (privado, no está en el repositorio).

## Uso

**En línea (ordenador y móvil):** https://jlalcazar.github.io/chess-training/ (GitHub Pages; se
publica sola con cada push a `main` y a `feature/movil`). Tus datos se guardan en el navegador de
cada dispositivo: no salen de él.

### En el móvil

- La cabecera se pliega: «Nuevo ejercicio», «Repaso» y «☰ Menú» con el resto de opciones.
- El tablero ocupa el ancho de la pantalla; en horizontal se pone a la izquierda, a toda la altura,
  y el panel se desplaza a la derecha.
- Puedes mover tocando origen y destino o **arrastrando** la pieza. **Mantén pulsada** una casilla
  para dibujar un círculo (y arrastra para una flecha), como el botón derecho en el ordenador.
- Botones de al menos 44 px y diálogos a pantalla completa.

Requiere **Node.js 20.19 o superior** (recomendado 22). Comprueba tu versión con
`node --version`; si es antigua, con [nvm](https://github.com/nvm-sh/nvm):
`nvm install 22 && nvm use 22`.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # tests de la lógica (análisis, método, progreso, motor y módulos nuevos)
npm run build    # versión estática en dist/
```

Parámetros de URL útiles para depurar:

- `?puzzle=S14en` carga un puzzle concreto de Lichess.
- `?debug=1` muestra el estado interno en el panel y registra en consola (`[trainer]`).

## El proceso que guía la app

**Modo "con tiempo"** (proceso completo):

1. **Calma**: 30 s de respiración (inhalar 7 s, exhalar 5 s) mirando la posición sin calcular.
   - *(opcional)* **¿Qué ha cambiado con la jugada del rival?**: señalas en el tablero qué ataca
     ahora la pieza que se movió, qué dejó de defender y qué líneas abrió o cortó; la app lo corrige
     (verde, rojo, gris) y en el resumen lo enlaza con la jugada clave.
   - *(opcional)* **Golpe de vista**: 10 s para la primera jugada que salga, con tu seguridad
     (Segura, Probable, Corazonada). Entra como candidata 1 («intuición»).
2. **Candidatas**: hasta 5 jugadas marcadas en el tablero, sin calcular variantes.
3. **Preguntas tácticas** (siempre, para los dos colores): ¿mate?, ¿piezas desprotegidas?,
   ¿piezas amenazadas?, ¿piezas alineadas / a salto de caballo / doble de peón?
4. **Preguntas estratégicas** según el nivel (Casual, Intermedio, Avanzado, Experto):
   debilidades, peor pieza (C-A-T-D), qué quiere el rival, cambios de piezas, cambios de estructura.
   Si no hay damas, se usan las **preguntas de finales** (coronar, activar la torre, fijar
   debilidades, qué cambiar, mejores casillas).
   Las preguntas que no tienen respuesta de sí o no (peor pieza, plan del rival, cambios,
   estructura…) son **abiertas**: escribes tu idea y la contrastas con el análisis.
   Si una pregunta te sugiere una candidata nueva, muévela en el tablero: se apunta, no se juega.
   - *(opcional)* **Calcular**: eliges 2 candidatas e introduces cada línea a ciegas hasta una
     posición tranquila, con un contador en cada jugada del rival («tiene 2 jaques y 1 captura; has
     mirado 1 de 3»), y valoras el final (+−, ±, =, ∓, −+).
5. **Decisión**: cada candidata muestra cuántos "síes" consigue, qué deja colgado y si abre
   una **idea forzada de varias jugadas** (p. ej. "da jaque → ataque doble → ganas material"),
   sin desvelar las jugadas. Para apuntar aquí otra jugada, pulsa **"Añadir candidata"** y
   muévela en el tablero: se apunta en la tabla (y cuenta como candidata en las estadísticas) sin
   jugarse; si ya tienes 5, quita antes una. Sin ese botón, una jugada en el tablero se juega
   directamente.
   Al jugar desde Decisión (o desde Comprobación) aparece **¿Qué permite mi jugada?**: la posición
   tras tu jugada con el rival al turno; juegas la respuesta que más te preocupa o «No veo nada
   peligroso» y la app revela los jaques, capturas, amenazas, mates e ideas forzadas del rival. Los
   avisos de la tabla solo se ven después de este paso.
6. **Jugar** la línea contra las respuestas del puzzle. Al coronar, el tablero pregunta la pieza
   (dama, caballo, torre o alfil), como en Lichess: en una subpromoción hay que elegir la buena.
   Desde Intermedio, tras cada jugada correcta
   **predices la respuesta del rival** (no cuenta como error). Antes de cada jugada tuya, un
   **barrido rápido** con los recuentos de jaques, capturas y amenazas. Con **«Introduce la línea
   entera»** calculas a ciegas: el tablero no se mueve, respondes 2 o 3 preguntas sobre la posición
   final y la app marca la primera jugada que se aparta. Si fallas, la app dice **por qué**: orden
   equivocado, buena pieza en mala casilla, fallo de profilaxis, deja algo colgado u otra idea.
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

**Modo "¿Táctica o mejora?"**: en un puzzle siempre hay táctica y lo sabes. Este modo mezcla puzzles
con posiciones tranquilas de la misma partida (de 2 a 8 medias jugadas antes del error del rival),
comprobadas con Stockfish. Declaras «hay táctica» o «toca mejorar» y juegas; se miden las
combinaciones inventadas y las tácticas no vistas.

### Opciones y botones nuevos

Todo lo nuevo es opcional y se guarda en `settings` (botón **Opciones**):

- **Responder señalando**: en mate, desprotegidas, amenazadas, geometría y debilidades tocas las
  casillas (o juegas el mate) en lugar de decir Sí/No. «Has encontrado 3 de 4 en 9 s». Así decir
  siempre «sí» ya no cuenta como acierto.
- En **debilidades**, «Ver control» tiñe el tablero por bando con agujeros (○) y puestos avanzados (★).
  En **peor pieza** y **mejores casillas** tocas la pieza y dónde la quieres: ruta con flechas
  numeradas, tiempos y casillas peligrosas.
- **Ayuda que se retira**: cada pregunta pasa de Guiada a Rápida (tarjeta «Chequeo rápido» de 30 s) y
  a Chequeo automático al acertar el 85 % de las 10 últimas señalando y rápido; una de cada 5 vuelve
  como control sorpresa y baja un escalón si la clave respondía SÍ y no estaba entre tus candidatas.
- Pasos opcionales: «¿Qué ha cambiado?», golpe de vista, «Calcular» siempre, «¿Qué permite mi
  jugada?», predecir al rival (desde Intermedio, siempre o nunca), barrido en la línea, flechas de la
  línea a ciegas (ocultas por defecto en Avanzado y Experto).

Botones: **Ráfaga** (2 minutos de una sola pregunta, posiciones seguidas, ritmo de 8 → 6 → 4 s),
**Mis partidas** (tus imprecisiones, errores y errores graves de Lichess convertidos en ejercicios y
clasificados con las 5 preguntas de autoevaluación) y, en Temas, **Ciclo Woodpecker** (20 ejercicios
de un tema; el primer ciclo con el proceso completo y los siguientes sin tiempo y con la mitad del
tiempo; automatizado = bien en menos de 10 s en dos ciclos seguidos).

En el tablero: un indicador dice qué hace un clic en cada momento (Mover, Apuntar, Señalar, Rival,
A ciegas o Quieto); con el **botón derecho** dibujas flechas y círculos mientras piensas (un clic
normal los borra). **Atajos**: S/N responden, ? pide pista, Intro continúa, 1-5 eligen candidata, P la
juega. En el móvil (menos de 860 px), una barra fija abajo repite las acciones principales.

En el resumen: **Tu recorrido** (segundos por fase, dónde apareció la clave, aviso de fijación), la
tarjeta del **golpe de vista** y, con el motor, la **gráfica de evaluación** de la partida y la
**clasificación de cada jugada tuya** (brillante, excelente, buena, imprecisión, error, error grave,
por la probabilidad de ganar que pierde). Cuando un ejercicio vuelve en el **repaso**, un aviso
recuerda qué falló la vez anterior. **Estadísticas** añade «Tu intuición» (acierto por seguridad y
Brier), por qué fallan tus jugadas, de dónde sale la clave, la escalera de cada pregunta, ráfagas y
el modo «¿Táctica o mejora?».

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
| `src/board.js` | Tablero DOM: modos de clic (mover o señalar), marcas, tintes, flechas numeradas, posición «en la cabeza» para la línea a ciegas y dibujos del usuario. |
| `src/intuition.js` | Golpe de vista: los 4 casos, acierto por seguridad y puntuación de Brier. |
| `src/timeline.js` | Mapa del proceso: segundos por fase, dónde apareció la clave y fijación. |
| `src/errors.js` | Por qué falló una jugada (orden, casilla, profilaxis, colgada u otra). |
| `src/blindline.js` | Línea a ciegas, preguntas sobre la posición final y valoración de finales. |
| `src/scaffold.js` | Ayuda que se retira: etapas por pregunta, subidas, bajadas y control sorpresa. |
| `src/drills.js` | Ráfagas de fluidez y ciclos Woodpecker. |
| `src/mixed.js` | Modo «¿Táctica o mejora?»: posiciones tranquilas de la partida. |
| `src/selfgames.js` | Tus partidas de Lichess convertidas en ejercicios y clasificadas. |
| `src/evalgraph.js` | Gráfica de evaluación y clasificación de jugadas por probabilidad de ganar. |
| `src/dom.js` | `h()`, `storage` y utilidades compartidas. |
| `src/main.js` | Flujo de pasos e interfaz. |
| `vite.config.js`, `.github/workflows/pages.yml` | Publicación en GitHub Pages bajo `/chess-training/` (tests, build y despliegue). |

## Próximas iteraciones

- Dividir `main.js` (unas 3.700 líneas) en vistas por paso; la lógica ya está en módulos puros.
- Dibujos del usuario en pantallas táctiles (pulsación larga) y animación de las piezas.
- Responder señalando también en la tarjeta del chequeo rápido para las preguntas estratégicas
  cerradas que hoy solo admiten Sí/No (coronar, fijar).
- Ráfagas de preguntas estratégicas y ráfagas con posiciones de tus partidas de Lichess.
- Calibrar los umbrales (ayuda que se retira, posiciones tranquilas, clasificación de tus errores) con
  datos reales de uso.

## Resumen de la versión con todas las sugerencias

Implementadas las 23 mejoras (rama `claude/all-sugerencias`), con el principio común de que primero
el jugador hace el paso y después la app revela, corrige y mide. Decisiones tomadas:

- **SEE** con el algoritmo «swap» y rayos X (sin clavadas ni jaques: es un recuento estático). Una
  captura que pierde material pasa de «sí» a aviso.
- **Hallazgos con `targets`** y `match` (`all` para jugadas como el mate: hay que tocar origen y
  destino). Las parejas alineadas y los agujeros son informativos: tocarlos no es falsa alarma ni
  dejarlos es fallo. El rey en el centro solo es debilidad sin enroque, con damas y con columnas
  abiertas al lado.
- **Pasos nuevos** activados por defecto pero con «Saltar»: «¿Qué ha cambiado?», golpe de vista y
  «¿Qué permite mi jugada?». «Responder señalando» y el paso «Calcular» están apagados por defecto
  (Calcular tiene un botón en Decisión). El flujo de cada ejercicio se fija al empezarlo.
- Las **predicciones** fallidas tienen su propio contador; no cuentan como error ni como «no
  resuelto». En la **línea a ciegas**, las jugadas que coinciden con la solución se dan por jugadas y
  una jugada tuya distinta cuenta como jugada en el tablero (y como fallo).
- **Ayuda que se retira** guardada en `stats.scaffold`; solo cuentan para subir las respuestas
  señalando, y para bajar solo las preguntas que de verdad respondían SÍ en la posición.
- **Posición tranquila** (modo mezcla): mejor jugada no forzante, segunda a menos de 1,5 peones,
  evaluación entre −3 y +3 y sin ganancia forzada de la búsqueda táctica. Sin Stockfish, el
  ejercicio sale como puzzle normal.
- **Mis partidas**: el `variation` de Lichess es la solución (tu jugada, la respuesta y tu siguiente
  jugada como mucho). Al añadirlos, cuentan como fallados (lo fallaste en la partida) y entran en el
  repaso desde mañana.
- **Datos**: se mantienen las claves `settings`, `stats`, `progress` y `history` y todos los campos
  anteriores; los bloques nuevos son opcionales. Claves nuevas: `pool` (posiciones de los últimos
  ejercicios para las ráfagas) y `woodpecker` (el ciclo en curso).

## Créditos

Motor [Stockfish](https://stockfishchess.org/) (GPLv3) compilado a WASM por
[stockfish.js](https://github.com/nmrugg/stockfish.js) de Nathan Rugg.

Piezas *cburnett* de [Colin M.L. Burnett](https://en.wikipedia.org/wiki/User:Cburnett)
(GPLv2+ / CC BY-SA 3.0), las mismas que usa Lichess por defecto, copiadas de
[lichess-org/lila](https://github.com/lichess-org/lila/tree/master/public/piece/cburnett).
