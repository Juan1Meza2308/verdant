import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { listen } from "@tauri-apps/api/event";
import { onAction } from "../lib/actions";
import { getTheme, subscribeTheme, themeToXterm, type ThemeMode } from "../lib/theme";
import { SnippetOverlay } from "./SnippetOverlay";
import "./SnippetOverlay.css";
import {
  MAX_OSC133_TAIL,
  parseOsc133,
  type Osc133Marker,
} from "../lib/osc133";
import { BlocksState, adjacentBlockId } from "../lib/blocks";
import { BlockOverlay } from "../lib/blockOverlay";
import { getBlockOutput, getSessionDetail } from "../lib/sessions";
import { StartScreen } from "./StartScreen";
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

interface SessionUpdateEvent {
  session_id: number;
  kind: "output" | "block" | "close";
  block_seq: number;
  data?: string;
  start_row?: number;
  end_row?: number;
  command?: string;
  exit_code?: number | null;
}

/**
 * Sesiones que esta instancia está escribiendo en DB. La primera pane que
 * restaura una sesión es writer; las siguientes (misma session_id) pasan a
 * modo lectura y siguen el contenido en vivo por el evento session_update.
 */
const writerSessions = new Set<number>();

export interface VerdantConfig {
  shell: string;
  shellArgs: string[];
  term: string;
  fontFamily: string;
  fontSize: number;
  scrollback: number;
  cursorBlink: boolean;
  /** "ryoku" (auto, sigue al wallpaper) | "base" (tema fijo). */
  theme: ThemeMode;
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

export function TerminalPane({
  active = true,
  sessionId,
  onAttachSession,
}: {
  active?: boolean;
  /** Si se pasa, este pane restaura una sesión persistida (no crea sesión DB). */
  sessionId?: number;
  /** Abre una sesión en tab nueva (lo usa la pantalla de inicio). */
  onAttachSession?: (id: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const blocksRef = useRef<BlocksState | null>(null);
  const overlayRef = useRef<BlockOverlay | null>(null);
  const sessionDbIdRef = useRef<number | null>(null);
  const blockSeqRef = useRef<number>(0);
  const outputBufferRef = useRef<number[]>([]);
  const outputFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** false = pane follower (lectura) en hybrid attach; no escribe en DB. */
  const isWriterRef = useRef(true);
  /** Si esta pane es writer de una sesión restaurada, libera el claim al cerrar. */
  const writerClaimRef = useRef<number | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const [searching, setSearching] = useState(false);
  const [showSnippets, setShowSnippets] = useState(false);
  /** Home (pantalla de inicio) visible: solo panes nuevas sin sesión restaurada. */
  const [showHome, setShowHome] = useState(false);
  const showHomeRef = useRef(false);
  const homeRef = useRef<HTMLDivElement>(null);
  /** Cierre programático (primer bloque escrito, keydown, click "abrir terminal"). */
  const dismissHomeRef = useRef<() => void>(() => {});

  const dismissHome = useCallback(() => {
    if (!showHomeRef.current) return;
    showHomeRef.current = false;
    setShowHome(false);
    termRef.current?.focus();
  }, []);
  dismissHomeRef.current = dismissHome;

  /** Handler estable para que StartScreen (memo) no re-renderice con cada render. */
  const handleAttachSession = useCallback(
    (id: number) => onAttachSession?.(id),
    [onAttachSession],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const disposers: Array<() => void> = [];
    let ptyId: number | null = null;
    let disposed = false;
    let term: Terminal | null = null;
    const restoreSession = sessionId;

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

      const blocks = new BlocksState();
      blocksRef.current = blocks;
      const overlay = new BlockOverlay(terminal);
      overlayRef.current = overlay;

      // Hybrid attach: la PRIMERA pane que restaura una sesión es writer;
      // las siguientes (misma session_id) son lectura y siguen por session_update.
      const isFollower = restoreSession !== undefined && writerSessions.has(restoreSession);
      isWriterRef.current = !isFollower;

      // Modo restore: reanudar el historial ANTES de spawnear, para que el
      // prompt nuevo aparezca debajo del contenido restaurado (sin intercalar).
      if (restoreSession !== undefined) {
        sessionDbIdRef.current = restoreSession;
        let maxSeq = 0;
        try {
          const detail = await getSessionDetail(restoreSession);
          if (detail) {
            blocks.restore(
              detail.blocks.map((b) => ({
                id: b.seq,
                startRow: b.start_row,
                endRow: b.end_row,
                command: b.command,
              })),
            );
            for (const b of detail.blocks) {
              maxSeq = Math.max(maxSeq, b.seq);
              const bytes = await getBlockOutput(restoreSession, b.seq);
              if (disposed || !bytes || bytes.length === 0) continue;
              // Al terminar de escribir el bloque el cursor está en su última
              // fila: la decoración se ancla al prompt histórico restando el
              // alto del bloque a la posición actual.
              await new Promise<void>((resolve) => {
                if (disposed) return resolve();
                terminal.write(bytes, () => resolve());
              });
              if (disposed) return;
              const height = Math.max(1, (b.end_row ?? b.start_row) - b.start_row + 1);
              overlay.openBlock(
                { id: b.seq, startRow: b.start_row, endRow: b.end_row, command: b.command },
                height - 1,
              );
            }
          }
        } catch (error) {
          void invoke("debug_log", { msg: `[restore] fallo ${String(error)}` });
        }
        blockSeqRef.current = maxSeq;
      }

      if (isFollower) {
        // Vista en vivo: sin PTY propio; los cambios llegan por session_update
        // (handleMarker y el flush de output están bloqueados por isWriterRef).
        terminal.write(
          `\r\n\x1b[90m[verdant] sesión #${restoreSession} — modo lectura (attach)\x1b[0m\r\n`,
        );
      } else {
        if (restoreSession !== undefined) {
          writerSessions.add(restoreSession);
          writerClaimRef.current = restoreSession;
        }
        const id = await invoke<number>("spawn_terminal", {
          cols: terminal.cols,
          rows: terminal.rows,
        });
        if (disposed) {
          void invoke("close_terminal", { id });
          return;
        }
        ptyId = id;

        if (restoreSession === undefined) {
          // Crear sesión persistente en DB (Fase 3)
          const cwd = await invoke<string>("get_cwd").catch(() => "~");
          try {
            const sessionDbId = await invoke<number>("create_session", {
              payload: {
                cols: terminal.cols,
                rows: terminal.rows,
                cwd,
                shell: config.shell,
              },
            });
            sessionDbIdRef.current = sessionDbId;
            blockSeqRef.current = 0;
            // Claim de writer: mientras este pane viva, un restore posterior de
            // la misma sesión será follower (adjunto en vivo), no otro writer.
            writerSessions.add(sessionDbId);
            writerClaimRef.current = sessionDbId;
            void invoke("debug_log", { msg: `[session] created id=${sessionDbId}` });
          } catch (error) {
            void invoke("debug_log", { msg: `[session] create FAIL ${String(error)}` });
            throw error;
          }
        }
      }

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
          // Fase 3: insertar bloque en DB (comando aún vacío; se completa en C).
          // El row debe existir antes de su output para poder adjuntar chunks.
          const dbId = sessionDbIdRef.current;
          if (isWriterRef.current && dbId !== null) {
            blockSeqRef.current += 1;
            const seq = blockSeqRef.current;
            void invoke("append_block", {
              session_id: dbId,
              seq,
              start_row: row,
              end_row: null,
              command: "",
            });
          }
          void invoke("debug_log", {
            msg: `[blocks] A row=${row} n=${blocks.blocks.length}`,
          });
        } else {
          blocks.onMarker(marker, row, payload);
          const current = blocks.current;
          if (marker === "C" && current) {
            // Primer comando ejecutado: la home ya no tiene sentido (el usuario
            // está escribiendo en el shell). Se descarta de forma permanente.
            dismissHomeRef.current();
            overlay.updateBlock(current);
            // Fase 3: completar command + end_row del bloque abierto.
            const dbId = sessionDbIdRef.current;
            if (isWriterRef.current && dbId !== null) {
              const seq = blockSeqRef.current;
              void invoke("update_block", {
                session_id: dbId,
                seq,
                command: current.command,
                end_row: row,
              });
            }
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
          if (ptyId === null) return; // follower: lectura, sin PTY propio
          void invoke("write_to_pty", { id: ptyId, data });
        }).dispose,
        terminal.onResize((size) => {
          overlay.rebuildAll();
          if (ptyId === null) return;
          void invoke("resize_terminal", { id: ptyId, cols: size.cols, rows: size.rows });
        }).dispose,
      );

      const unData = await listen<TerminalDataEvent>("terminal-data", (event) => {
        if (ptyId !== null && event.payload.id === ptyId) {
          // UTF-8 rematado (un multibyte puede llegar partido entre chunks).
          const text = decoder.decode(base64ToBytes(event.payload.data), { stream: true });
          pushChunk(text);

          // Fase 3: persistir output en DB (throttle 200ms)
          const dbId = sessionDbIdRef.current;
          if (isWriterRef.current && dbId !== null && blockSeqRef.current > 0) {
            const data = base64ToBytes(event.payload.data);
            outputBufferRef.current.push(...data);
            if (!outputFlushTimerRef.current) {
              outputFlushTimerRef.current = window.setTimeout(() => {
                const buffered = outputBufferRef.current;
                outputBufferRef.current = [];
                outputFlushTimerRef.current = null;
                if (buffered.length > 0) {
                  void invoke("append_output", {
                    session_id: dbId,
                    block_seq: blockSeqRef.current,
                    data: Array.from(buffered),
                  });
                }
              }, 200);
            }
          }
        }
      });
      const unExit = await listen<TerminalExitEvent>("terminal-exit", (event) => {
        if (ptyId !== null && event.payload.id === ptyId) {
          terminal.write(
            `\r\n\x1b[90m[verdant] proceso terminado (código ${event.payload.exit_code ?? "?"})\x1b[0m\r\n`,
          );
          // Fase 3: cerrar sesión en DB (solo el writer; los followers ya ven
          // el cierre por session_update).
          const dbId = sessionDbIdRef.current;
          if (isWriterRef.current && dbId !== null) {
            // Flush any pending output
            if (outputBufferRef.current.length > 0) {
              const buffered = [...outputBufferRef.current];
              outputBufferRef.current = [];
              if (outputFlushTimerRef.current) {
                clearTimeout(outputFlushTimerRef.current);
                outputFlushTimerRef.current = null;
              }
              if (blockSeqRef.current > 0) {
                void invoke("append_output", {
                  session_id: dbId,
                  block_seq: blockSeqRef.current,
                  data: Array.from(buffered),
                });
              }
            }
            void invoke("close_session", {
              session_id: dbId,
              exit_code: event.payload.exit_code,
            });
          }
        }
      });
      disposers.push(unData, unExit);

      // Hybrid attach: los followers aplican en vivo los cambios del writer.
      // (Las escrituras del writer no pasan por aquí: isWriterRef filtra.)
      const unSessionUpdate = await listen<SessionUpdateEvent>("session_update", (event) => {
        const dbId = sessionDbIdRef.current;
        if (dbId === null || dbId !== event.payload.session_id) return;
        if (isWriterRef.current) return;
        if (event.payload.kind === "output" && event.payload.data) {
          // Mismo pipeline que el stream vivo: el texto incluye los marcadores
          // OSC 133, así que modelo y decorations se actualizan solos.
          const text = decoder.decode(base64ToBytes(event.payload.data), { stream: true });
          pushChunk(text);
        } else if (event.payload.kind === "close") {
          decoder.decode(); // descartar bytes UTF-8 pendientes
          terminal.write(
            `\r\n\x1b[90m[verdant] sesión cerrada (código ${event.payload.exit_code ?? "?"})\x1b[0m\r\n`,
          );
        }
      });
      disposers.push(unSessionUpdate);

      if (restoreSession === undefined) {
        // Pane nueva: la home se muestra sobre el shell vivo; cualquier tecla
        // la descarta y devuelve el foco al terminal.
        showHomeRef.current = true;
        setShowHome(true);
        requestAnimationFrame(() => homeRef.current?.focus());
      } else {
        terminal.focus();
      }
    };

    void start().catch((error) => {
      void invoke("debug_log", { msg: `[start] ERROR ${String(error)}` });
    });

    return () => {
      disposed = true;
      disposers.forEach((dispose) => dispose());
      // Liberar el claim de writer para que otra pane pueda tomar el rol.
      if (writerClaimRef.current !== null) {
        writerSessions.delete(writerClaimRef.current);
        writerClaimRef.current = null;
      }
      if (outputFlushTimerRef.current) {
        clearTimeout(outputFlushTimerRef.current);
        outputFlushTimerRef.current = null;
      }
      if (ptyId !== null) {
        void invoke("close_terminal", { id: ptyId });
      }
      overlayRef.current?.dispose();
      overlayRef.current = null;
      term?.dispose();
      termRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
      blocksRef.current = null;
      sessionDbIdRef.current = null;
      blockSeqRef.current = 0;
      outputBufferRef.current = [];
      outputFlushTimerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    // El fit necesita un frame para que el contenedor tenga su tamaño final
    // (al re-activar una tab que estaba oculta).
    raf = requestAnimationFrame(() => {
      fitRef.current?.fit();
      if (showHomeRef.current) {
        homeRef.current?.focus();
      } else {
        termRef.current?.focus();
      }
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
    setShowSnippets(true);
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
      {showHome && (
        <StartScreen
          onAttach={handleAttachSession}
          onOpenShell={dismissHome}
        />
      )}
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
      {showSnippets && (
        <SnippetOverlay
          onClose={() => setShowSnippets(false)}
          paste={(text) => termRef.current?.paste(text)}
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