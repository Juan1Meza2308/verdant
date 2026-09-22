//! Backend de sessions: comandos Tauri para persistir y buscar sesiones PTY.

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use tauri::{AppHandle, Emitter, State};
use tracing;

/// Evento broadcast (hybrid attach): el writer publica output/bloques/cierre
/// y los panes "follower" (misma session_id, modo lectura) lo aplican en vivo.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionUpdate {
    pub session_id: i64,
    /// "output" | "block" | "close"
    pub kind: String,
    pub block_seq: i64,
    /// Bytes crudos en base64 (solo kind="output").
    pub data: Option<String>,
    pub start_row: Option<i64>,
    pub end_row: Option<i64>,
    pub command: Option<String>,
    pub exit_code: Option<i64>,
}

/// Sesión completa (para listado y restore).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: i64,
    pub created_at: String,
    pub updated_at: String,
    pub cwd: String,
    pub shell: String,
    pub cols: i64,
    pub rows: i64,
    pub exit_code: Option<i64>,
    pub title: Option<String>,
    pub env_json: Option<String>,
    pub scrollback_limit: Option<i64>,
}

/// Bloque individual (comando + metadata).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Block {
    pub id: i64,
    pub session_id: i64,
    pub seq: i64,
    pub start_row: i64,
    pub end_row: Option<i64>,
    pub command: String,
    pub command_hash: String,
    pub created_at: String,
}

/// Hit de búsqueda (FTS5).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchHit {
    pub session_id: i64,
    pub block_id: i64,
    pub command: String,
    pub output_snippet: String,
    pub cwd: String,
    pub rank: f64,
}

/// Filtros para listado/búsqueda.
#[derive(Debug, Clone, Deserialize, Default)]
pub struct SessionFilter {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub cwd: Option<String>,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
    pub exited_only: Option<bool>,
}

/// Payload para crear sesión.
#[derive(Debug, Clone, Deserialize)]
pub struct CreateSessionPayload {
    pub cols: u16,
    pub rows: u16,
    pub cwd: String,
    pub shell: String,
    pub env_json: Option<String>,
}

