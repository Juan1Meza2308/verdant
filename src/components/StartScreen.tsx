//! Pantalla de inicio estilo Warp: se muestra en las panes nuevas (sin sesión
//! restaurada) sobre el shell vivo. Muestra sesiones recientes y accesos
//! rápidos; cualquier tecla la descarta y devuelve el foco al terminal.

import { memo, useEffect, useRef, useState } from "react";
import { recentSessions, type RecentSession } from "../lib/sessions";
import "./StartScreen.css";

const RECENT_LIMIT = 6;

interface StartScreenProps {
  /** Abre una sesión reciente en una tab nueva. */
  onAttach: (sessionId: number) => void;
  /** Descarta la home y enfoca el shell. */
  onOpenShell: () => void;
}

interface Shortcut {
  label: string;
  combo: string;
}

const SHORTCUTS: Shortcut[] = [
  { label: "Buscar sesiones", combo: "Ctrl+Shift+P" },
  { label: "Nueva tab", combo: "Ctrl+Shift+T" },
  { label: "Buscar en la salida", combo: "Ctrl+Shift+F" },
  { label: "Snippets", combo: "Ctrl+Shift+S" },
];

/** Etiqueta corta para la tarjeta: title ?? último comando ?? sesión #id. */
function recentLabel(s: RecentSession): string {
  if (s.title && s.title.trim().length > 0) return s.title;
  if (s.last_command && s.last_command.length > 0) return s.last_command;
  return `Sesión ${s.id}`;
}

/** Tiempo relativo corto (hace 2 min, ayer…). */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const deltaMs = Date.now() - then;
  const minutes = Math.max(0, Math.floor(deltaMs / 60_000));
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `hace ${days} d`;
  return new Date(then).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export const StartScreen = memo(function StartScreen({ onAttach, onOpenShell }: StartScreenProps) {
  const [recent, setRecent] = useState<RecentSession[] | null>(null);
  const [selected, setSelected] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    void recentSessions(RECENT_LIMIT).then((list) => {
      if (active) setRecent(list);
    });
    return () => {
      active = false;
    };
  }, []);

  const openShell = () => {
    rootRef.current?.blur();
    onOpenShell();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const list = recent ?? [];
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        openShell();
        return;
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        if (list.length === 0) return;
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setSelected((prev) => (prev + delta + list.length) % list.length);
        return;
      }
      case "Enter":
        event.preventDefault();
        if (list.length > 0) {
          onAttach(list[selected].id);
        } else {
          openShell();
        }
        return;
      default:
        // Cualquier tecla imprimible baja al shell directamente.
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          openShell();
        }
    }
  };

  return (
    <div
      ref={rootRef}
      className="start-screen"
      tabIndex={0}
      role="dialog"
      aria-label="Pantalla de inicio"
      onKeyDown={handleKeyDown}
      onClick={(event) => {
        if (event.target === event.currentTarget) openShell();
      }}
    >
      <header className="start-screen-head">
        <span className="start-screen-wordmark" aria-hidden="true">
          verdant
        </span>
        <p className="start-screen-tagline">Terminal con sesiones persistentes y búsqueda global</p>
      </header>

      <section className="start-screen-recents" aria-label="Sesiones recientes">
        <h2 className="start-screen-section-title">Recientes</h2>
        {recent === null ? (
          <div className="start-screen-grid" aria-hidden="true">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="start-card start-card-skeleton" />
            ))}
          </div>
        ) : recent.length === 0 ? (
          <p className="start-screen-empty">
            Aún no hay sesiones. Ejecuta comandos y las verás aquí para retomarlas.
          </p>
        ) : (
          <div className="start-screen-grid">
            {recent.map((s, index) => (
              <button
                key={s.id}
                type="button"
                className={`start-card${index === selected ? " selected" : ""}`}
                onClick={() => onAttach(s.id)}
                onMouseEnter={() => setSelected(index)}
                tabIndex={index === selected ? 0 : -1}
                aria-selected={index === selected}
                aria-label={`Abrir sesión ${s.id}: ${recentLabel(s)}`}
              >
                <span className="start-card-command">{recentLabel(s)}</span>
                <span className="start-card-cwd">{s.cwd}</span>
                <span className="start-card-meta">
                  <span>{s.block_count} bloque{s.block_count === 1 ? "" : "s"}</span>
                  <span>{relativeTime(s.updated_at)}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="start-screen-shortcuts" aria-label="Accesos rápidos">
        <h2 className="start-screen-section-title">Atajos</h2>
        <ul className="start-screen-shortcut-list">
          {SHORTCUTS.map((sc) => (
            <li key={sc.label} className="start-screen-shortcut">
              <span>{sc.label}</span>
              <kbd>{sc.combo}</kbd>
            </li>
          ))}
        </ul>
      </section>

      <footer className="start-screen-foot">
        Pulsa cualquier tecla para empezar a escribir · Enter abre la sesión seleccionada
      </footer>
    </div>
  );
});