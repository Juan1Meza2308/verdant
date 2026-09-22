import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SplitView } from "./components/SplitView";
import { SessionPicker } from "./components/SessionPicker";
import { TabBar, type Tab } from "./components/TabBar";
import type { VerdantConfig } from "./components/TerminalPane";
import { dispatchAction } from "./lib/actions";
import { comboMatches, parseCombo, type KeyCombo } from "./lib/keybinds";
import { invalidateSessionsCache } from "./lib/sessions";
import {
  closeLeaf,
  collectPaneIds,
  countPanes,
  newLeaf,
  nextPaneId,
  splitLeaf,
  type Layout,
  type PaneRef,
} from "./lib/layout";
import "./App.css";

interface TabItem extends Tab {
  /** Árbol de panes dentro de la tab. */
  layout: Layout;
  /** Pane enfocado dentro de la tab. */
  activePane: PaneRef;
}

function App() {
  const nextIdRef = useRef(2);
  const nextPaneIdRef = useRef(2);
  const [tabs, setTabs] = useState<TabItem[]>([
    { id: 1, title: "Terminal 1", layout: newLeaf(1), activePane: 1 },
  ]);
  const [activeTab, setActiveTab] = useState(1);
  const [config, setConfig] = useState<VerdantConfig | null>(null);
  const [showSessions, setShowSessions] = useState(false);
  /** Pane id (layout) → id de sesión DB (para restore/attach). */
  const paneSessionsRef = useRef(new Map<PaneRef, number>());

  useEffect(() => {
    let cancelled = false;
    void invoke<VerdantConfig>("get_config").then((loaded) => {
      if (!cancelled) setConfig(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const createTab = (sessionId?: number) => {
    // Los callbacks de eventos (keybind, click en "+") pueden pasar el evento
    // como argumento: solo aceptamos ids numéricos, nunca objetos.
    const restoreId = typeof sessionId === "number" ? sessionId : undefined;
    const id = nextIdRef.current;
    nextIdRef.current += 1;
    const paneId = nextPaneIdRef.current;
    nextPaneIdRef.current += 1;
    if (restoreId !== undefined) paneSessionsRef.current.set(paneId, restoreId);
    setTabs((prev) => [
      ...prev,
      { id, title: restoreId !== undefined ? `Sesión ${restoreId}` : `Terminal ${id}`, layout: newLeaf(paneId), activePane: paneId },
    ]);
    setActiveTab(id);
  };

  /** Restaura una sesión persistida en una tab nueva. */
  const attachSession = (sessionId: number) => {
    createTab(sessionId);
    setShowSessions(false);
  };

  const closeTab = (id: number) => {
    setTabs((prev) => {
      if (prev.length <= 1) return prev;
      const index = prev.findIndex((tab) => tab.id === id);
      const next = prev.filter((tab) => tab.id !== id);
      if (activeTab === id) {
        const neighbor = next[Math.max(0, index - 1)];
        setActiveTab(neighbor.id);
      }
      return next;
    });
  };

  const renameTab = (id: number, title: string) => {
    setTabs((prev) => prev.map((tab) => (tab.id === id ? { ...tab, title } : tab)));
  };

  const cycleTab = (direction: 1 | -1) => {
    setTabs((prev) => {
      if (prev.length <= 1) return prev;
      const index = prev.findIndex((tab) => tab.id === activeTab);
      const next = prev[(index + direction + prev.length) % prev.length];
      setActiveTab(next.id);
      return prev;
    });
  };

  // --- Panes dentro de la tab activa ---

  const splitActivePane = (direction: "h" | "v") => {
    setTabs((prev) => {
      const tab = prev.find((t) => t.id === activeTab);
      if (!tab) return prev;
      const newPaneId = nextPaneIdRef.current;
      nextPaneIdRef.current += 1;
      const nextLayout = splitLeaf(tab.layout, tab.activePane, direction, newPaneId);
      if (!nextLayout) return prev;
      return prev.map((t) =>
        t.id === activeTab ? { ...t, layout: nextLayout, activePane: newPaneId } : t,
      );
    });
  };

  const closeActivePane = () => {
    setTabs((prev) => {
      const index = prev.findIndex((t) => t.id === activeTab);
      const tab = prev[index];
      if (!tab) return prev;
      if (countPanes(tab.layout) <= 1) {
        // Último pane: equivale a cerrar la tab entera.
        if (prev.length <= 1) return prev;
        const next = prev.filter((t) => t.id !== activeTab);
        const neighbor = next[Math.max(0, index - 1)];
        setActiveTab(neighbor.id);
        return next;
      }
      const nextLayout = closeLeaf(tab.layout, tab.activePane);
      const remaining = nextLayout ? collectPaneIds(nextLayout) : [];
      const nextActive = remaining[0] ?? tab.activePane;
      const layout = nextLayout ?? tab.layout;
      return prev.map((t) =>
        t.id === activeTab ? { ...t, layout, activePane: nextActive } : t,
      );
    });
  };

  const cycleActivePane = (direction: 1 | -1) => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== activeTab) return t;
        const next = nextPaneId(t.layout, t.activePane, direction);
        return next ? { ...t, activePane: next } : t;
      }),
    );
  };

  const focusPane = (tabId: number, paneId: PaneRef) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, activePane: paneId } : t)));
    if (tabId !== activeTab) setActiveTab(tabId);
  };

  // Diagnóstico: log del layout activo para verificación externa (wtype).
  useEffect(() => {
    if (!config) return;
    const tab = tabs.find((t) => t.id === activeTab);
    if (tab) {
      void invoke("debug_log", {
        msg: `[layout] panes=${countPanes(tab.layout)} active=${tab.activePane} ids=${collectPaneIds(tab.layout).join(",")}`,
      });
    }
  }, [tabs, activeTab, config]);

  // Listener global de keybinds (captura antes de xterm).
  useEffect(() => {
    if (!config) return;
    const bindings: Array<{ actionName: string; combo: KeyCombo; action: () => void }> = [];
    const bind = (actionName: string, action: () => void) => {
      const spec = config.keybinds[actionName];
      if (!spec) return;
      const combo = parseCombo(spec);
      if (combo) bindings.push({ actionName, combo, action });
    };
    bind("tab-new", () => createTab());
    bind("tab-close", () => closeTab(activeTab));
    bind("tab-next", () => cycleTab(1));
    bind("tab-prev", () => cycleTab(-1));
    bind("search", () => dispatchAction("search"));
    bind("copy", () => dispatchAction("copy"));
    bind("paste", () => dispatchAction("paste"));
    bind("block-prev", () => dispatchAction("block-prev"));
    bind("block-next", () => dispatchAction("block-next"));
    bind("block-rerun", () => dispatchAction("block-rerun"));
    bind("block-copy", () => dispatchAction("block-copy"));
    bind("snippets", () => dispatchAction("snippets"));
    bind("sessions", () => {
      invalidateSessionsCache();
      setShowSessions(true);
    });
    bind("split-v", () => splitActivePane("v"));
    bind("split-h", () => splitActivePane("h"));
    bind("pane-close", closeActivePane);
    bind("pane-next", () => cycleActivePane(1));
    bind("pane-prev", () => cycleActivePane(-1));

    if (bindings.length > 0) {
      void invoke("debug_log", {
        msg: `[binds] ${bindings.map((b) => `${b.actionName}=${config.keybinds[b.actionName]}`).join(" | ")}`,
      });
    } else {
      void invoke("debug_log", { msg: "[binds] NINGUNA acción consultable" });
    }

    const handler = (event: KeyboardEvent) => {
      // No interceptar mientras se renombra una tab o se escribe en el buscador
      // (xterm usa un <textarea> propio; por eso NO filtramos por tagName acá).
      const target = event.target as HTMLElement | null;
      if (target && target.closest(".tab-rename, .search-input")) return;

      if (event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) {
        void invoke("debug_log", {
          msg: `key=${event.key} code=${event.code} ctrl=${event.ctrlKey} alt=${event.altKey} shift=${event.shiftKey} meta=${event.metaKey} target=${target?.tagName ?? "window"}${target?.className ? ` class=${target.className}` : ""}`,
        });
      }

      for (const binding of bindings) {
        if (binding.combo && comboMatches(event, binding.combo)) {
          void invoke("debug_log", {
            msg: `action=${binding.actionName} combo=${binding.combo.key}`,
          });
          event.preventDefault();
          event.stopPropagation();
          binding.action();
          break;
        }
      }
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [config, tabs, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="app-shell">
      <TabBar
        tabs={tabs}
        activeTab={activeTab}
        onSelect={setActiveTab}
        onCreate={createTab}
        onClose={closeTab}
        onRename={renameTab}
      />
      <div className="pane-stack">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`pane-item${tab.id === activeTab ? " pane-active" : " pane-hidden"}`}
          >
            <SplitView
              layout={tab.layout}
              tabActive={tab.id === activeTab}
              activePane={tab.activePane}
              onFocusPane={(paneId) => focusPane(tab.id, paneId)}
              getSessionId={(paneId) => paneSessionsRef.current.get(paneId)}
            />
          </div>
        ))}
      </div>
      {showSessions && (
        <SessionPicker onAttach={attachSession} onClose={() => setShowSessions(false)} />
      )}
    </main>
  );
}

export default App;