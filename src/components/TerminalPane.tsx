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
import {
  MAX_OSC133_TAIL,
  parseOsc133,
  type Osc133Marker,
} from "../lib/osc133";
import { BlocksState, adjacentBlockId } from "../lib/blocks";
import { BlockOverlay } from "../lib/blockOverlay";
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
  const blocksRef = useRef<BlocksState | null>(null);
  const overlayRef = useRef<BlockOverlay | null>(null);
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
        // Las decorations (overlay de bloques) viven en API propuesta de xterm.
        allowProposedApi: true,
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
        overlay.setTheme(next);
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
      const blocks = new BlocksState();
      blocksRef.current = blocks;
      const overlay = new BlockOverlay(terminal);
      overlayRef.current = overlay;

      // Pipeline OSC 133: bytes → texto (streaming) → segmentos → escrituras
      // serializadas en xterm (callbacks) → marcadores → modelo de bloques.
      // Los marcadores se procesan SIEMPRE en el punto exacto del stream:
      //  · los que abren un chunk, al arrancar el drain (no hay escrituras en vuelo);
      //  · los intermedios, en el callback de la escritura de texto anterior
      //    (esa posición ya está parseada y la siguiente todavía no).
      const decoder = new TextDecoder("utf-8");
      let oscTail = "";
      let draining = false;
      interface MarkerItem {
        marker: Osc133Marker;
        payload?: string;
      }
      interface StreamStep {
        text: string;
        after: MarkerItem[];
      }
      const steps: StreamStep[] = [];
      let firstMarkers: MarkerItem[] = [];
      let lastStep: StreamStep | null = null;

      const absCursorRow = () => {
        const buffer = terminal.buffer.active;
        return buffer.baseY + buffer.cursorY;
      };

      const handleMarker = (marker: Osc133Marker, payload?: string) => {
        if (disposed) return;
        const row = absCursorRow();
        if (marker === "A") {
          const wasOpen = blocks.current !== null && blocks.current.endRow === null;
          blocks.onMarker(marker, row, payload);
          const opened = blocks.current;
          if (opened) overlay.openBlock(opened);
          if (wasOpen && blocks.blocks.length >= 2) {
            // El bloque anterior quedó finalizado por este A: recalcula su alto.
            overlay.updateBlock(blocks.blocks[blocks.blocks.length - 2]);
          }
          void invoke("debug_log", {
            msg: `[blocks] A row=${row} n=${blocks.blocks.length}`,
          });
        } else {
          blocks.onMarker(marker, row, payload);
          const current = blocks.current;
          if (marker === "C" && current) {
            overlay.updateBlock(current);
            void invoke("debug_log", {
              msg: `[blocks] C row=${row} cmd=${current.command}`,
            });
          }
        }
      };

      const pushText = (text: string) => {
        if (text.length === 0) return;
        const step: StreamStep = { text, after: [] };
        steps.push(step);
        lastStep = step;
      };

      const pushMarker = (marker: Osc133Marker, payload?: string) => {
        const item: MarkerItem = { marker, payload };
        if (lastStep) lastStep.after.push(item);
        else firstMarkers.push(item);
      };

      const finishDrain = () => {
        draining = false;
      };

      const drain = () => {
        if (draining || disposed) return;
        draining = true;
        const run = () => {
          if (disposed) return finishDrain();
          const step = steps.shift();
          if (!step) return finishDrain();
          // Si consumimos el último step, los marcadores de chunks siguientes
          // deben ir a firstMarkers (drain nuevo) y no a un step ya procesado.
          if (step === lastStep) lastStep = null;
          // El callback corre cuando xterm termina de parsear este segmento:
          // ahí sí es segura la posición de los marcadores que lo siguen.
          terminal.write(step.text, () => {
            if (disposed) return finishDrain();
            for (const m of step.after) handleMarker(m.marker, m.payload);
            run();
          });
        };
        for (const m of firstMarkers) handleMarker(m.marker, m.payload);
        firstMarkers = [];
        run();
      };

      const pushChunk = (chunk: string) => {
        const { segments, remaining } = parseOsc133(oscTail + chunk);
        if (remaining.length > MAX_OSC133_TAIL) {
          // Terminador que nunca llegó: degradación, se emite como texto plano.
          pushText(remaining);
          oscTail = "";
        } else {
          oscTail = remaining;
        }
        for (const seg of segments) {
          if (seg.marker) pushMarker(seg.marker, seg.payload);
          else pushText(seg.text);
        }
        if (!draining) drain();
      };

      disposers.push(
        terminal.onData((data) => {
          void invoke("write_to_pty", { id, data });
        }).dispose,
        terminal.onResize((size) => {
          overlay.rebuildAll();
          void invoke("resize_terminal", { id, cols: size.cols, rows: size.rows });
        }).dispose,
      );

      const unData = await listen<TerminalDataEvent>("terminal-data", (event) => {
        if (event.payload.id === id) {
          // UTF-8 rematado (un multibyte puede llegar partido entre chunks).
          pushChunk(decoder.decode(base64ToBytes(event.payload.data), { stream: true }));
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
      overlayRef.current?.dispose();
      overlayRef.current = null;
      term?.dispose();
      termRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
      blocksRef.current = null;
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

  // Handlers de acciones de bloques (tarea 6: navegación, rerun, copy, snippets).
  const blockHandlers = useRef({
    "block-prev": () => {},
    "block-next": () => {},
    "block-rerun": () => {},
    "block-copy": () => {},
    snippets: () => {},
  });
  blockHandlers.current["block-prev"] = () => {
    if (!activeRef.current) return;
    const blocks = blocksRef.current;
    const overlay = overlayRef.current;
    if (!blocks || !overlay) return;
    const current = blocks.current;
    if (!current) return;
    const prevId = adjacentBlockId(blocks.blocks, current.id, -1);
    if (prevId !== null) {
      overlay.select(prevId);
      const prev = blocks.blocks.find((b) => b.id === prevId);
      if (prev) {
        const targetRow = Math.max(0, prev.startRow - 1);
        termRef.current?.scrollToLine(targetRow);
      }
    }
  };
  blockHandlers.current["block-next"] = () => {
    if (!activeRef.current) return;
    const blocks = blocksRef.current;
    const overlay = overlayRef.current;
    if (!blocks || !overlay) return;
    const current = blocks.current;
    if (!current) return;
    const nextId = adjacentBlockId(blocks.blocks, current.id, 1);
    if (nextId !== null) {
      overlay.select(nextId);
      const next = blocks.blocks.find((b) => b.id === nextId);
      if (next) {
        const targetRow = Math.max(0, next.startRow - 1);
        termRef.current?.scrollToLine(targetRow);
      }
    }
  };
  blockHandlers.current["block-rerun"] = () => {
    if (!activeRef.current) return;
    const blocks = blocksRef.current;
    if (!blocks) return;
    const current = blocks.current;
    if (!current || !current.command) return;
    termRef.current?.paste(current.command + "\n");
  };
  blockHandlers.current["block-copy"] = () => {
    if (!activeRef.current) return;
    const blocks = blocksRef.current;
    if (!blocks) return;
    const current = blocks.current;
    if (!current || !current.command) return;
    void writeText(current.command).then(() => {
      void invoke("debug_log", { msg: `[block-copy] command copied` });
    });
  };
  blockHandlers.current.snippets = () => {
    if (!activeRef.current) return;
    // Stub Fase 2 tarea 8: el overlay de snippets se conectará aquí.
    void invoke("debug_log", { msg: "[snippets] action triggered (stub)" });
  };

  useEffect(() => {
    const offPrev = onAction("block-prev", () => blockHandlers.current["block-prev"]());
    const offNext = onAction("block-next", () => blockHandlers.current["block-next"]());
    const offRerun = onAction("block-rerun", () => blockHandlers.current["block-rerun"]());
    const offCopyCmd = onAction("block-copy", () => blockHandlers.current["block-copy"]());
    const offSnip = onAction("snippets", () => blockHandlers.current.snippets());
    return () => {
      offPrev();
      offNext();
      offRerun();
      offCopyCmd();
      offSnip();
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