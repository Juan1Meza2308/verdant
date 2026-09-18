# Plan de implementación — Fase 2: blocks

Spec de referencia: `SPEC-blocks.md`. Orden de trabajo por dependencias; cada paso termina con su test verde y su microcommit.

## Orden de ejecución

1. **Integración fish (OSC 133)** — base del resto. Emite A/B/C; B lleva el comando crudo en base64.
   - Depende de: nada.
2. **Parser `segmentOsc133` (lib puro)** — divide el stream en segmentos sin tocar el texto.
   - Depende de: 1 (para definición exacta de los marcadores).
3. **Modelo `blocks` (lib puro)** — construye bloques desde marcadores + filas.
   - Depende de: 2.
4. **Integración en TerminalPane** — stream → segmentos → marcadores → modelo, escrituras serializadas por callbacks de `write`.
   - Depende de: 2, 3.
5. **Overlay visual (decorations)** — fondo/contorno por bloque, sólo viewport; alto medido del DOM renderizado.
   - Depende de: 4.
6. **Acciones de bloque (navegación, rerun, copy)** — keybinds nuevos en config + handlers en el bus de actions.
   - Depende de: 5.
7. **Snippets backend (`get_snippets`)** — carga json5 + defaults.
   - Depende de: nada (paralelo a 1-6).
8. **Snippets frontend** — caché, `resolveSnippet`, overlay por pane.
   - Depende de: 7, 4 (bus de actions y paste ya existentes).
9. **Criterio de salida** — verificación E2E por Felipe.

## Decisiones de diseño

- **Texto del comando**: lo aporta fish de forma nativa (≥ 4) en el payload `cmdline_url=` del marcador C (percent-encoded), no el buffer. Cero heurísticas; respeta aliases para el re-run. `packaging/fish/verdant.fish` queda como fallback para fish < 4.
- **Serialización de escrituras**: `terminal.write(segmento, cb)` en cadena; el cb corre al terminar de parsear → la fila leída justo después de cada marcador es exacta. Cola de marcadores pendientes para casos sin texto entre marcadores.
- **Overlay**: `registerDecoration` con layers bottom/top (xterm gestiona scroll); alto por bloque = filas × `cellHeight` medido del DOM (`.xterm-rows > div`).
- **Snippets**: archivo json5 config-like (SQLite en Fase 3); caché singleton para un solo invoke.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Marcadores OSC 133 rompen el render de xterm | Se eliminan del stream antes de `write`; xterm nunca los ve. Parser testeado contra falsos positivos. |
| Filas leídas desincronizadas al marcador | Callbacks serializados de `write`; jamás leer cursor en el mismo tick que la escritura. |
| Overlay pesado con muchos bloques | Sólo se pintan bloques dentro/adyacentes al viewport; navegación re-adjunta los lejanos. |
| payload B con caracteres raros | Base64. |
| Integración fish rompe el prompt del usuario | Archivo nuevo en conf.d (no toca config existente); wrapper sólo agrega marcadores. |
| Degradación si el backend no envía marcadores | El parser ignora lo que no reconoce; el shell funciona igual sin bloques. |

## Estados de commit esperados

- docs → especificación + plan (SPEC-blocks.md, tasks/plan.md, tasks/todo.md) — este commit.
- 1 por tarea (8 fichas de trabajo + criterio de salida), en el orden de la tabla.