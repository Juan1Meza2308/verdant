# Plan Fase 3: Sessions (SQLite + Búsqueda)

## Orden de construcción (dependencias → consumidores)

1. **Esquema + migraciones** (`src-tauri/src/db.rs`)
   - `rusqlite` + `tokio-rusqlite` (pool) o `sqlx` (async nativo). Decisión: **sqlx** (async, compile-time checked, migraciones integradas).
   - Tablas: `sessions`, `blocks`, `block_output`, `search_fts` (FTS5).
   - Migraciones embebidas (`sqlx::migrate!`).

2. **Backend sessions** (`src-tauri/src/sessions.rs`)
   - Tipos `Session`, `BlockData`, `SearchHit`, `SessionFilter`.
   - Comandos Tauri (ver SPEC).
   - Pool `SqlitePool` en `AppState` (compartido con PTY manager).

3. **Integración PTY → Sessions** (`pty.rs` + `TerminalPane.tsx`)
   - `spawn_session` → `create_session` + guarda `session_id` en `SessionInfo`.
   - `write_to_pty` no cambia; `terminal-data` (batch) → `append_output`.
   - Marker `C` en parser → `append_block`.
   - Exit event → `close_session`.

4. **Frontend store** (`src/lib/sessions.ts`)
   - `SessionStore` singleton: cache `Map<id, Session>`, `search(query, filters)` → `invoke("search_sessions")`.
   - Tipos TypeScript espejo de Rust (serde compatible).

5. **SessionPicker Overlay** (`src/components/SessionPicker.tsx` + CSS)
   - Abre con `Ctrl+Shift+P` (nuevo keybind).
   - Debounced search input → `searchSessions` → lista virtualizada (solo 50 items DOM).
   - Preview lateral: últimos 5 bloques + comando del seleccionado.
   - Enter → `attach_session(session_id)` (dispatch action → TerminalPane crea pane con `session_id`).
   - Escape / click fuera → cierra.

6. **Restore / Replay** (`TerminalPane.tsx`)
   - Prop opcional `initialSessionId?: number`.
   - Si presente: `get_session` + para cada bloque `get_block_output` → feed al parser OSC 133 + `terminal.write` serializado (igual que stream vivo).
   - Scrollback restaurado → `terminal.scrollToLine(0)` al final.

7. **Hybrid attach (read-only)**
   - Evento Tauri `session_update` (broadcast a todas las ventanas) en `append_output` / `append_block` / `close_session`.
   - Frontend listener: si pane tiene `session_id` coincidente y no es writer → `pushChunk` igual que vivo.

8. **Tests + criterios**
   - `cargo test` (db, sessions, search).
   - `vitest` (sessions store, search debounce, picker rendering).
   - Verificación manual de los 6 criterios de SPEC.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|------------|
| **sqlx compile-time checks** requieren DB en build | `sqlx-cli` + `DATABASE_URL` en `.env` solo para dev; `sqlx::migrate!` embebido en release. |
| **Output grande** (scrollback 5000 líneas × muchas sesiones) | `block_output` append-only; `get_block_output` stream por chunks; opcional `COMPRESS()` en migración futura. |
| **Contención writer/readers** hybrid attach | Mutex por `session_id` en `AppState` (HashMap<id, Mutex<()>>). Writer exclusivo; readers compartidos. |
| **FTS5 sincronización** | Trigger `AFTER INSERT ON block_output` → `INSERT INTO search_fts` (solo texto plano, sin ANSI). Parser strip ANSI en backend antes de insertar. |
| **Migración esquema futura** | `sqlx::migrate!` versionado; `PRAGMA user_version` + migraciones idempotentes. |

## Decisiones técnicas clave

- **sqlx + SQLite** (no rusqlite): async nativo, pool, migraciones, compile-time SQL check.
- **FTS5** para búsqueda: `search_fts(session_id, block_id, command, output_text, cwd, tags)` — tokenizer `porter` + `unicode61`.
- **Batch output**: `terminal-data` llega en chunks; agrupar 200ms o 64KB antes de `append_output` (reduce roundtrips).
- **Session ID en TerminalPane**: `sessionId` ya existe (pty.rs lo devuelve); reutilizar para DB key.
- **Hybrid attach**: Tauri `emit` a todas las ventanas (`app.emit_all("session_update", payload)`); frontend filtra por `session_id`.