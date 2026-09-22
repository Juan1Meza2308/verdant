# SPEC — Fase 3: Sessions Persistentes + Búsqueda

## Objetivo
Persistir cada sesión PTY (historial de bloques, comandos, salida) en SQLite para:
- **Reanudar** sesiones al reabrir verdant (restore: bloques + scrollback + cwd).
- **Buscar** globalmente en el historial (texto completo + filtros: comando, fecha, cwd, exit code).
- **Adjuntar** a una sesión existente desde otra instancia (hybrid attach: read-only o read-write).

## Alcance (Fase 3)
1. **Esquema SQLite** (`~/.local/share/verdant/sessions.db`):
   - `sessions` — metadata: id, created_at, updated_at, cwd, shell, cols, rows, exit_code, title (editable).
   - `blocks` — por sesión: id, session_id, seq (ordinal), start_row, end_row, command, command_hash (para dedup), created_at.
   - `block_output` — chunks de salida por bloque (append-only, compressed opcional): id, block_id, seq, data (BLOB), created_at.
   - `search_fts` — tabla FTS5 virtual para búsqueda full-text: session_id, block_id, command, output_text, cwd, tags.

2. **Backend Rust** (`src-tauri/src/sessions.rs`):
   - `create_session(cols, rows, cwd, shell)` → `session_id`
   - `append_block(session_id, block: BlockData)` — block = { start_row, end_row, command }
   - `append_output(session_id, block_seq, chunk: Vec<u8>)`
   - `close_session(session_id, exit_code)`
   - `list_sessions(limit, offset, filter?)` — paginado, orden `updated_at DESC`
   - `get_session(session_id)` → Session + blocks (sin output completo)
   - `get_block_output(session_id, block_seq)` → Vec<u8> (para restore scrollback)
   - `search(query, filters?)` → hits con snippet + session_id + block_seq + rank
   - `update_session_title(session_id, title)`
   - `delete_session(session_id)` — cascada

3. **Frontend**:
   - `src/lib/sessions.ts` — tipado + `SessionStore` (cache + invalidate) + `searchSessions()`
   - Overlay **SessionPicker** (Ctrl+Shift+P): lista paginada, búsqueda en vivo (debounce 150ms), Enter → attach/restore, flechas, preview lateral (últimos bloques + comando).
   - Integración en `TerminalPane`: al spawn → `create_session`; en cada `C` → `append_block`; en `terminal-data` → `append_output` (throttle 200ms batch); en exit → `close_session`.
   - Restore al crear pane: si `session_id` pasado por prop → `get_session` + `get_block_output` por bloques → replay en xterm (feed parser + write).

4. **Hybrid attach** (read-only por defecto):
   - Segunda instancia abre la misma `session_id` → `get_session` + tail de output → modo "follow" (nuevos datos llegan por events Tauri).
   - Opción `--read-write` para toma de control (solo una writer a la vez; mutex en DB).

## Fuera de alcance (Fase 4+)
- Compresión de output (zstd) y retentión por tamaño/edad.
- Sincronización multi-dispositivo (Git/CRDT).
- Export/import sessions (JSONL).

## Criterios de salida (todos verificables en uso real)
1. **Persistencia**: cerrar y reabrir verdant → tabs/panes restaurados con sus bloques, scrollback y cwd.
2. **Búsqueda global**: `Ctrl+Shift+F` en SessionPicker encuentra "git commit" de hace 3 días, abre la sesión en el bloque correcto.
3. **Hybrid attach**: dos instancias verdant abiertas → misma sesión visible en ambas; write en una aparece en la otra (<100ms).
4. **Rendimiento**: 10k sesiones / 1M bloques → `list_sessions` < 50ms, `search` < 100ms (FTS5).
5. **Sin regresión TUI**: btop/nvim en sesión restaurada funcionan igual que en vivo.
6. **Tests**: cargo test (backend) + vitest (frontend store/search) verdes.