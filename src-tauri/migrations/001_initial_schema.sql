-- 001_initial_schema.sql
-- Esquema inicial para sessions persistentes + búsqueda FTS5
-- PRAGMAs se configuran en db.rs via connection options (no en transacción)

-- Tabla de sesiones
CREATE TABLE sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    cwd TEXT NOT NULL,
    shell TEXT NOT NULL,
    cols INTEGER NOT NULL DEFAULT 80,
    rows INTEGER NOT NULL DEFAULT 24,
    exit_code INTEGER,
    title TEXT,
    -- Metadatos opcionales para restore
    env_json TEXT,          -- JSON con variables de entorno relevantes
    scrollback_limit INTEGER DEFAULT 5000
);

-- Índices para listado paginado ordenado por updated_at
CREATE INDEX idx_sessions_updated_at ON sessions(updated_at DESC);
CREATE INDEX idx_sessions_created_at ON sessions(created_at DESC);

-- Tabla de bloques (uno por comando ejecutado)
CREATE TABLE blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,                    -- ordinal dentro de la sesión (1, 2, 3...)
    start_row INTEGER NOT NULL,
    end_row INTEGER,                         -- NULL = bloque abierto (comando en ejecución)
    command TEXT NOT NULL,
    command_hash TEXT NOT NULL,              -- hash del comando (para dedup futuro)
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(session_id, seq)
);

CREATE INDEX idx_blocks_session_seq ON blocks(session_id, seq);
CREATE INDEX idx_blocks_command_hash ON blocks(command_hash);

-- Tabla de output por bloque (append-only, chunks de bytes)
CREATE TABLE block_output (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    block_id INTEGER NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,                    -- orden de chunks dentro del bloque
    data BLOB NOT NULL,                      -- bytes crudos (incluye ANSI, OSC, etc.)
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_block_output_block_seq ON block_output(block_id, seq);

-- Tabla FTS5 para búsqueda full-text
-- Contenido: command + output_text (strip ANSI) + cwd + tags
-- Se popula desde Rust al insertar block_output (ver sessions.rs)
CREATE VIRTUAL TABLE search_fts USING fts5(
    session_id UNINDEXED,
    block_id UNINDEXED,
    command,
    output_text,
    cwd,
    tags,
    tokenize = 'porter unicode61'
);

-- Trigger para actualizar updated_at de la sesión al insertar block/output
CREATE TRIGGER session_updated_at_block AFTER INSERT ON blocks BEGIN
    UPDATE sessions SET updated_at = datetime('now') WHERE id = NEW.session_id;
END;

CREATE TRIGGER session_updated_at_output AFTER INSERT ON block_output BEGIN
    UPDATE sessions SET updated_at = datetime('now')
    WHERE id = (SELECT session_id FROM blocks WHERE id = NEW.block_id);
END;