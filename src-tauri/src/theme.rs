//! Tema dinámico desde ryoku: lee la paleta Material You que matugen publica
//! en ~/.cache/ryoku/colors.json (regenerada por `ryogami wallpaper repaint`)
//! y la expone al frontend, además de vigilar el archivo para live-reload.
//!
//! verdant solo LEE la paleta; ryogami/matugen siguen siendo los únicos
//! autores del color del escritorio.

use serde::Serialize;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub const RYOKU_COLORS_FILE: &str = ".cache/ryoku/colors.json";
/// Intervalo de polling del watcher (el archivo se regenera al repintar).
pub const RYOKU_POLL_INTERVAL_MS: u64 = 2000;

/// Subconjunto de la paleta Material You que verdant consume.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RyokuPalette {
    pub background: String,
    pub on_surface: String,
    pub on_surface_variant: String,
    pub primary: String,
    pub error: String,
    pub scrim: String,
    pub cursor: String,
    pub ansi: [String; 16],
}

pub fn ryoku_colors_path() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(RYOKU_COLORS_FILE)
}

/// Parsea la paleta desde el JSON de matugen. Si falta cualquier clave
/// imprescindible devuelve None (el frontend degrada a baseTheme).
pub fn parse_palette(bytes: &[u8]) -> Option<RyokuPalette> {
    let value: serde_json::Value = serde_json::from_slice(bytes).ok()?;
    let get = |key: &str| -> Option<String> { Some(value.get(key)?.as_str()?.to_string()) };

    let background = get("background")?;
    let on_surface = get("onSurface")?;
    let on_surface_variant = get("onSurfaceVariant")?;
    let primary = get("primary")?;
    let error = get("error")?;
    let scrim = get("scrim")?;
    let cursor = get("cursor")?;

    let mut ansi = Vec::with_capacity(16);
    for i in 0..16 {
        ansi.push(get(&format!("color{i}"))?);
    }
    let ansi: [String; 16] = ansi.try_into().expect("16 colores ANSI");

    Some(RyokuPalette {
        background,
        on_surface,
        on_surface_variant,
        primary,
        error,
        scrim,
        cursor,
        ansi,
    })
}

pub fn read_palette() -> Option<RyokuPalette> {
    let bytes = std::fs::read(ryoku_colors_path()).ok()?;
    parse_palette(&bytes)
}

/// Paleta actual de ryoku (None si no existe/falla → fallback a baseTheme).
#[tauri::command]
pub fn get_ryoku_theme() -> Option<RyokuPalette> {
    read_palette()
}

/// Vigila colors.json y emite `ryoku:palette` cuando cambia (live-reload).
pub fn spawn_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut last_modified = std::time::SystemTime::UNIX_EPOCH;
        loop {
            tokio::time::sleep(Duration::from_millis(RYOKU_POLL_INTERVAL_MS)).await;
            let modified = std::fs::metadata(ryoku_colors_path())
                .and_then(|m| m.modified())
                .ok();
            if let Some(modified) = modified {
                if modified != last_modified {
                    last_modified = modified;
                    if let Some(palette) = read_palette() {
                        let _ = app.emit("ryoku:palette", &palette);
                    }
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw_palette_json() -> String {
        let mut json = String::from(
            r##"{"background":"#000000","onSurface":"#eeeeee","onSurfaceVariant":"#aaaaaa","primary":"#ff5541","error":"#ffb4ab","scrim":"#000000","cursor":"#ffdad4""##,
        );
        for i in 0..16 {
            json.push_str(&format!(",\"color{i}\":\"#00{i:02x}{i:02x}\""));
        }
        json.push('}');
        json
    }

    #[test]
    fn parse_palette_mapa_claves_y_ansi() {
        // La paleta incompleta (falta color0) -> None: contrato de paleta
        // completa o fallback a baseTheme.
        let incomplete = raw_palette_json().replace(",\"color0\":\"#000000\"", "");
        assert!(parse_palette(incomplete.as_bytes()).is_none());

        let palette = parse_palette(raw_palette_json().as_bytes()).expect("paleta válida");
        assert_eq!(palette.background, "#000000");
        assert_eq!(palette.on_surface, "#eeeeee");
        assert_eq!(palette.on_surface_variant, "#aaaaaa");
        assert_eq!(palette.primary, "#ff5541");
        assert_eq!(palette.error, "#ffb4ab");
        assert_eq!(palette.cursor, "#ffdad4");
        assert_eq!(palette.ansi[0], "#000000");
        assert_eq!(palette.ansi[15], "#000f0f"); // color15 genera #00{i:02x}{i:02x}
        assert_eq!(palette.ansi.len(), 16);
    }

    #[test]
    fn parse_palette_rechaza_json_invalido() {
        assert!(parse_palette(b"no es json").is_none());
        assert!(parse_palette(b"{}").is_none());
        // JSON válido pero sin las claves imprescindibles -> None.
        assert!(parse_palette(b"{\"background\":\"#000000\"}").is_none());
    }
}