//! Session manager for PTY terminals (motor portable-pty de Wezterm).
//!
//! Cada sesión = un PTY con un shell (fish por defecto). Un hilo lector
//! emite eventos `terminal-data` (output como base64) y `terminal-exit`.

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use tauri::{AppHandle, Emitter};

pub const SHELL_CMD: &str = "fish";
pub const SHELL_ARGS: &[&str] = &["-l"];
pub const TERM_ENV: &str = "xterm-256color";
pub const READ_CHUNK: usize = 16384;

#[derive(Clone, Serialize)]
pub struct TerminalData {
    pub id: u32,
    /// Output crudo del PTY en base64 (los bytes pueden no ser UTF-8).
    pub data: String,
}

#[derive(Clone, Serialize)]
pub struct TerminalExit {
    pub id: u32,
    pub exit_code: Option<i32>,
}

pub struct TerminalSession {
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub child: Box<dyn Child + Send>,
}

#[derive(Default)]
pub struct SessionManager {
    pub sessions: HashMap<u32, TerminalSession>,
    next_id: u32,
}

impl SessionManager {
    pub fn new() -> Self {
        SessionManager {
            sessions: HashMap::new(),
            next_id: 1,
        }
    }

    fn next_id(&mut self) -> u32 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }
}

pub fn spawn_session(
    manager: &mut SessionManager,
    app: &AppHandle,
    cols: u16,
    rows: u16,
) -> Result<u32, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|err| err.to_string())?;

    let mut cmd = CommandBuilder::new(SHELL_CMD);
    for arg in SHELL_ARGS {
        cmd.arg(arg);
    }
    cmd.env("TERM", TERM_ENV);
    cmd.env("VERDANT", "1");

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|err| err.to_string())?;
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|err| err.to_string())?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|err| err.to_string())?;

    let id = manager.next_id();
    manager.sessions.insert(
        id,
        TerminalSession {
            master: pair.master,
            writer,
            child,
        },
    );

    let app = app.clone();
    std::thread::spawn(move || loop {
        let mut buf = [0u8; READ_CHUNK];
        match reader.read(&mut buf) {
            Ok(0) => {
                // Fase 3: capturar exit code real vía shared handle.
                let _ = app.emit("terminal-exit", TerminalExit { id, exit_code: None });
                break;
            }
            Ok(n) => {
                let data = B64.encode(&buf[..n]);
                let _ = app.emit("terminal-data", TerminalData { id, data });
            }
            Err(_) => break,
        }
    });

    Ok(id)
}

pub fn write_to_session(
    manager: &mut SessionManager,
    id: u32,
    data: &str,
) -> Result<(), String> {
    let session = manager
        .sessions
        .get_mut(&id)
        .ok_or("session not found")?;
    session
        .writer
        .write_all(data.as_bytes())
        .and_then(|_| session.writer.flush())
        .map_err(|err| err.to_string())
}

pub fn resize_session(manager: &SessionManager, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let session = manager.sessions.get(&id).ok_or("session not found")?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|err| err.to_string())
}

pub fn close_session(manager: &mut SessionManager, id: u32) -> Result<(), String> {
    if let Some(mut session) = manager.sessions.remove(&id) {
        let _ = session.child.kill();
        let _ = session.child.wait();
        // Al dropear el master, el reader del hilo recibe EOF y emite exit.
    }
    Ok(())
}