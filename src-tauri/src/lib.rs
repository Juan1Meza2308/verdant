mod commands;
mod config;
mod pty;
mod snippets;

use commands::AppState;
use std::sync::{Arc, Mutex};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_config = Arc::new(config::load());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(AppState {
            manager: Mutex::new(pty::SessionManager::new()),
            config: app_config,
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