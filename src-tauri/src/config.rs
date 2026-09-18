//! Configuración mínima de verdant (verdant.jsonc en ~/.config/verdant/).
//!
//! Se carga una vez al arrancar y se fusiona sobre los defaults. El archivo
//! soporta comentarios (jsonc) vía el crate `json5`.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub const CONFIG_DIR: &str = ".config/verdant";
pub const CONFIG_FILE: &str = "verdant.jsonc";
pub const DEFAULT_SHELL: &str = "fish";
pub const DEFAULT_SHELL_ARGS: &[&str] = &["-l"];
pub const DEFAULT_TERM: &str = "xterm-256color";
pub const DEFAULT_FONT: &str = "JetBrains Mono";
pub const DEFAULT_FONT_SIZE: u16 = 14;
pub const DEFAULT_SCROLLBACK: u32 = 5000;

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
            config = parsed;
            eprintln!("[verdant] config cargada desde {}", path.display());
        }
        Err(err) => eprintln!("[verdant] config inválida ({}): {}", path.display(), err),
    }
    config
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

  "cursorBlink": true
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
        }
        "#;
        let config: Config = json5::from_str(raw).expect("debe parsear jsonc");
        assert_eq!(config.shell, "zsh");
        assert_eq!(config.font_family, "Fira Code");
        assert_eq!(config.font_size, 16);
        assert_eq!(config.scrollback, 10000);
    }
}