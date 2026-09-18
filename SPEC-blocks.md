# Spec: blocks (Módulo blocks del Capability Map)

Bloques tipo Warp + snippets con variables. Módulo `blocks` del SPEC.md, depende de `desktop-shell` (tabs/splits/keybinds ya en producción).

## Objective

Que cada comando ejecutado con su salida sea un **bloque** navegable y reutilizable dentro del pane:

- Delimitar visualmente cada bloque (comando + salida) con un overlay sutil sobre xterm.
- Navegar bloques con teclado (anterior/siguiente), saltando a su inicio.
- **Re-ejecutar** el comando del bloque seleccionado (conserva aliases/expansión de fish).
- **Copiar** el comando del bloque seleccionado (y la salida, si aplica) al portapapeles.
- **Snippets** guardados con variables `{{var}}` (y valores por defecto `{{var:default}}`) insertables en el prompt activo.

Fuera de scope Fase 2: persistencia en disco, búsqueda global, attach híbrido (Fase 3/sessions), re-render DOM estilo Warp.

## Decisiones aprobadas (Felipe, 2026-09-17)

1. **Detección**: OSC 133 + archivo de integración `~/.config/fish/conf.d/verdant.fish` (nuevo; no toca config existente).
2. **Render**: overlay CSS sobre xterm (xterm sigue siendo el renderer; cero riesgo para TUI apps).
3. **Alcance**: bloques + snippets juntos en esta fase.

## Arquitectura

### 1. Integración shell (fish)

fish ≥ 4 emite los marcadores OSC 133 **de forma nativa** (verificado en fish 4.9.3, también con `TERM=xterm-256color`). No se instala ningún archivo en la config del usuario.

| Marcador | Cuándo | Payload |
|---|---|---|
| `\e]133;A` (a veces con `;click_events=1`) | `fish_prompt` (inicio de prompt) | — (se ignora) |
| `\e]133;B` | `fish_preexec` (antes de ejecutar) | — |
| `\e]133;C;cmdline_url=<url-encoded>` | `fish_postexec` (tras completar) | comando crudo URL-encoded (espacio `%20`, UTF-8 `%C3%A1`…) |

El comando se recupera de `C;cmdline_url=` con `decodeURIComponent`: línea cruda tal como se tecleó → aliases y pipeline intactos para el re-run. **Fallback para fish < 4** (opcional, NO instalado por defecto): `packaging/fish/verdant.fish` emite `B;cmd=<base64>`.

### 2. Parser del stream (frontend)

Nuevo `src/lib/osc133.ts`: `segmentOsc133(chunk)` → `Array<{ text: string; marker?: "A" | "B" | "C"; payload?: string }>`.
Solo reconoce `ESC ] 133 ; X ; payload (BEL | ESC \\)`. El resto del stream se escribe intacto en xterm (los marcadores **se eliminan antes de `write`**, xterm nunca los ve; el prompt/echo del shell renderiza igual).

TerminalPane procesa el chunk en segmentos **serializados** usando callbacks de `terminal.write(text, cb)` (el cb corre cuando xterm termina de parsear esa escritura): así la lectura de `cursorY`/`baseY` justo después del marcador es exacta, y el orden del stream se preserva. Cola de marcadores pendientes para chunks con marcadores consecutivos o sin texto.

### 3. Modelo de bloques

Nuevo `src/lib/blocks.ts` (puro, testeable): estado por pane.

```ts
interface Block {
  id: number;
  startRow: number;        // fila absoluta (baseY + cursorY) donde empieza el prompt
  endRow: number;          // fila donde termina la salida
  command: string;         // del payload B (línea cruda)
}
```

- `A` → cierra el bloque anterior (endRow = fila actual − 1 si no llegó `C`), abre uno nuevo con `startRow = fila actual`, `command = ""`.
- `B` → sin payload (marca el inicio de la ejecución).
- `C` → `command = decodeCommandPayload(payload)` (`cmdline_url=` → percent-decode; `cmd=` → base64 del fallback) y `endRow = fila actual`.
- Bloques huérfanos (marcador dañado) se ignoran silenciosamente; el terminal nunca se degrada.

### 4. Overlay visual

xterm **decorations** (`registerDecoration`) con `layer: "bottom"` para el fondo del bloque y `layer: "top"` para el contorno del bloque activo/seleccionado (el posicionamiento y scroll los maneja xterm solo).

- Alto del bloque = `(endRow - startRow + 1) × cellHeight`. `cellHeight` se mide del primer `<div>` renderizado en `.xterm-rows` (`offsetHeight`) — API pública, sin internals; se re-mide en resize/cambio de fuente (el ResizeObserver del pane ya existe).
- Solo se pintan bloques cuya fila está dentro/adyacente al viewport (los lejanos se re-adjuntan al saltar a ellos) — no pintar miles de filas.
- Bloque activo: el que contiene el cursor al navegar/acercarse; la navegación hace `scrollToLine(startRow)`.
- `pointer-events: none` en todo el overlay: la interacción del ratón con xterm (selección) no cambia.

### 5. Acciones y keybinds (configurables, defaults)

