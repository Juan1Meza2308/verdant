mod commands;
mod config;
mod db;
mod pty;
mod snippets;

use commands::AppState;
use db::create_pool;
use std::sync::{Arc, Mutex};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_config = Arc::new(config::load());

    // Pool DB + migraciones (bloqueante al arranque; DB pequeña).
    let pool = tauri::async_runtime::block_on(async {
        let pool = create_pool(None).await.expect("DB pool");
        db::run_migrations(&pool).await.expect("DB migrations");
        pool
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(AppState {
            manager: Mutex::new(pty::SessionManager::new()),
            config: app_config,
            db: pool,
        })
        .invoke_handler(tauri::generate_handler![
            commands::spawn_terminal,
            commands::write_to_pty,
            commands::resize_terminal,
            commands::close_terminal,
            commands::get_config,
            commands::debug_log,
            snippets::get_snippets,
            snippets::get_cwd
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}