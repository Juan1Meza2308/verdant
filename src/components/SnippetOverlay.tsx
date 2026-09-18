//! Overlay de snippets: lista con búsqueda/flechas, Enter para insertar,
//! campos para variables (si las hay), Escape para cerrar.

import { useCallback, useEffect, useRef, useState } from "react";
import { loadSnippets, resolveSnippet, extractVariables, resolveBuiltins, type Snippet } from "../lib/snippets";
import { onAction } from "../lib/actions";
import "./SnippetOverlay.css";

interface Props {
  onClose: () => void;
  paste: (text: string) => void;
}

export function SnippetOverlay({ onClose, paste }: Props) {
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [filtered, setFiltered] = useState<Snippet[]>([]);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [showVariables, setShowVariables] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Carga inicial
  useEffect(() => {
    loadSnippets().then((s) => {
      setSnippets(s);
      setFiltered(s);
    });
    const off = onAction("snippets", () => {
      // Re-abrir desde fuera (redundante con el trigger en TerminalPane)
    });
    return off;
  }, []);

  // Filtrado por query (trigger o descripción)
  useEffect(() => {
    const lower = query.toLowerCase();
    setFiltered(
      snippets.filter(
        (s) =>
          s.trigger.toLowerCase().includes(lower) ||
          s.description.toLowerCase().includes(lower),
      ),
    );
    setSelectedIndex(0);
  }, [query, snippets]);

  // Focus del input al montar
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Navegación teclado
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        handleSelect();
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        // Completar trigger en el input
        const sel = filtered[selectedIndex];
        if (sel) setQuery(sel.trigger);
        return;
      }
    },
    [filtered, selectedIndex, onClose],
  );

  const handleSelect = async () => {
    const snippet = filtered[selectedIndex];
    if (!snippet) return;

    const vars = extractVariables(snippet.body);
    const builtins = await resolveBuiltins();
    const merged = { ...builtins, ...variableValues };

    // Si tiene variables sin valor ni default → muestra panel de variables
    const missing = vars.filter(
      (v) => !(v in merged) && !snippet.body.includes(`{{${v}:`),
    );
    if (missing.length > 0 && !showVariables) {
      setVariableValues({});
      setShowVariables(true);
      return;
    }

    const text = resolveSnippet(snippet, merged);
    paste(text);
    onClose();
  };

  const handleVariableChange = (name: string, value: string) => {
    setVariableValues((prev) => ({ ...prev, [name]: value }));
  };

  const handleVariableSubmit = () => {
    handleSelect();
  };

  if (showVariables) {
    const vars = extractVariables(filtered[selectedIndex]?.body ?? "");
    return (
      <div className="snippet-overlay variable-mode" role="dialog">
        <div className="snippet-variable-panel">
          <h3>Variables para “{filtered[selectedIndex]?.trigger}”</h3>
          {vars.map((v) => (
            <div key={v} className="variable-row">
              <label htmlFor={`var-${v}`}>{v}</label>
              <input
                id={`var-${v}`}
                type="text"
                value={variableValues[v] ?? ""}
                onChange={(e) => handleVariableChange(v, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleVariableSubmit();
                  if (e.key === "Escape") setShowVariables(false);
                }}
                autoFocus
              />
            </div>
          ))}
          <div className="variable-actions">
            <button onClick={handleVariableSubmit}>Insertar</button>
            <button onClick={() => setShowVariables(false)}>Cancelar</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="snippet-overlay" role="dialog">
      <input
        ref={inputRef}
        className="snippet-search"
        type="text"
        value={query}
        placeholder="Buscar snippet…"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <ul className="snippet-list" ref={listRef}>
        {filtered.map((s, i) => (
          <li
            key={s.trigger}
            className={`snippet-item${i === selectedIndex ? " selected" : ""}`}
            onClick={() => {
              setSelectedIndex(i);
              handleSelect();
            }}
          >
            <span className="snippet-trigger">{s.trigger}</span>
            <span className="snippet-desc">{s.description}</span>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="snippet-empty">Sin coincidencias</li>
        )}
      </ul>
      <div className="snippet-hint">↑/↓ navegar • Enter insertar • Tab completar • Esc cerrar</div>
    </div>
  );
}