//! Configuración mínima de verdant (verdant.jsonc en ~/.config/verdant/).
//!
//! Se carga una vez al arrancar y se fusiona sobre los defaults. El archivo
//! soporta comentarios (jsonc) vía el crate `json5`.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

pub const CONFIG_DIR: &str = ".config/verdant";
pub const CONFIG_FILE: &str = "verdant.jsonc";
pub const DEFAULT_SHELL: &str = "fish";
pub const DEFAULT_SHELL_ARGS: &[&str] = &["-l"];
pub const DEFAULT_TERM: &str = "xterm-256color";
pub const DEFAULT_FONT: &str = "JetBrains Mono";
pub const DEFAULT_FONT_SIZE: u16 = 14;
pub const DEFAULT_SCROLLBACK: u32 = 5000;
pub const DEFAULT_THEME: &str = "ryoku";

/// Atajos por defecto: action -> combinación (formato `Ctrl+Shift+T`).
pub const DEFAULT_KEYBINDS: &[(&str, &str)] = &[
    ("tab-new", "Ctrl+Shift+T"),
    ("tab-close", "Ctrl+Shift+W"),
    ("tab-next", "Ctrl+Tab"),
    ("tab-prev", "Ctrl+Shift+Tab"),
    ("search", "Ctrl+Shift+F"),
    ("copy", "Ctrl+Shift+C"),
    ("paste", "Ctrl+Shift+V"),
    ("split-v", "Ctrl+Shift+E"), // columna a la derecha (estilo kitty)
    ("split-h", "Ctrl+Shift+O"), // fila debajo (estilo kitty)
    ("pane-close", "Ctrl+Shift+Q"),
    ("pane-next", "Ctrl+Shift+J"),
    ("pane-prev", "Ctrl+Shift+K"),
    ("block-prev", "Ctrl+Shift+ArrowUp"),
    ("block-next", "Ctrl+Shift+ArrowDown"),
    ("block-rerun", "Ctrl+Shift+R"),
    ("block-copy", "Ctrl+Shift+Y"),
    ("snippets", "Ctrl+Shift+S"),
    ("sessions", "Ctrl+Shift+P"),
    ("theme-toggle", "Ctrl+Shift+M"),
];

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Config {
    pub shell: String,
    pub shell_args: Vec<String>,
    pub term: String,
    pub font_family: String,
    pub font_size: u16,
    pub scrollback: u32,
    pub cursor_blink: bool,
    /// Tema: "ryoku" (auto, sigue al wallpaper del escritorio) o "base".
    pub theme: String,
    /// Mapa action -> combinación de teclas.
    pub keybinds: HashMap<String, String>,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            shell: DEFAULT_SHELL.to_string(),
            shell_args: DEFAULT_SHELL_ARGS.iter().map(|s| s.to_string()).collect(),
            term: DEFAULT_TERM.to_string(),
            font_family: DEFAULT_FONT.to_string(),
            font_size: DEFAULT_FONT_SIZE,
            scrollback: DEFAULT_SCROLLBACK,
            cursor_blink: true,
            theme: DEFAULT_THEME.to_string(),
            keybinds: DEFAULT_KEYBINDS.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
        }
    }
}

fn config_path() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(CONFIG_DIR)
        .join(CONFIG_FILE)
}

/// Carga la configuración desde disco fusionada con los defaults.
/// Si el archivo no existe o es inválido, se usan los defaults.
pub fn load() -> Config {
    let mut config = Config::default();
    let path = config_path();
    let content = match std::fs::read_to_string(&path) {
        Ok(content) => content,
        Err(_) => {
            write_default(&path);
            eprintln!(
                "[verdant] config no encontrada, creada en {} (defaults)",
                path.display()
            );
            return config;
        }
    };

    match json5::from_str::<Config>(&content) {
        Ok(parsed) => {
            config = merge_with_defaults(parsed);
            eprintln!("[verdant] config cargada desde {}", path.display());
        }
        Err(err) => eprintln!("[verdant] config inválida ({}): {}\n  usando defaults", path.display(), err),
    }
    config
}

