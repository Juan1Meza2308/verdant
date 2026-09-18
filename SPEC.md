# Spec: Verdant

Terminal manager personal tipo Warp para reemplazar kitty/ghostty como daily driver en Arch + Hyprland/Quickshell (Ryoku).

## Objective

Darle a Felipe un terminal manager propio que reemplace a kitty/ghostty en el uso diario:

- Bloques tipo Warp: cada comando con su salida en un bloque navegable y reutilizable.
- Sesiones persistentes en disco (reconstrucción de bloques) + attach híbrido para procesos elegidos (dev servers).
- Búsqueda global FTS5 sobre todo el historial (comandos, salidas, sesiones).
- Estética integrada 100% con el desktop Ryoku: temas generados desde el tema/wallpaper del sistema, con reload en vivo.
- Keybinds propios estilo Hyprland/vim, navegación 100% teclado.
- Workflows que abren proyectos con opencode listo.
- AI local gratis: opencode + Ollama como ciudadanos de primera clase (sin suscripciones, sin telemetría).

## Capability Map

| Module id       | Responsibility                                              | Depends on |
|-----------------|-------------------------------------------------------------|------------|
| terminal-core   | PTY (spawn/resize/IO), render xterm.js, perfiles, scrollback| —          |
| desktop-shell   | Tabs, splits, keybinds, paleta de comandos, tema base CSS   | terminal-core |
| blocks          | Shell integration, modelo de bloques, snippets/workflows    | desktop-shell |
| sessions        | Persistencia SQLite, restauración, attach híbrido, FTS5     | blocks |
| theming         | Theme engine desde Ryoku/wallpaper + live reload            | desktop-shell |
| ai              | Integración opencode + conveniencias Ollama                 | sessions |

Build order: terminal-core → desktop-shell → blocks → sessions → theming → ai

## Tech Stack

- Tauri v2 (Rust backend)
- React 18 + TypeScript + Vite (frontend)
- xterm.js (`@xterm/xterm`) + addons: fit, search, web-links, serialize, unicode11
- `portable-pty` (motor PTY de Wezterm) — spawn/resize/IO
- SQLite vía `rusqlite` + FTS5 (módulo sessions)
- CSS variables para el tema (blur/transparencia nativa Hyprland)

Shell por defecto: `fish -l` (shell del sistema), configurable por perfil.

## Commands

```bash
npm run tauri dev        # desarrollo completo (frontend + backend)
npm run dev              # solo frontend (Vite)
npm run tauri build      # build release (AppImage/deb/tar.gz)
cargo test               # tests del backend Rust
npm run test             # tests del frontend (vitest)
npm run lint             # eslint + tsc --noEmit
```

## Project Structure

```
src/               → Frontend React
  components/      → TerminalPane, BlockList, Tabs, CommandPalette, SplitView, StatusBar
  lib/             → keybinds.ts, themeTokens.ts, bridge.ts (invoke Tauri), types.ts
src-tauri/         → Backend Rust
  src/
    main.rs        → entrypoint Tauri
    pty.rs         → módulo PTY (spawn, resize, IO, close)
    db.rs          → SQLite (sessions/snippets) [Fase 3]
    theme.rs       → theme engine ryoku [Fase 4]
    commands.rs    → comandos Tauri expuestos al frontend
  Cargo.toml, tauri.conf.json, capabilities/
tasks/             → plan.md, todo.md
docs/              → decisiones (ADRs ligeros cuando toque)
```

## Code Style

TypeScript estricto: prohibido `any`/`ts-ignore`. Constantes semánticas en mayúsculas
(`MAX_SCROLLBACK = 5000`). Componentes PascalCase, funciones camelCase, archivos kebab-case.
Código/comentarios en inglés; commits en español (convención Juan1Meza2308).

```ts
// src/lib/bridge.ts
import { invoke } from "@tauri-apps/api/core";

export async function spawnTerminal(profile: Profile): Promise<number> {
  return invoke<number>("spawn_terminal", { profile });
}
```

## Testing Strategy

- Rust: tests unitarios en `pty.rs`/`db.rs` (config, IO simulado) → `cargo test`.
- Frontend: `vitest` + testing-library sobre lógica pura (keybinds, bloques, parseo de estado).
- Manual E2E por fase: correr `vim`, `htop`, `fish`, `opencode` sin glitches.
- Sin cobertura obligatoria global; sí en lógica core (keybinds, db, parseo).

## Boundaries

- **Always:** microcommits por avance lógico; tests antes de commit; commit a nombre de Juan1Meza2308; validar input en el backend.
- **Ask first:** agregar dependencias, cambiar schema de DB, cambiar atajos por defecto, renombrar la app, decisiones de UI/theme grandes.
- **Never:** telemetría/analytics, secretos, remover tests, `any`/`ts-ignore`, select * en SQL, hardcodear credenciales.

## Success Criteria — Fase 0 (terminal-core)

- `npm run tauri dev` abre la ventana; se ve un shell fish interactivo.
- Escribir, borrar, Ctrl+C, resize de ventana sin glitches.
- `vim` y `htop` corren fluidos (rendering correcto, sin flicker).
- Scrollback mínimo 5000 líneas; copiar/pegar básico funciona.
- Archivo de configuración `verdant.jsonc` mínimo parseado (shell por defecto: fish).

## Open Questions

- Nombre final (verdant provisional; renombrar es un find-replace).
- Distribución del binario (AppImage vs tar.gz vs .pkg.tar).
- ¿Soporte initial de tmux como "attach" rápido antes del motor híbrido propio?