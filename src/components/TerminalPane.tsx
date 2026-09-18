import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";
import "./TerminalPane.css";

const SCROLLBACK = 5000;
const FONT_FAMILY = '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace';
const FONT_SIZE = 14;

interface TerminalDataEvent {
  id: number;
  data: string;
}

interface TerminalExitEvent {
  id: number;
  exit_code: number | null;
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

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "block",
      fontSize: FONT_SIZE,
      fontFamily: FONT_FAMILY,
      scrollback: SCROLLBACK,
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    const webLinks = new WebLinksAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(webLinks);
    term.open(container);

    const resizeObserver = new ResizeObserver(() => fit.fit());
    resizeObserver.observe(container);

    const disposers: Array<() => void> = [];
    let sessionId: number | null = null;
    let disposed = false;

    const start = async () => {
      fit.fit();
      const id = await invoke<number>("spawn_terminal", { cols: term.cols, rows: term.rows });
      if (disposed) {
        void invoke("close_terminal", { id });
        return;
      }
      sessionId = id;

      disposers.push(
        term.onData((data) => {
          void invoke("write_to_pty", { id, data });
        }).dispose,
        term.onResize((size) => {
          void invoke("resize_terminal", { id, cols: size.cols, rows: size.rows });
        }).dispose,
      );

      const unData = await listen<TerminalDataEvent>("terminal-data", (event) => {
        if (event.payload.id === id) {
          term.write(base64ToBytes(event.payload.data));
        }
      });
      const unExit = await listen<TerminalExitEvent>("terminal-exit", (event) => {
        if (event.payload.id === id) {
          term.write(
            `\r\n\x1b[90m[verdant] proceso terminado (código ${event.payload.exit_code ?? "?"})\x1b[0m\r\n`,
          );
        }
      });
      disposers.push(unData, unExit);

      term.focus();
    };

    void start();

    return () => {
      disposed = true;
      disposers.forEach((dispose) => dispose());
      resizeObserver.disconnect();
      if (sessionId !== null) {
        void invoke("close_terminal", { id: sessionId });
      }
      term.dispose();
    };
  }, []);

  return <div ref={containerRef} className="terminal-pane" />;
}