//! Capa de base de datos: pool sqlx + migraciones embebidas.

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Pool, Sqlite};
use std::path::PathBuf;
use std::str::FromStr;

/// Ruta por defecto de la DB: ~/.local/share/verdant/sessions.db
pub fn db_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("verdant")
        .join("sessions.db")
}

/// Crea el pool de conexiones (WAL + busy_timeout).
pub async fn create_pool(path: Option<PathBuf>) -> anyhow::Result<Pool<Sqlite>> {
    let path = path.unwrap_or_else(db_path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let options = SqliteConnectOptions::from_str(&format!("sqlite://{}", path.display()))?
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .busy_timeout(std::time::Duration::from_secs(5))
        .pragma("foreign_keys", "ON")
        .pragma("synchronous", "NORMAL");

    SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(options)
        .await
        .map_err(|e| anyhow::anyhow!(e))
}

/// Migraciones embebidas (compiladas en el binario via sqlx::migrate!).
/// En dev: `sqlx migrate run` contra DATABASE_URL.
/// En release: migraciones aplicadas automáticamente al crear pool.
pub async fn run_migrations(pool: &Pool<Sqlite>) -> anyhow::Result<()> {
    sqlx::migrate!("./migrations")
        .run(pool)
        .await
        .map_err(|e| anyhow::anyhow!(e))?;
    Ok(())
}

/// Helper para ejecutar migraciones manualmente (útil en tests/dev).
#[cfg(test)]
pub async fn test_pool() -> anyhow::Result<Pool<Sqlite>> {
    let pool = create_pool(Some(PathBuf::from(":memory:"))).await?;
    run_migrations(&pool).await?;
    Ok(pool)
}