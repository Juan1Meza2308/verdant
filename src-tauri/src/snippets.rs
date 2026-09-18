//! Backend de snippets: lee ~/.config/verdant/snippets.jsonc (json5),
//! crea default si falta, valida estructura y expone comando Tauri.

use crate::config::CONFIG_DIR;
use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snippet {
    pub trigger: String,
    pub description: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnippetsFile {
    pub snippets: Vec<Snippet>,
}

fn snippets_path() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(CONFIG_DIR)
        .join("snippets.jsonc")
}

/// Default de snippets (mismo archivo que crea la app al primer uso).
fn default_snippets() -> SnippetsFile {
    SnippetsFile {
        snippets: vec![
            Snippet {
                trigger: "date".into(),
                description: "Fecha ISO actual".into(),
                body: "{{date}}".into(),
            },
            Snippet {
                trigger: "cwd".into(),
                description: "Directorio de trabajo actual".into(),
                body: "{{cwd}}".into(),
            },
        ],
    }
}

/// Comando Tauri: devuelve la lista de snippets (crea default si no existe).
#[tauri::command]
pub fn get_snippets() -> Result<Vec<Snippet>, String> {
    let path = snippets_path();

    if !path.exists() {
        // Crea directorio y archivo default atómicamente.
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("mkdir snippets: {e}"))?;
        }
        let default = default_snippets();
        let json5 = serde_json::to_string_pretty(&default)
            .map_err(|e| format!("serialize default snippets: {e}"))?;
        fs::write(&path, json5).map_err(|e| format!("write default snippets: {e}"))?;
        return Ok(default.snippets);
    }

    let content = fs::read_to_string(&path).map_err(|e| format!("read snippets: {e}"))?;
    let file: SnippetsFile = json5::from_str(&content)
        .map_err(|e| format!("parse snippets.jsonc: {e} (en {})", path.display()))?;

    // Validación ligera: trigger no vacío.
    for s in &file.snippets {
        if s.trigger.trim().is_empty() {
            return Err("snippet trigger vacío".into());
        }
    }
    Ok(file.snippets)
}

/// Comando Tauri: devuelve el directorio de trabajo actual del proceso.
#[tauri::command]
pub fn get_cwd() -> Result<String, String> {
    env::current_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| format!("get cwd: {e}"))
}