//! Overlay de sesiones: lista recientes, búsqueda FTS debounced, preview
//! lateral con últimos bloques y Enter para restaurar la sesión elegida.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  debounce,
  formatSessionTime,
  getSessionDetail,
  listSessions,
  searchSessions,
  sessionLabel,
  SESSION_DEBOUNCE_MS,
  type Block,
  type SearchHit,
} from "../lib/sessions";
import "./SessionPicker.css";

interface Props {
  onAttach: (sessionId: number) => void;
  onClose: () => void;
}

/** Resultado unificado de la lista (sesión reciente o hit de búsqueda). */
type Row = {
  id: number;
  label: string;
  cwd: string;
  updated_at: string;
  exit_code: number | null;
  snippet: string | null;
};

const PAGE = 40;

export function SessionPicker({ onAttach, onClose }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [previewBlocks, setPreviewBlocks] = useState<Block[]>([]);
  const [previewSessionId, setPreviewSessionId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Carga inicial: sesiones recientes
  useEffect(() => {
    let cancelled = false;
    void listSessions({ limit: PAGE }).then((items) => {
      if (cancelled) return;
      setRows(
        items.map((s) => ({
          id: s.id,
          label: sessionLabel(s),
          cwd: s.cwd,
          updated_at: s.updated_at,
          exit_code: s.exit_code,
          snippet: null,
        })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Búsqueda en vivo con debounce (150ms)
  const search = useCallback((q: string) => {
    if (q.trim().length === 0) {
      void listSessions({ limit: PAGE }).then((items) =>
        setRows(
          items.map((s) => ({
            id: s.id,
            label: sessionLabel(s),
            cwd: s.cwd,
            updated_at: s.updated_at,
            exit_code: s.exit_code,
            snippet: null,
          })),
        ),
      );
      return;
    }
    setLoading(true);
    void searchSessions(q, PAGE)
      .then((hits) =>
        setRows(
          hits.map((h: SearchHit) => ({
            id: h.session_id,
            label: h.command || "sin comando",
            cwd: h.cwd,
            updated_at: "",
            exit_code: null,
            snippet: h.output_snippet,
          })),
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  const debounced = useMemo(
    () => debounce((q: string) => search(q), SESSION_DEBOUNCE_MS),
    [search],
  );

  useEffect(() => {
    const off = debounced; // mantener el wrapper vivo
    return () => off.cancel();
  }, [debounced]);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setSelectedIndex(0);
    debounced.run(value);
  };

  // Preview lateral del seleccionado (últimos 5 bloques)
  useEffect(() => {
    const row = rows[selectedIndex];
    if (!row) {
      setPreviewBlocks([]);
      setPreviewSessionId(null);
      return;
    }
    let cancelled = false;
    void getSessionDetail(row.id).then((detail) => {
      if (cancelled || !detail) return;
      setPreviewSessionId(detail.session.id);
      setPreviewBlocks(detail.blocks.slice(-5));
    });
    return () => {
      cancelled = true;
    };
  }, [rows, selectedIndex]);

  // Focus del input al abrir
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, rows.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const row = rows[selectedIndex];
        if (row) onAttach(row.id);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % Math.max(rows.length, 1));
        return;
      }
    },
    [rows, selectedIndex, onAttach, onClose],
  );

  const selected = rows[selectedIndex];

  return (
    <div className="session-overlay" role="dialog" onKeyDown={handleKeyDown}>
      <div className="session-picker">
        <input
          ref={inputRef}
          className="session-search"
          type="text"
          value={query}
          placeholder="Buscar en sesiones (comando, salida, cwd)…"
          onChange={(e) => handleQueryChange(e.target.value)}
        />
        <div className="session-body">
          <ul className="session-list">
            {rows.slice(0, PAGE).map((row, i) => (
              <li
                key={row.id}
                className={`session-item${i === selectedIndex ? " selected" : ""}`}
                onMouseEnter={() => setSelectedIndex(i)}
                onClick={() => onAttach(row.id)}
              >
                <span className="session-item-label">{row.label}</span>
                <span className="session-item-meta">
                  {row.updated_at ? formatSessionTime(row.updated_at) : ""}
                  {row.exit_code !== null ? ` • exit ${row.exit_code}` : ""}
                </span>
              </li>
            ))}
            {rows.length === 0 && (
              <li className="session-empty">{loading ? "Buscando…" : "Sin sesiones"}</li>
            )}
          </ul>
          <aside className="session-preview">
            {selected ? (
              <>
                <div className="session-preview-head">
                  <span className="session-preview-title">
                    {previewSessionId !== null ? `Sesión #${previewSessionId}` : "—"}
                  </span>
                  <span className="session-preview-cwd">{selected.cwd}</span>
                </div>
                {selected.snippet && (
                  <p className="session-preview-snippet">{selected.snippet}</p>
                )}
                <ol className="session-preview-blocks">
                  {previewBlocks.map((b) => (
                    <li key={b.id}>
                      <span className="preview-seq">{b.seq}</span>
                      <span className="preview-cmd">{b.command || "…"}</span>
                    </li>
                  ))}
                  {previewBlocks.length === 0 && (
                    <li className="preview-empty">Sin bloques registrados</li>
                  )}
                </ol>
              </>
            ) : (
              <p className="session-preview-empty">Selecciona una sesión</p>
            )}
          </aside>
        </div>
        <div className="session-hint">↑/↓ navegar • Enter restaurar • Tab siguiente • Esc cerrar</div>
      </div>
    </div>
  );
}