| Acción | Default | Comportamiento |
|---|---|---|
| `block-prev` | `Ctrl+Shift+Up` | seleccionar bloque anterior, scrollear a su inicio |
| `block-next` | `Ctrl+Shift+Down` | bloque siguiente |
| `block-rerun` | `Ctrl+Shift+R` | re-enviar `command` del bloque seleccionado (vía `term.paste`; bracketed paste automático) |
| `block-copy` | `Ctrl+Shift+Y` | copiar `command` (writeText del plugin clipboard) |
| `snippets` | `Ctrl+Shift+S` | abrir overlay de snippets en el pane activo |

Las acciones de bloque van por el **bus de actions** existente (`dispatchAction`) y TerminalPane las maneja SOLO si el pane está activo (patrón fresh-handlers por ref ya en producción para copy/paste).

### 6. Snippets

- Almacenamiento: `~/.config/verdant/snippets.jsonc` (`json5`, ya es dependencia):
  ```jsonc
  {
    "snippets": [
      { "title": "git commit", "body": "git commit -m \"{{message}}\"" },
      { "title": "db reset+seed", "body": "supabase db reset && supabase seed run" }
    ]
  }
  ```
- Backend: comando Tauri `get_snippets` (nuevo `src-tauri/src/snippets.rs`, carga + json5 + crea default si falta). Fase 3 migra a SQLite.
- Frontend: `src/lib/snippets.ts` — caché singleton (un solo invoke), `resolveSnippet(body, values)` que sustituye `{{var}}` / `{{var:default}}`.
- Overlay por pane (estilo search overlay): lista de títulos; Enter/Snippets abre; con variables muestra un campo por variable; Enter inserta el cuerpo resuelto vía `term.paste`. Escape cierra. Navegación con flechas.

## Commands

```bash
npm run tauri dev    # dev completo
npm test             # vitest (osc133 parser, blocks model, snippets resolve)
cargo test           # tests Rust (snippets load/parse)
npm run lint         # tsc --noEmit (lo que hay hoy)
```

## Project Structure

```
src/lib/osc133.ts        → segmentOsc133 (parser OSC 133)      + osc133.test.ts
src/lib/blocks.ts        → modelo Bloques (builder por marcador) + blocks.test.ts
src/lib/snippets.ts      → getSnippets (singleton), resolveSnippet + snippets.test.ts
src/components/TerminalPane.tsx → integración stream→segmentos, overlay, actions, overlay snippets
src/components/SnippetOverlay.tsx → overlay de snippets (forme parte de TerminalPane)
src-tauri/src/snippets.rs → get_snippets (carga json5 + defaults)  + tests
src-tauri/src/config.rs  → DEFAULT_KEYBINDS + template (5 nuevas acciones)
packaging/fish/verdant.fish → fallback opcional (fish < 4); NO se instala por defecto
```

## Code Style

TS estricto, sin `any`/`ts-ignore`. Constantes semánticas (`BLOCK_MARKER_RE`…). Parser y modelo puros (sin DOM) — DOM solo en TerminalPane/overlay. Comentarios en inglés, commits en español (Juan1Meza2308).

## Testing Strategy

- **vitest (lógica pura)** — Cobertura obligatoria en: `segmentOsc133` (marcadores, payloads base64, texto mezclado, BEL vs ST, secuencias falsas tipo `echo "\e]133;A\a"` no se parten mal), `blocks` (construcción A→B→C, huérfanos, wrap de filas, re-run no se trunca), `resolveSnippet` (`{{var}}`, `{{var:default}}`, ausencia de vars, escaping).
- **Rust**: `snippets.rs` — carga de archivo, defaults, json5 inválido → error controlado.
- **E2E manual (wtype)**: correr 3 comandos en fish → 3 bloques; `block-next/prev` saltan; `block-rerun` re-ejecuta (verificable por un `echo … >> archivo`); `block-copy` → `wl-paste` muestra el comando; snippets con variable inserta texto que llega al shell (cat > archivo).

## Boundaries

- **Always**: tests antes de commit; bloques jamás alteran lo que xterm recibe (solo los eliminan); microcommits.
- **Ask first**: tocar el archivo de integración fish de otro shell, cambiar defaults de keybinds, mover snippets a SQLite.
- **Never**: `any`/`ts-ignore`, select * , re-render de la pantalla por React, bloques que bloqueen el stream del PTY.

## Success Criteria (salida Fase 2)

1. Marcadores nativos de fish ≥ 4 activos; tras ejecutar comandos se ven bloques delimitados y se navega con `Ctrl+Shift+↑/↓` saltando al inicio de cada bloque.
2. `Ctrl+Shift+R` re-ejecuta el comando del bloque seleccionado sin importar qué haya en el prompt actual.
3. `Ctrl+Shift+Y` copia el comando del bloque → verificado con `wl-paste`.
4. `Ctrl+Shift+S` abre snippets; el snippet con `{{var}}` pide valor y lo inserta resuelto en el shell (verificado: texto llega a un `cat > archivo`).
5. `vim` y `btop` siguen fluidos con los marcadores activos (el cuerpo del bloque no afecta el render).
6. `npm test` y `cargo test` verdes; sin regresiones en tabs/splits/keybinds (suit existente pasa).

## Open Questions

- ¿El bloque activo debe tener también atajo para copiar la **salida** (no solo el comando)? Default: no por ahora (se puede con selección manual + Ctrl+Shift+C).
- ¿`block-prev/next` deben escribir `Ctrl+Shift+↑/↓` o prefieres `Alt+J/K` (vim-ish)? Configurable; si los iguales de Hyprland molestan se cambia el default.