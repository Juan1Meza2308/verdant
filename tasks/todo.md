# Todo

## ✅ Fase 0: terminal-core — COMPLETA

- [x] Scaffold Tauri v2 + React + TS (create-tauri-app)
  - Acceptance: `npm run tauri dev` compila y abre ventana base
  - Verify: ✅ ventana 1280×800, min 640×400, centrada
- [x] PTY backend con portable-pty
  - Acceptance: `spawn_terminal` crea PTY con shell config; resize y IO por eventos Tauri
  - Verify: ✅ 33 resizes capturados en trace (cols 80→113), echo funciona, Ctrl+C funciona
- [x] TerminalPane con xterm.js conectado al PTY
  - Acceptance: shell interactive; escribir/resize fluyen
  - Verify: ✅ btop (TUI a pantalla completa) + q sale limpio; nvim sin glitches
- [x] Scrollback + addons (fit, search, web-links)
  - Acceptance: resize ajusta fit, scrollback 5000, búsqueda inline
  - Verify: ✅ fit confirmado por trace de resize; scrollback 5000 activo
- [x] Config mínima verdant.jsonc
  - Acceptance: shell, scrollback, fontFamily, fontSize desde config
  - Verify: ✅ auto-creada en ~/.config/verdant/verdant.jsonc; 2 tests unitarios verdes
- [x] Criterio de salida Fase 0
  - Acceptance: shell interactivo, resize, TUI apps fluidas
  - Verify: ✅ echo/Ctrl+C/btop/nvim/resize OK por Felipe

## Fase 1: desktop-shell (en curso)

- [x] Task: Gestor de tabs (barra superior, crear/cerrar/renombrar; 1 tab = 1 sesión PTY)
  - Acceptance: Ctrl+Shift+T abre tab nueva con shell; Ctrl+Shift+W cierra; renombrar por doble click
  - Verify: probado por Felipe (tabs 4→9→3 con W W W, sin incidencias)
  - Files: src/components/TabBar.tsx, App.tsx, TerminalPane.tsx, pty.rs (sin cambio, multi-sesión ya soportado)
- [x] Task: Keybinds base configurables
  - Acceptance: atajos desde config (tabs, buscar); engine propio en lib/keybinds.ts
  - Verify: Ctrl+Shift+T/W, Ctrl+Tab/Ctrl+Shift+Tab, Ctrl+Shift+F (buscador inline con decorations)
  - Files: src/lib/keybinds.ts, src/lib/actions.ts, src-tauri/src/config.rs (keybinds[] + merge con defaults)
- [x] Task: Split panes (vertical/horizontal)
  - Acceptance: dividir la vista; cada pane su sesión; navegación focus con atajo
  - Verify: probado con wtype (split-v Ctrl+Shift+E → panes=2, cada pane escribió su archivo; pane-next J movió foco; pane-close Q cerró y promovió hermano, panes=1)
  - Files: src/lib/layout.ts (+layout.test.ts, 10 tests), src/components/SplitView.tsx, App.tsx, config.rs (split-v/h, pane-next/prev/close)
- [x] Task: Tema base con tokens CSS + tema oscuro propio
  - Acceptance: colores/transparencia del shell vía CSS variables; xterm theme (bg/fg/cursor) coherente
  - Verify: tokens en src/lib/theme.ts (baseTheme) aplicados en :root y a xterm (themeToXterm); API subscribeTheme lista para Fase 4
  - Files: src/lib/theme.ts, src/main.tsx (initTheme), TerminalPane.tsx (theme option + suscripción), App.css, TerminalPane.css
- [x] Task: Copiar/pegar nativo (Wayland)
  - Acceptance: Ctrl+Shift+C copia selección, Ctrl+Shift+V pega (bracketed paste)
  - Verify: pegado end-to-end probado con wl-copy → Ctrl+Shift+V → cat > archivo (verdant-paste-123)
  - Files: src/components/TerminalPane.tsx (handlers fresh por ref), src-tauri (plugin clipboard-manager + capabilities), config.rs (copy/paste en keybinds)
