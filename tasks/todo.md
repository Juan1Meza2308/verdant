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

- [ ] Task: Gestor de tabs (barra superior, crear/cerrar/renombrar; 1 tab = 1 sesión PTY)
  - Acceptance: Ctrl+Shift+T abre tab nueva con shell; Ctrl+Shift+W cierra; renombrar por doble click
  - Verify: manual en `npm run tauri dev`
  - Files: src/components/TabBar.tsx, App.tsx, TerminalPane.tsx, pty.rs (sin cambio, multi-sesión ya soportado)
- [ ] Task: Keybinds base configurables
  - Acceptance: atajos desde config (tabs, buscar, copiar/pegar, pane split); engine propio en lib/keybinds.ts
  - Verify: probar cada atajo
  - Files: src/lib/keybinds.ts, src-tauri/src/config.rs (keybinds[])
- [ ] Task: Split panes (vertical/horizontal)
  - Acceptance: dividir la vista; cada pane su sesión; navegación focus con atajo
  - Verify: abrir 2 panes y correr comandos en cada uno
  - Files: src/components/SplitView.tsx, App.tsx
- [ ] Task: Tema base con tokens CSS + tema oscuro propio
  - Acceptance: colores/transparencia del shell vía CSS variables; xterm theme (bg/fg/cursor) coherente
  - Verify: cambiar token en theme.ts y ver al reload
  - Files: src/lib/theme.ts, src/styles/tokens.css, TerminalPane.tsx (theme option), App.css
- [ ] Task: Copiar/pegar nativo (Wayland)
  - Acceptance: Ctrl+Shift+C copia selección, Ctrl+Shift+V pega (bracketed paste)
  - Verify: copiar texto de salida y pegarlo en otra tab
  - Files: src/components/TerminalPane.tsx, src/lib/clipboard.ts
- [ ] Task: Criterio de salida Fase 1
  - Acceptance: un día normal sin abrir kitty/ghostty: tabs, split, buscar, copiar/pegar, tema
  - Verify: uso real por Felipe
  - Files: —

## Fase 2: blocks (pendiente)
## Fase 3: sessions (pendiente)
## Fase 4: theming ryoku (pendiente)
## Fase 5: ai opencode (pendiente)