/// Fusiona lo parseado con los defaults: los valores del archivo ganan,
/// los vacíos/faltantes caen al default. Los keybinds se combinan uno a uno
/// (el usuario puede redefinir solo algunos atajos).
fn merge_with_defaults(parsed: Config) -> Config {
    let defaults = Config::default();

    let mut keybinds = defaults.keybinds;
    for (action, combo) in parsed.keybinds {
        if !combo.trim().is_empty() {
            keybinds.insert(action, combo);
        }
    }

    Config {
        shell: if parsed.shell.trim().is_empty() { defaults.shell } else { parsed.shell },
        shell_args: if parsed.shell_args.is_empty() { defaults.shell_args } else { parsed.shell_args },
        term: if parsed.term.trim().is_empty() { defaults.term } else { parsed.term },
        font_family: if parsed.font_family.trim().is_empty() { defaults.font_family } else { parsed.font_family },
        font_size: if parsed.font_size == 0 { defaults.font_size } else { parsed.font_size },
        scrollback: if parsed.scrollback == 0 { defaults.scrollback } else { parsed.scrollback },
        cursor_blink: parsed.cursor_blink,
        theme: if parsed.theme.trim().is_empty() { defaults.theme } else { parsed.theme },
        keybinds,
    }
}

fn write_default(path: &PathBuf) {
    let template = r#"{
  // Shell por defecto (fish, zsh, bash...)
  "shell": "fish",
  "shellArgs": ["-l"],
  "term": "xterm-256color",

  // Tipografía
  "fontFamily": "JetBrains Mono",
  "fontSize": 14,

  // Líneas de scrollback en memoria
  "scrollback": 5000,

  "cursorBlink": true,

  // Tema: "ryoku" sigue en vivo al wallpaper del escritorio; "base" usa el tema fijo
  "theme": "ryoku",

  // Atajos de teclado: action = combinación
  "keybinds": {
    "tab-new": "Ctrl+Shift+T",
    "tab-close": "Ctrl+Shift+W",
    "tab-next": "Ctrl+Tab",
    "tab-prev": "Ctrl+Shift+Tab",
    "search": "Ctrl+Shift+F",
    "copy": "Ctrl+Shift+C",
    "paste": "Ctrl+Shift+V",
    "split-v": "Ctrl+Shift+E",
    "split-h": "Ctrl+Shift+O",
    "pane-close": "Ctrl+Shift+Q",
    "pane-next": "Ctrl+Shift+J",
    "pane-prev": "Ctrl+Shift+K",
    "theme-toggle": "Ctrl+Shift+M"
  }
}
"#;
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(path, template);
}

/// Persiste el modo de tema en verdant.jsonc, preservando los comentarios
/// del usuario (edición quirúrgica de la línea `theme`).
pub fn set_theme_mode(mode: &str) -> Result<(), String> {
    let path = config_path();
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("theme: no se pudo leer {}: {e}", path.display()))?;
    set_theme_mode_in_file(&path, &content, mode)
}

