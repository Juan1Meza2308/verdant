import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { TerminalPane, type VerdantConfig } from "./components/TerminalPane";
import { TabBar, type Tab } from "./components/TabBar";
import { dispatchAction } from "./lib/actions";
import { comboMatches, parseCombo, type KeyCombo } from "./lib/keybinds";
import "./App.css";

function App() {
  const nextIdRef = useRef(2);
  const [tabs, setTabs] = useState<Tab[]>([{ id: 1, title: "Terminal 1" }]);
  const [activeTab, setActiveTab] = useState(1);
  const [config, setConfig] = useState<VerdantConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    void invoke<VerdantConfig>("get_config").then((loaded) => {
      if (!cancelled) setConfig(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const createTab = () => {
    const id = nextIdRef.current;
    nextIdRef.current += 1;
    setTabs((prev) => [...prev, { id, title: `Terminal ${id}` }]);
    setActiveTab(id);
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
    bind("tab-new", createTab);
    bind("tab-close", () => closeTab(activeTab));
    bind("tab-next", () => cycleTab(1));
    bind("tab-prev", () => cycleTab(-1));
    bind("search", () => dispatchAction("search"));

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
            <TerminalPane active={tab.id === activeTab} />
          </div>
        ))}
      </div>
    </main>
  );
}

export default App;