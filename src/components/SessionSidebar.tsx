//! Barra lateral de sesiones: listado persistente estilo Warp. Cada entrada
//! abre/adjunta la sesión en una tab nueva (reutiliza el flujo del picker).
//! La lista se refresca al montar y cada pocos segundos mientras esté visible.

import { useEffect, useState } from "react";
import { invalidateSessionsCache, listSessions, type Session } from "../lib/sessions";
import "./SessionSidebar.css";

/** Refresco suave mientras el panel esté abierto. */
const SIDEBAR_REFRESH_MS = 4000;

interface SessionSidebarProps {
  /** Abre/adjunta la sesión en una tab nueva. */
  onAttach: (sessionId: number) => void;
  /** Oculta el panel. */
  onClose: () => void;
}

/** Etiqueta corta para la fila: título ?? último segmento del cwd. */
function sidebarLabel(s: Session): string {
  if (s.title && s.title.trim().length > 0) return s.title;
  const base = s.cwd.replace(/\/+$/, "").split("/").filter(Boolean).pop();
  return base && base.length > 0 ? base : `Sesión ${s.id}`;
}

export function SessionSidebar({ onAttach, onClose }: SessionSidebarProps) {
  const [sessions, setSessions] = useState<Session[]>([]);

  useEffect(() => {
    let active = true;
    const load = () => {
      invalidateSessionsCache();
      void listSessions().then((list) => {
        if (active) setSessions(list);
      });
    };
    load();
    const timer = setInterval(load, SIDEBAR_REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <aside className="session-sidebar" aria-label="Sesiones">
      <header className="session-sidebar-head">
        <span className="session-sidebar-title">Sesiones</span>
        <button
          type="button"
          className="session-sidebar-close"
          onClick={onClose}
          aria-label="Ocultar panel de sesiones"
          title="Ocultar panel"
        >
          ✕
        </button>
      </header>

      <div className="session-sidebar-list">
        {sessions.length === 0 ? (
          <p className="session-sidebar-empty">
            Aún no hay sesiones guardadas.
            <br />
            Los comandos que ejecutes aparecerán aquí.
          </p>
        ) : (
          sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              className="sidebar-session"
              onClick={() => onAttach(s.id)}
              title={`Abrir sesión ${s.id}`}
            >
              <span className="sidebar-session-label">{sidebarLabel(s)}</span>
              <span className="sidebar-session-meta">
                <span className="sidebar-session-cwd">{s.cwd}</span>
                <span className="sidebar-session-time">
                  {new Date(s.updated_at).toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </span>
            </button>
          ))
        )}
      </div>

      <footer className="session-sidebar-foot">Ctrl+Shift+P · buscar sesiones</footer>
    </aside>
  );
}