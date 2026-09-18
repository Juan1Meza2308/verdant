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

- [x] Task: Integración shell fish (OSC 133) — nativa
  - Acceptance: fish ≥ 4 emite `A`, `B`, `C;cmdline_url=<comando url-encoded>` sin tocar config de usuario; conf.d solo como fallback opcional para fish < 4
  - Verify: ✅ fish 4.9.3 con TERM=xterm-256color: A;click_events=1 → B → C;cmdline_url=echo%20%22saludo…%22
  - Files: packaging/fish/verdant.fish (fallback opcional, no instalado)
- [x] Task: Parser OSC 133 (lib puro)
  - Acceptance: `segmentOsc133(chunk)` → segmentos `{text, marker?, payload?}`; soporta BEL y ST; texto mezclado intacto; falsos positivos (`echo "\e]133;A"`) no rompen el stream
  - Verify: ✅ vitest osc133.test.ts (14 tests nuevos; 49/49 globales verdes); MAX_OSC133_TAIL + decodeBase64Utf8 exportados
  - Files: src/lib/osc133.ts
- [x] Task: Modelo de bloques (lib puro)
  - Acceptance: builder por marcadores (A abre, B fija command, C cierra con endRow); huérfanos ignorados; bloques del final abiertos
  - Verify: ✅ vitest blocks.test.ts (decodeCommandPayload cmdline_url/cmd, transiciones A/B/C, navegación adjacent/containing)
  - Files: src/lib/blocks.ts
- [x] Task: Integración stream→modelo en TerminalPane
  - Acceptance: los marcadores se eliminan antes de `write` (xterm nunca los ve); escrituras serializadas con callbacks (row exacta en cada marcador); cola de marcadores pendientes
  - Verify: ✅ build TS verde + 49 tests; logs `[blocks] A/C` esperados en startup (primer prompt). Verificación runtime en curso (ver `[blocks]` en salida dev)
  - Files: src/components/TerminalPane.tsx
- [x] Task: Overlay visual de bloques (decorations)
  - Acceptance: fondo sutil por bloque en viewport (layer bottom) + contorno del activo (layer top); sólo bloques visibles/adyacentes pintados; scroll automático con decorations; `pointer-events: none`
  - Verify: ✅ build TS verde + 54 tests (blendOver/blockFillColor); decorations por bloque con height en celdas (open → rows), activo por clase CSS, limpieza por onDispose. Verificación visual pendiente de uso real
  - Files: src/lib/blockOverlay.ts (+test), TerminalPane.tsx (allowProposedApi, eventos A/C → overlay), TerminalPane.css
- [x] Task: Navegación y acciones de bloque
  - Acceptance: block-prev/next (Ctrl+Shift+↑/↓) seleccionan y scrollean al inicio; block-rerun (Ctrl+Shift+R) re-envía el comando vía paste; block-copy (Ctrl+Shift+Y) copia el comando (wl-paste verificable)
  - Verify: ✅ keybinds cargan en config (logs `[binds] ... block-prev=Ctrl+Shift+ArrowUp ...`); handlers suscritos al bus de acciones con refs frescas; pruebas de navegación/rerun/copy pendientes de uso real
  - Files: src/lib/keybinds.ts (sin cambios, soporta ArrowUp/Down), src/lib/actions.ts (nuevos ActionName), src/App.tsx (binds), src-tauri/src/config.rs (defaults), TerminalPane.tsx (handlers con adjacentBlockId, paste, writeText)
- [x] Task: Snippets backend
  - Acceptance: comando Tauri `get_snippets` lee `~/.config/verdant/snippets.jsonc` (json5), crea default si falta, error controlado si inválido
  - Verify: ✅ `cargo check` verde; módulo `snippets.rs` + comando registrado; default con `date`/`cwd`; validación trigger no vacío
  - Files: src-tauri/src/snippets.rs, lib.rs
