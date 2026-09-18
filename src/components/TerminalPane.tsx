import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { listen } from "@tauri-apps/api/event";
import { onAction } from "../lib/actions";
import { getTheme, subscribeTheme, themeToXterm } from "../lib/theme";
import "@xterm/xterm/css/xterm.css";
import "./TerminalPane.css";

const FALLBACK_FONT = '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace';

function searchDecorations() {
  const theme = getTheme();
  return {
    matchBackground: theme.ansi[8],
    matchOverviewRuler: theme.ansi[8],
    activeMatchBackground: theme.accent,
    activeMatchColorOverviewRuler: theme.accent,
  };
}

interface TerminalDataEvent {
  id: number;
  data: string;
}

interface TerminalExitEvent {
  id: number;
  exit_code: number | null;
}

export interface VerdantConfig {
  shell: string;
  shellArgs: string[];
  term: string;
  fontFamily: string;
  fontSize: number;
  scrollback: number;
  cursorBlink: boolean;
  keybinds: Record<string, string>;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

export function TerminalPane({ active = true }: { active?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const disposers: Array<() => void> = [];
    let sessionId: number | null = null;
    let disposed = false;
    let term: Terminal | null = null;

    const start = async () => {
      const config: VerdantConfig = await invoke("get_config");

      const terminal = new Terminal({
        cursorBlink: config.cursorBlink,
        cursorStyle: "block",
        fontSize: config.fontSize,
        fontFamily: `${config.fontFamily}, ${FALLBACK_FONT}`,
        scrollback: config.scrollback,
        theme: themeToXterm(getTheme()),
      });
      if (disposed) {
        terminal.dispose();
        return;
      }
      term = terminal;
      termRef.current = terminal;

      const fit = new FitAddon();
      const search = new SearchAddon();
      const webLinks = new WebLinksAddon();
      terminal.loadAddon(fit);
      terminal.loadAddon(search);
      terminal.loadAddon(webLinks);
      terminal.open(container);
      fitRef.current = fit;
      searchRef.current = search;

      const resizeObserver = new ResizeObserver(() => fit.fit());
      resizeObserver.observe(container);

      // Live-reload del tema (Fase 4: generado desde Ryoku/wallpaper).
      const offTheme = subscribeTheme((next) => {
        terminal.options.theme = themeToXterm(next);
      });
      disposers.push(offTheme);

      const id = await invoke<number>("spawn_terminal", {
        cols: terminal.cols,
        rows: terminal.rows,
      });
      if (disposed) {
        void invoke("close_terminal", { id });
        return;
      }
      sessionId = id;

      disposers.push(
        terminal.onData((data) => {
          void invoke("write_to_pty", { id, data });
        }).dispose,
        terminal.onResize((size) => {
          void invoke("resize_terminal", { id, cols: size.cols, rows: size.rows });
        }).dispose,
      );

      const unData = await listen<TerminalDataEvent>("terminal-data", (event) => {
        if (event.payload.id === id) {
          terminal.write(base64ToBytes(event.payload.data));
        }
      });
      const unExit = await listen<TerminalExitEvent>("terminal-exit", (event) => {
        if (event.payload.id === id) {
          terminal.write(
            `\r\n\x1b[90m[verdant] proceso terminado (código ${event.payload.exit_code ?? "?"})\x1b[0m\r\n`,
          );
        }
      });
      disposers.push(unData, unExit);

      terminal.focus();
    };

    void start();

    return () => {
      disposed = true;
      disposers.forEach((dispose) => dispose());
      if (sessionId !== null) {
        void invoke("close_terminal", { id: sessionId });
      }
      term?.dispose();
      termRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    // El fit necesita un frame para que el contenedor tenga su tamaño final
    // (al re-activar una tab que estaba oculta).
    raf = requestAnimationFrame(() => {
      fitRef.current?.fit();
      termRef.current?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [active]);

  const openSearch = useCallback(() => {
    setSearching(true);
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }, []);

  useEffect(() => onAction("search", openSearch), [openSearch]);

  const closeSearch = useCallback(() => {
    setSearching(false);
    searchRef.current?.clearDecorations();
    termRef.current?.focus();
  }, []);

  // Copiar/pegar: solo actúa en el pane activo (los ocultos ignoran la acción).
  // Los handlers viven en un ref que se refresca en cada render: la suscripción
  // al bus se registra UNA vez y siempre ejecuta la versión más reciente
  // (a prueba de stale closures y de HMR).
  const copyPasteHandlers = useRef({ copy: () => {}, paste: () => {} });
  copyPasteHandlers.current.copy = () => {
    if (!activeRef.current) return;
    const selection = termRef.current?.getSelection();
    if (selection && selection.length > 0) {
      void writeText(selection);
      termRef.current?.clearSelection();
    }
  };
  copyPasteHandlers.current.paste = () => {
    if (!activeRef.current) return;
    void readText()
      .then((text) => {
        const terminal = termRef.current;
        if (text && terminal) {
          // term.paste respeta bracketed paste mode automáticamente.
          terminal.paste(text);
        }
        void invoke("debug_log", {
          msg: `[paste] len=${text?.length ?? -1} hasTerm=${Boolean(terminal)}`,
        });
      })
      .catch((error) => {
        void invoke("debug_log", { msg: `[paste] ERROR ${String(error)}` });
      });
  };
  useEffect(() => {
    const offCopy = onAction("copy", () => copyPasteHandlers.current.copy());
    const offPaste = onAction("paste", () => copyPasteHandlers.current.paste());
    return () => {
      offCopy();
      offPaste();
    };
  }, []);

  return (
    <div className="terminal-pane">
      <div ref={containerRef} className="terminal-host" />
      {searching && (
        <SearchOverlay
          inputRef={searchInputRef}
          onQuery={(query, forward) => {
            const addon = searchRef.current;
            if (!addon) return;
            addon.clearDecorations();
            if (query.length > 0) {
              addon.findNext(query, { decorations: searchDecorations() });
            }
            if (!forward) {
              addon.findPrevious(query, { decorations: searchDecorations() });
            }
          }}
          onClose={closeSearch}
        />
      )}
    </div>
  );
}

function SearchOverlay({
  inputRef,
  onQuery,
  onClose,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onQuery: (query: string, forward: boolean) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");

  const run = (forward: boolean) => onQuery(query, forward);

  return (
    <div className="search-overlay" role="search">
      <input
        ref={inputRef}
        className="search-input"
        value={query}
        placeholder="Buscar en la salida…"
        onChange={(event) => {
          const next = event.currentTarget.value;
          setQuery(next);
          onQuery(next, true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            run(!event.shiftKey);
          } else if (event.key === "Escape") {
            onClose();
          }
        }}
      />
      <button type="button" className="search-btn" onClick={() => run(true)} title="Siguiente (Enter)">
        ↓
      </button>
      <button type="button" className="search-btn" onClick={() => run(false)} title="Anterior (Shift+Enter)">
        ↑
      </button>
      <button type="button" className="search-btn search-close" onClick={onClose} title="Cerrar (Escape)">
        ×
      </button>
    </div>
  );
}