/// Hash simple del comando (FNV-1a 64-bit, estable).
fn command_hash(cmd: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    cmd.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

/// Strip ANSI/OSC para indexar en FTS (reutiliza lógica de db.rs).
fn strip_ansi_for_fts(input: &[u8]) -> String {
    let text = String::from_utf8_lossy(input);
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '\x1b' {
            if let Some(&next) = chars.peek() {
                match next {
                    '[' => {
                        chars.next();
                        while let Some(ch) = chars.next() {
                            if ch >= '@' && ch <= '~' { break; }
                        }
                    }
                    ']' => {
                        chars.next();
                        while let Some(ch) = chars.next() {
                            if ch == '\x07' { break; }
                            if ch == '\x1b' {
                                if let Some(&c2) = chars.peek() {
                                    if c2 == '\\' { chars.next(); break; }
                                }
                            }
                        }
                    }
                    'P' | 'X' | '^' | '_' => {
                        while let Some(ch) = chars.next() {
                            if ch == '\x1b' {
                                if let Some(&c2) = chars.peek() {
                                    if c2 == '\\' { chars.next(); break; }
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
        } else if c == '\x07' {
            // Bell: se descarta.
        } else if c == '\r' {
            // Salto de línea (CRLF o CR suelto): normaliza a \n.
            if chars.peek() == Some(&'\n') {
                chars.next();
            }
            out.push('\n');
        } else if c == '\x08' {
            // Backspace del redibujo de línea: borra el último carácter emitido.
            out.pop();
        } else {
            out.push(c);
        }
    }
    // Truncar a ~2KB por chunk para FTS
    if out.len() > 2048 {
        out.truncate(2048);
        out.push_str("…");
    }
    out
}

/// Crea una nueva sesión y devuelve su ID.
#[tauri::command(rename_all = "snake_case")]
pub async fn create_session(
    state: State<'_, crate::commands::AppState>,
    payload: CreateSessionPayload,
) -> Result<i64, String> {
    let pool = &state.db;
    let now = chrono::Utc::now().to_rfc3339();
    let cols = payload.cols as i64;
    let rows = payload.rows as i64;

    let id = sqlx::query!(
        r#"
        INSERT INTO sessions (created_at, updated_at, cwd, shell, cols, rows, env_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        "#,
        now,
        now,
        payload.cwd,
        payload.shell,
        cols,
        rows,
        payload.env_json
    )
    .execute(pool)
    .await
    .map_err(|e| format!("create_session: {e}"))?
    .last_insert_rowid();

    tracing::info!("[session] created id={}", id);
    Ok(id)
}

/// Añade un bloque (marker C) a la sesión.
#[tauri::command(rename_all = "snake_case")]
pub async fn append_block(
    app: AppHandle,
    state: State<'_, crate::commands::AppState>,
    session_id: i64,
    seq: i64,
    start_row: i64,
    end_row: Option<i64>,
    command: String,
) -> Result<i64, String> {
    let pool = &state.db;
    let now = chrono::Utc::now().to_rfc3339();
    let hash = command_hash(&command);

    let block_id = sqlx::query!(
        r#"
        INSERT INTO blocks (session_id, seq, start_row, end_row, command, command_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        "#,
        session_id,
        seq,
        start_row,
        end_row,
        command,
        hash,
        now
    )
    .execute(pool)
    .await
    .map_err(|e| format!("append_block: {e}"))?
    .last_insert_rowid();

    let _ = app.emit(
        "session_update",
        SessionUpdate {
            session_id,
            kind: "block".into(),
            block_seq: seq,
            data: None,
            start_row: Some(start_row),
            end_row,
            command: Some(command),
            exit_code: None,
        },
    );

    tracing::info!("[session] append_block session={} block={} seq={}", session_id, block_id, seq);
    Ok(block_id)
}

/// Actualiza command + end_row de un bloque (marker C: comando terminado).
#[tauri::command(rename_all = "snake_case")]
pub async fn update_block(
    app: AppHandle,
    state: State<'_, crate::commands::AppState>,
    session_id: i64,
    seq: i64,
    command: String,
    end_row: i64,
) -> Result<(), String> {
    let pool = &state.db;
    let hash = command_hash(&command);
    sqlx::query!(
        "UPDATE blocks SET command = ?, command_hash = ?, end_row = ? WHERE session_id = ? AND seq = ?",
        command,
        hash,
        end_row,
        session_id,
        seq
    )
    .execute(pool)
    .await
    .map_err(|e| format!("update_block: {e}"))?;

    // Sincroniza el comando final en las filas FTS: sus chunks se indexaron
    // con command vacío porque el marcador C llega después del output.
    sqlx::query!(
        "UPDATE search_fts SET command = ? WHERE session_id = ? AND block_id = (SELECT id FROM blocks WHERE session_id = ? AND seq = ?)",
        command,
        session_id,
        session_id,
        seq
    )
    .execute(pool)
    .await
    .map_err(|e| format!("update_block fts: {e}"))?;

    let _ = app.emit(
        "session_update",
        SessionUpdate {
            session_id,
            kind: "block".into(),
            block_seq: seq,
            data: None,
            start_row: None,
            end_row: Some(end_row),
            command: Some(command),
            exit_code: None,
        },
    );
    Ok(())
}

/// Añade chunk de output a un bloque (batch desde terminal-data).
#[tauri::command(rename_all = "snake_case")]
pub async fn append_output(
    app: AppHandle,
    state: State<'_, crate::commands::AppState>,
    session_id: i64,
    block_seq: i64,
    data: Vec<u8>,
) -> Result<(), String> {
    let pool = &state.db;

    // Obtiene block_id
    let block = sqlx::query!("SELECT id FROM blocks WHERE session_id = ? AND seq = ?", session_id, block_seq)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("append_output find block: {e}"))?
        .ok_or_else(|| format!("block not found: session={} seq={}", session_id, block_seq))?;

    let block_id = block.id;
    let now = chrono::Utc::now().to_rfc3339();

    // Siguiente seq para este bloque
    let next_seq: i64 = sqlx::query!("SELECT COALESCE(MAX(seq), -1) + 1 as seq FROM block_output WHERE block_id = ?", block_id)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("append_output next_seq: {e}"))?
        .seq;

    // Inserta chunk
    sqlx::query!(
        "INSERT INTO block_output (block_id, seq, data, created_at) VALUES (?, ?, ?, ?)",
        block_id,
        next_seq,
        data,
        now
    )
    .execute(pool)
    .await
    .map_err(|e| format!("append_output insert: {e}"))?;

    // Indexa en FTS (strip ANSI + command + cwd)
    let session = sqlx::query!("SELECT cwd FROM sessions WHERE id = ?", session_id)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("append_output session cwd: {e}"))?;

    let block_cmd = sqlx::query!("SELECT command FROM blocks WHERE id = ?", block_id)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("append_output block cmd: {e}"))?;

    let output_text = strip_ansi_for_fts(&sqlx::query!("SELECT data FROM block_output WHERE block_id = ? AND seq = ?", block_id, next_seq)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("append_output fetch data: {e}"))?
        .data);

    sqlx::query!(
        "INSERT INTO search_fts (session_id, block_id, command, output_text, cwd, tags) VALUES (?, ?, ?, ?, ?, '')",
        session_id,
        block_id,
        block_cmd.command,
        output_text,
        session.cwd
    )
    .execute(pool)
    .await
    .map_err(|e| format!("append_output fts: {e}"))?;

    // Hybrid attach: broadcast a los panes follower de esta sesión.
    let b64 = B64.encode(&data);
    let _ = app.emit(
        "session_update",
        SessionUpdate {
            session_id,
            kind: "output".into(),
            block_seq,
            data: Some(b64),
            start_row: None,
            end_row: None,
            command: None,
            exit_code: None,
        },
    );

    Ok(())
}

/// Cierra la sesión (exit code).
#[tauri::command(rename_all = "snake_case")]
pub async fn close_session(
    app: AppHandle,
    state: State<'_, crate::commands::AppState>,
    session_id: i64,
    exit_code: Option<i64>,
) -> Result<(), String> {
    let pool = &state.db;
    let now = chrono::Utc::now().to_rfc3339();

    sqlx::query!(
        "UPDATE sessions SET exit_code = ?, updated_at = ? WHERE id = ?",
        exit_code,
        now,
        session_id
    )
    .execute(pool)
    .await
    .map_err(|e| format!("close_session: {e}"))?;

    // Cierra bloques abiertos (end_row = start_row si no tienen output)
    sqlx::query!(
        "UPDATE blocks SET end_row = COALESCE(end_row, start_row) WHERE session_id = ? AND end_row IS NULL",
        session_id
    )
    .execute(pool)
    .await
    .map_err(|e| format!("close_session blocks: {e}"))?;

    let _ = app.emit(
        "session_update",
        SessionUpdate {
            session_id,
            kind: "close".into(),
            block_seq: 0,
            data: None,
            start_row: None,
            end_row: None,
            command: None,
            exit_code,
        },
    );

    tracing::info!("[session] closed id={} exit_code={:?}", session_id, exit_code);
    Ok(())
}

/// Lista sesiones (paginado, orden updated_at DESC).
#[tauri::command]
pub async fn list_sessions(
    state: State<'_, crate::commands::AppState>,
    filter: Option<SessionFilter>,
) -> Result<Vec<Session>, String> {
    let pool = &state.db;
    let f = filter.unwrap_or_default();
    let limit = f.limit.unwrap_or(100);
    let offset = f.offset.unwrap_or(0);
    let exited_only = f.exited_only.unwrap_or(false) as i64;
    let cwd_like = f.cwd.map(|c| format!("%{}%", c));
    let from_date = f.from_date;
    let to_date = f.to_date;

    // Bind all params to locals to avoid E0716
    let p1 = cwd_like.clone();
    let p2 = cwd_like;
    let p3 = from_date.clone();
    let p4 = from_date;
    let p5 = to_date.clone();
    let p6 = to_date;
    let p7 = exited_only;
    let p8 = limit;
    let p9 = offset;

    // Query fijo con parámetros opcionales (NULL = sin filtro)
    let rows = sqlx::query!(
        r#"
        SELECT id, created_at, updated_at, cwd, shell, cols, rows, exit_code, title, env_json, scrollback_limit
        FROM sessions
        WHERE (? IS NULL OR cwd LIKE ?)
          AND (? IS NULL OR updated_at >= ?)
          AND (? IS NULL OR updated_at <= ?)
          AND (? = 0 OR exit_code IS NOT NULL)
        ORDER BY updated_at DESC
        LIMIT ? OFFSET ?
        "#,
        p1, p2, p3, p4, p5, p6, p7, p8, p9
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("list_sessions: {e}"))?;

    let mut sessions = Vec::new();
    for row in rows {
        sessions.push(Session {
            id: row.id.expect("id not null"),
            created_at: row.created_at,
            updated_at: row.updated_at,
            cwd: row.cwd,
            shell: row.shell,
            cols: row.cols,
            rows: row.rows,
            exit_code: row.exit_code,
            title: row.title,
            env_json: row.env_json,
            scrollback_limit: Some(row.scrollback_limit.expect("scrollback_limit not null")),
        });
    }
    Ok(sessions)
}

/// Obtiene sesión completa con sus bloques (sin output completo).
#[tauri::command(rename_all = "snake_case")]
pub async fn get_session(
    state: State<'_, crate::commands::AppState>,
    session_id: i64,
) -> Result<Option<(Session, Vec<Block>)>, String> {
    let pool = &state.db;

    let session = sqlx::query!(
        "SELECT id, created_at, updated_at, cwd, shell, cols, rows, exit_code, title, env_json, scrollback_limit
         FROM sessions WHERE id = ?",
        session_id
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("get_session: {e}"))?;

    let Some(s) = session else { return Ok(None); };

    let blocks = sqlx::query!(
        "SELECT id, session_id, seq, start_row, end_row, command, command_hash, created_at
         FROM blocks WHERE session_id = ? ORDER BY seq",
        session_id
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("get_session blocks: {e}"))?;

    let session = Session {
        id: s.id,
        created_at: s.created_at,
        updated_at: s.updated_at,
        cwd: s.cwd,
        shell: s.shell,
        cols: s.cols,
        rows: s.rows,
        exit_code: s.exit_code,
        title: s.title,
        env_json: s.env_json,
        scrollback_limit: s.scrollback_limit,
    };

    let blocks = blocks.into_iter().map(|b| Block {
        id: b.id.expect("block id not null"),
        session_id: b.session_id,
        seq: b.seq,
        start_row: b.start_row,
        end_row: b.end_row,
        command: b.command,
        command_hash: b.command_hash,
        created_at: b.created_at,
    }).collect();

    Ok(Some((session, blocks)))
}

/// Obtiene output completo de un bloque (para restore scrollback).
#[tauri::command(rename_all = "snake_case")]
pub async fn get_block_output(
    state: State<'_, crate::commands::AppState>,
    session_id: i64,
    block_seq: i64,
) -> Result<Option<Vec<u8>>, String> {
    let pool = &state.db;

    let block = sqlx::query!("SELECT id FROM blocks WHERE session_id = ? AND seq = ?", session_id, block_seq)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("get_block_output find: {e}"))?;

    let Some(block) = block else { return Ok(None); };

    let chunks = sqlx::query!("SELECT data FROM block_output WHERE block_id = ? ORDER BY seq", block.id)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("get_block_output chunks: {e}"))?;

    let mut output = Vec::new();
    for chunk in chunks {
        output.extend_from_slice(&chunk.data);
    }
    Ok(Some(output))
}

/// Búsqueda full-text (FTS5) con snippet.
#[tauri::command]
pub async fn search_sessions(
    state: State<'_, crate::commands::AppState>,
    query: String,
    limit: Option<i64>,
) -> Result<Vec<SearchHit>, String> {
    let pool = &state.db;
    let limit = limit.unwrap_or(50);

    // FTS5: query puede tener operadores (+, -, ", *). Sanitizamos comillas.
    let fts_query = query.replace('"', "");

    let rows = sqlx::query(
        r#"
        SELECT 
            COALESCE(session_id, 0) as session_id,
            COALESCE(block_id, 0) as block_id,
            COALESCE(command, '') as command,
            COALESCE(output_text, '') as output_text,
            COALESCE(cwd, '') as cwd,
            CAST(bm25(search_fts) AS REAL) as rank
        FROM search_fts
        WHERE search_fts MATCH ?
        ORDER BY rank
        LIMIT ?
        "#,
    )
    .bind(fts_query)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("search_sessions: {e}"))?;

    let mut hits = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for row in rows {
        let session_id: i64 = row.get("session_id");
        let block_id: i64 = row.get("block_id");
        // Un bloque tiene varias filas FTS (una por chunk de output): conserva
        // la del mejor rank (las filas vienen ordenadas por rank).
        if !seen.insert((session_id, block_id)) {
            continue;
        }
        let command: String = row.get("command");
        let mut snippet: String = row.get("output_text");
        if snippet.len() > 200 {
            snippet.truncate(200);
            snippet.push_str("…");
        }
        hits.push(SearchHit {
            session_id,
            block_id,
            command,
            output_snippet: snippet,
            cwd: row.get("cwd"),
            rank: row.get("rank"),
        });
    }
    Ok(hits)
}