/// Reescribe la línea `theme` (formato jsonc: `"theme": "x"` o `theme: 'x'`).
/// Si no existe, la inserta tras la primera llave. No toca el resto del archivo.
fn set_theme_mode_in_file(path: &std::path::Path, content: &str, mode: &str) -> Result<(), String> {
    let mut lines: Vec<String> = content.lines().map(String::from).collect();
    let mut replaced = false;
    for line in lines.iter_mut() {
        let trimmed = line.trim_start();
        // Acepta `"theme": ...` y `theme: ...` (jsonc con/sin comillas).
        let without_quote = trimmed.strip_prefix('"').unwrap_or(trimmed);
        if let Some(rest) = without_quote.strip_prefix("theme") {
            if rest.trim_start_matches('"').trim_start().starts_with(':') {
                *line = format!("  \"theme\": \"{mode}\",");
                replaced = true;
                break;
            }
        }
    }
    if !replaced {
        if let Some(index) = lines.iter().position(|line| line.contains('{')) {
            lines.insert(index + 1, format!("  \"theme\": \"{mode}\","));
        } else {
            return Err("theme: el archivo no tiene objeto raíz".to_string());
        }
    }
    std::fs::write(path, lines.join("\n"))
        .map_err(|e| format!("theme: error al escribir {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_son_coherentes() {
        let config = Config::default();
        assert_eq!(config.shell, "fish");
        assert_eq!(config.font_size, 14);
        assert_eq!(config.scrollback, 5000);
        assert!(config.cursor_blink);
        assert_eq!(config.theme, "ryoku");
        assert_eq!(config.keybinds.get("tab-new").map(String::as_str), Some("Ctrl+Shift+T"));
    }

    #[test]
    fn parsea_jsonc_con_comentarios() {
        let raw = r#"
        // comentario de una línea
        {
          "shell": "zsh",        // shell alternativo
          "fontFamily": "Fira Code",
          "fontSize": 16,        /* comentario bloque */
          "scrollback": 10000,
          "keybinds": { "tab-new": "Ctrl+Alt+N" },
        }
        "#;
        let config: Config = json5::from_str(raw).expect("debe parsear jsonc");
        let config = merge_with_defaults(config);
        assert_eq!(config.shell, "zsh");
        assert_eq!(config.font_family, "Fira Code");
        assert_eq!(config.font_size, 16);
        assert_eq!(config.scrollback, 10000);
        assert_eq!(config.keybinds.get("tab-new").map(String::as_str), Some("Ctrl+Alt+N"));
    }

    #[test]
    fn merge_rellena_faltantes_con_defaults() {
        // Config parcial (como la de un usuario nuevo): sin keybinds ni fuente.
        let raw = r#"{ "shell": "bash", "fontSize": 18 }"#;
        let parsed: Config = json5::from_str(raw).expect("debe parsear jsonc");
        let config = merge_with_defaults(parsed);

        assert_eq!(config.shell, "bash");
        assert_eq!(config.font_size, 18);
        // Faltantes -> defaults
        assert_eq!(config.font_family, DEFAULT_FONT);
        assert_eq!(config.term, DEFAULT_TERM);
        assert_eq!(config.scrollback, DEFAULT_SCROLLBACK);
        // Keybinds ausentes en el archivo -> defaults completos
        assert_eq!(config.keybinds.get("tab-new").map(String::as_str), Some("Ctrl+Shift+T"));
        assert_eq!(config.keybinds.get("search").map(String::as_str), Some("Ctrl+Shift+F"));
        assert_eq!(config.keybinds.len(), DEFAULT_KEYBINDS.len());
    }

    #[test]
    fn merge_combina_keybinds_parciales() {
        let raw = r#"{ "keybinds": { "tab-close": "Ctrl+Shift+X", "tab-new": "" } }"#;
        let parsed: Config = json5::from_str(raw).expect("debe parsear jsonc");
        let config = merge_with_defaults(parsed);

        // Override respetado
        assert_eq!(config.keybinds.get("tab-close").map(String::as_str), Some("Ctrl+Shift+X"));
        // Vacío se descarta -> default
        assert_eq!(config.keybinds.get("tab-new").map(String::as_str), Some("Ctrl+Shift+T"));
        // Los no tocados siguen en defaults
        assert_eq!(config.keybinds.get("search").map(String::as_str), Some("Ctrl+Shift+F"));
    }

    #[test]
    fn set_theme_mode_reescribe_y_preserva_comentarios() {
        let dir = std::env::temp_dir().join(format!("verdant-config-reescribe-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("crear temp");
        let path = dir.join("verdant.jsonc");
        let raw = "// comentario del usuario\n{\n  \"shell\": \"fish\",\n  \"theme\": \"base\",\n  \"fontSize\": 16,\n}\n";
        std::fs::write(&path, raw).expect("escribir");
        let content = std::fs::read_to_string(&path).expect("leer");

        set_theme_mode_in_file(&path, &content, "ryoku").expect("set");

        let out = std::fs::read_to_string(&path).expect("releer");
        assert!(out.contains("\"theme\": \"ryoku\""));
        assert!(out.contains("// comentario del usuario"));
        assert!(out.contains("\"shell\": \"fish\""));
        assert!(!out.contains("\"theme\": \"base\""));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn set_theme_mode_acepta_formato_jsonc_sin_comillas() {
        let dir = std::env::temp_dir().join(format!("verdant-config-jsonc-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("crear temp");
        let path = dir.join("verdant.jsonc");
        let raw = "{ theme: 'base', shell: 'fish' }\n";
        std::fs::write(&path, raw).expect("escribir");
        let content = std::fs::read_to_string(&path).expect("leer");

        set_theme_mode_in_file(&path, &content, "ryoku").expect("set");

        let out = std::fs::read_to_string(&path).expect("releer");
        assert!(out.contains("\"theme\": \"ryoku\""));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn set_theme_mode_inserta_si_no_existe_la_clave() {
        let dir = std::env::temp_dir().join(format!("verdant-config-inserta-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("crear temp");
        let path = dir.join("verdant.jsonc");
        let raw = "{\n  \"shell\": \"fish\",\n}\n";
        std::fs::write(&path, raw).expect("escribir");
        let content = std::fs::read_to_string(&path).expect("leer");

        set_theme_mode_in_file(&path, &content, "ryoku").expect("set");

        let out = std::fs::read_to_string(&path).expect("releer");
        assert!(out.contains("\"theme\": \"ryoku\""));
        assert!(out.contains("\"shell\": \"fish\""));
        let _ = std::fs::remove_dir_all(&dir);
    }
}