import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";
import "./TerminalPane.css";

const FALLBACK_FONT = '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace';

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
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

export function TerminalPane() {
  const containerRef = useRef<HTMLDivElement>(null);

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
      });
      if (disposed) {
        terminal.dispose();
        return;
      }
      term = terminal;

      const fit = new FitAddon();
      const search = new SearchAddon();
      const webLinks = new WebLinksAddon();
      terminal.loadAddon(fit);
      terminal.loadAddon(search);
      terminal.loadAddon(webLinks);
      terminal.open(container);

      const resizeObserver = new ResizeObserver(() => fit.fit());
      resizeObserver.observe(container);

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
    };
  }, []);

  return <div ref={containerRef} className="terminal-pane" />;
}