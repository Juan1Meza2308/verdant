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
    "pane-prev": "Ctrl+Shift+K"
  }
}
"#;
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(path, template);
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
}