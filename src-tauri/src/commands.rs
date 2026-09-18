//! Comandos Tauri expuestos al frontend (bridge).

use crate::pty;
use std::sync::Mutex;
use tauri::State;

pub struct AppState {
    pub manager: Mutex<pty::SessionManager>,
}

/// Crea una nueva sesión PTY con el shell por defecto.
#[tauri::command]
pub fn spawn_terminal(
    state: State<AppState>,
    app: tauri::AppHandle,
    cols: u16,
    rows: u16,
) -> Result<u32, String> {
    let mut manager = state
        .manager
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    pty::spawn_session(&mut manager, &app, cols, rows)
}

/// Escribe input del usuario (teclado/pegado) hacia el PTY.
#[tauri::command]
pub fn write_to_pty(state: State<AppState>, id: u32, data: String) -> Result<(), String> {
    let mut manager = state
        .manager
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    pty::write_to_session(&mut manager, id, &data)
}

/// Ajusta el tamaño del PTY al redimensionar la ventana/pane.
#[tauri::command]
pub fn resize_terminal(state: State<AppState>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let manager = state
        .manager
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    pty::resize_session(&manager, id, cols, rows)
}

/// Cierra la sesión y mata el shell.
#[tauri::command]
pub fn close_terminal(state: State<AppState>, id: u32) -> Result<(), String> {
    let mut manager = state
        .manager
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    pty::close_session(&mut manager, id)
}