/// Actualiza título de sesión.
#[tauri::command(rename_all = "snake_case")]
pub async fn update_session_title(
    state: State<'_, crate::commands::AppState>,
    session_id: i64,
    title: String,
) -> Result<(), String> {
    let pool = &state.db;
    sqlx::query!("UPDATE sessions SET title = ?, updated_at = datetime('now') WHERE id = ?", title, session_id)
        .execute(pool)
        .await
        .map_err(|e| format!("update_session_title: {e}"))?;
    Ok(())
}

/// Elimina sesión (cascada a blocks/output/fts).
#[tauri::command(rename_all = "snake_case")]
pub async fn delete_session(
    state: State<'_, crate::commands::AppState>,
    session_id: i64,
) -> Result<(), String> {
    let pool = &state.db;
    sqlx::query!("DELETE FROM sessions WHERE id = ?", session_id)
        .execute(pool)
        .await
        .map_err(|e| format!("delete_session: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_hash_es_determinista() {
        assert_eq!(command_hash("ls -la"), command_hash("ls -la"));
        assert_ne!(command_hash("ls"), command_hash("ls -la"));
    }

    #[test]
    fn strip_ansi_quita_csi_y_osc() {
        // CSI (colores/movimiento) y OSC (títulos, osc133) se descartan.
        let input = b"hola \x1b[31mrojo\x1b[0m y \x1b]0;title\x07fin";
        assert_eq!(strip_ansi_for_fts(input), "hola rojo y fin");
    }

    #[test]
    fn strip_ansi_quita_osc_con_terminador_st() {
        // OSC terminado con ST (ESC \), usado por fish para osc133.
        let input = b"a\x1b]133;A\x1b\\b";
        assert_eq!(strip_ansi_for_fts(input), "ab");
    }

    #[test]
    fn strip_ansi_descarta_bell() {
        assert_eq!(strip_ansi_for_fts(b"x\x07y"), "xy");
    }

    #[test]
    fn strip_ansi_normaliza_cr_y_backspace() {
        // Redibujo de readline/fish: CR suelto y \x08 (backspace) al escribir.
        // El resultado no debe contener caracteres de control crudos y debe
        // conservar el texto de la línea final.
        let input = b"l\rs\r\x08ls\r ls\r";
        let out = strip_ansi_for_fts(input);
        assert!(!out.contains('\r') && !out.contains('\x08'));
        assert!(out.contains("ls"));
    }

    #[test]
    fn strip_ansi_colapsa_crlf() {
        // CRLF de salida normal y CR suelto de redibujo → ambos a \n.
        assert_eq!(strip_ansi_for_fts(b"a\r\nb\rc"), "a\nb\nc");
    }

    #[test]
    fn strip_ansi_no_decodifica_utf8_invalido() {
        // Bytes no-UTF8 se convierten con pérdida, nunca panican.
        let input = [0x66, 0xFF, 0xFE, 0x67]; // f <invalido> g
        let out = strip_ansi_for_fts(&input);
        assert!(out.starts_with('f'));
        assert!(out.ends_with('g'));
    }

    #[test]
    fn strip_ansi_trunca_a_2048_caracteres() {
        let input = vec![b'a'; 4000];
        let out = strip_ansi_for_fts(&input);
        assert!(out.chars().count() <= 2049); // 2048 + '…'
        assert!(out.ends_with('…'));
    }
}