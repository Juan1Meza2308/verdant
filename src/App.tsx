import { useRef, useState } from "react";
import { TerminalPane } from "./components/TerminalPane";
import { TabBar, type Tab } from "./components/TabBar";
import "./App.css";

function App() {
  const nextIdRef = useRef(2);
  const [tabs, setTabs] = useState<Tab[]>([{ id: 1, title: "Terminal 1" }]);
  const [activeTab, setActiveTab] = useState(1);

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