- [x] Task: Snippets frontend (lib + overlay)
  - Acceptance: caché singleton; `resolveSnippet` sustituye `{{var}}` / `{{var:default}}`; overlay por pane (Ctrl+Shift+S): lista, flechas, Enter; con variables muestra campos; Escape cierra; inserta vía term.paste
  - Verify: ✅ build TS verde + 54 tests; overlay SnippetOverlay.tsx + CSS; wiring en TerminalPane (showSnippets state, handler real); backend get_cwd para {{cwd}} built-in
  - Files: src/lib/snippets.ts, src/components/SnippetOverlay.tsx (+CSS), src-tauri/src/snippets.rs (get_cwd), TerminalPane.tsx
- [x] Task: Criterio de salida Fase 2
  - Acceptance: los 6 success criteria de SPEC-blocks.md (bloques navegables, rerun, copy, snippets con variables, TUI intactas, tests verdes)
  - Verify: ✅ runtime verificado: keybinds + pipeline bloques + overlay + snippets + tabs/splits/panes + search/copy/paste funcionales
  - Files: —

## Fase 3: sessions (en curso — spec en SPEC-sessions.md)

- [x] Task: Esquema SQLite + migraciones (sqlx)
  - Acceptance: `sqlx::migrate!` embebido; tablas sessions/blocks/block_output/search_fts (FTS5); pool SqlitePool en AppState
  - Verify: ✅ `cargo check` verde; migración 001_initial_schema.sql con triggers updated_at; db.rs con create_pool/run_migrations; sqlx + tokio + dirs en Cargo.toml
  - Files: src-tauri/src/db.rs, src-tauri/migrations/001_initial_schema.sql, Cargo.toml, commands.rs, lib.rs

- [ ] Task: Backend sessions (comandos Tauri)
  - Acceptance: create_session, append_block, append_output (batch), close_session, list_sessions, get_session, get_block_output, search, update_session_title, delete_session
  - Verify: cargo test (sessions.rs) + invocación manual desde frontend
  - Files: src-tauri/src/sessions.rs, commands.rs, lib.rs

- [ ] Task: Integración PTY → Sessions (spawn + markers + output + exit)
  - Acceptance: spawn → create_session; marker C → append_block; terminal-data (throttle 200ms) → append_output; exit → close_session
  - Verify: logs `[session] create/append/close` en dev; datos en DB inspeccionables
  - Files: src-tauri/src/pty.rs, src/components/TerminalPane.tsx

- [ ] Task: Frontend store + tipos (src/lib/sessions.ts)
  - Acceptance: SessionStore singleton, cache + invalidate, searchSessions(query, filters) con debounce, tipos TS ↔ Rust
  - Verify: vitest (store, search debounce)
  - Files: src/lib/sessions.ts (+test)

- [ ] Task: SessionPicker Overlay (Ctrl+Shift+P)
  - Acceptance: lista paginada virtualizada, búsqueda en vivo (debounce 150ms), preview lateral (últimos bloques), Enter → attach, Escape cierra
  - Verify: manual + vitest (render, keyboard nav)
  - Files: src/components/SessionPicker.tsx (+CSS), TerminalPane.tsx (keybind + action)

- [ ] Task: Restore / Replay de sesión al crear pane
  - Acceptance: prop `initialSessionId` → get_session + get_block_output por bloques → replay en parser + terminal.write serializado; scrollback restaurado
  - Verify: cerrar y reabrir verdant → tabs/panes con bloques y scrollback idénticos
  - Files: src/components/TerminalPane.tsx, App.tsx (pasa session_id al crear pane)

- [ ] Task: Hybrid attach (read-only + broadcast)
  - Acceptance: segunda instancia abre misma sesión → follow mode (recibe updates por `session_update` event); opción read-write con mutex por session_id
  - Verify: dos ventanas verdant → mismo contenido en tiempo real (<100ms)
  - Files: src-tauri/src/sessions.rs (emit), TerminalPane.tsx (listener)

- [ ] Task: Criterio de salida Fase 3
  - Acceptance: los 6 criterios de SPEC-sessions.md (persistencia, búsqueda global, hybrid attach, rendimiento, TUI, tests)
  - Verify: uso real por Felipe
  - Files: —

## Fase 4: theming ryoku (pendiente)
## Fase 5: ai opencode (pendiente)