- [ ] Task: Criterio de salida Fase 1
  - Acceptance: un día normal sin abrir kitty/ghostty: tabs, split, buscar, copiar/pegar, tema
  - Verify: uso real por Felipe
  - Files: —

## Fase 2: blocks (en curso — spec en SPEC-blocks.md)

- [ ] Task: Integración shell fish (OSC 133)
  - Acceptance: `~/.config/fish/conf.d/verdant.fish` emite `\e]133;A` en fish_prompt, `\e]133;B;cmd=<base64>` en fish_preexec (commandline), `\e]133;C` en fish_postexec; guard para línea vacía
  - Verify: stream del PTY muestra los marcadores y el payload base64 decodifica al comando crudo (con acentos)
  - Files: packaging/fish/verdant.fish (canónico en repo, copia a conf.d)
- [ ] Task: Parser OSC 133 (lib puro)
  - Acceptance: `segmentOsc133(chunk)` → segmentos `{text, marker?, payload?}`; soporta BEL y ST; texto mezclado intacto; falsos positivos (`echo "\e]133;A"`) no rompen el stream
  - Verify: vitest (osc133.test.ts)
  - Files: src/lib/osc133.ts
- [ ] Task: Modelo de bloques (lib puro)
  - Acceptance: builder por marcadores (A abre, B fija command, C cierra con endRow); huérfanos ignorados; bloques del final abiertos
  - Verify: vitest (blocks.test.ts)
  - Files: src/lib/blocks.ts
- [ ] Task: Integración stream→modelo en TerminalPane
  - Acceptance: los marcadores se eliminan antes de `write` (xterm nunca los ve); escrituras serializadas con callbacks (row exacta en cada marcador); cola de marcadores pendientes
  - Verify: manual (comandos corridos → bloques en modelo, docs log) + sin regresión TUI (btop/nvim)
  - Files: src/components/TerminalPane.tsx
- [ ] Task: Overlay visual de bloques (decorations)
  - Acceptance: fondo sutil por bloque en viewport (layer bottom) + contorno del activo (layer top); sólo bloques visibles/adyacentes pintados; scroll automático con decorations; `pointer-events: none`
  - Verify: manual con wtype: 3 comandos → 3 bloques visibles; scroll no descoloca fondos
  - Files: src/components/TerminalPane.tsx o src/components/BlockOverlay.tsx
- [ ] Task: Navegación y acciones de bloque
  - Acceptance: block-prev/next (Ctrl+Shift+↑/↓) seleccionan y scrollean al inicio; block-rerun (Ctrl+Shift+R) re-envía el comando vía paste; block-copy (Ctrl+Shift+Y) copia el comando (wl-paste verificable)
  - Verify: manual end-to-end con wtype (rerun: `echo … >> archivo`)
  - Files: src/lib/keybinds.ts, config.rs (DEFAULT_KEYBINDS + template), TerminalPane.tsx
- [ ] Task: Snippets backend
  - Acceptance: comando Tauri `get_snippets` lee `~/.config/verdant/snippets.jsonc` (json5), crea default si falta, error controlado si inválido
  - Verify: cargo test (snippets.rs)
  - Files: src-tauri/src/snippets.rs, commands.rs, lib.rs
- [ ] Task: Snippets frontend (lib + overlay)
  - Acceptance: caché singleton; `resolveSnippet` sustituye `{{var}}` / `{{var:default}}`; overlay por pane (Ctrl+Shift+S): lista, flechas, Enter; con variables muestra campos; Escape cierra; inserta vía term.paste
  - Verify: vitest (snippets.test.ts) + manual (cat > archivo recibe el snippet resuelto)
  - Files: src/lib/snippets.ts, src/components/SnippetOverlay.tsx, TerminalPane.tsx
- [ ] Task: Criterio de salida Fase 2
  - Acceptance: los 6 success criteria de SPEC-blocks.md (bloques navegables, rerun, copy, snippets con variables, TUI intactas, tests verdes)
  - Verify: uso real por Felipe

## Fase 3: sessions (pendiente)
## Fase 3: sessions (pendiente)
## Fase 4: theming ryoku (pendiente)
## Fase 5: ai opencode (pendiente)