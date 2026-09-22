import { useState } from "react";
import type { ThemeMode } from "../lib/theme";

export interface Tab {
  id: number;
  title: string;
}

interface TabBarProps {
  tabs: Tab[];
  activeTab: number;
  onSelect: (id: number) => void;
  onCreate: () => void;
  onClose: (id: number) => void;
  onRename: (id: number, title: string) => void;
  /** Panel lateral de sesiones (toggle desde el icono). */
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  /** Modo de tema actual (ryoku auto sigue al wallpaper; base es fijo). */
  themeMode: ThemeMode;
  onToggleTheme: () => void;
}

const NEW_TAB_LABEL = "+";

export function TabBar({
  tabs,
  activeTab,
  onSelect,
  onCreate,
  onClose,
  onRename,
  sidebarOpen,
  onToggleSidebar,
  themeMode,
  onToggleTheme,
}: TabBarProps) {
  return (
    <nav className="tab-bar" role="tablist" aria-label="Tabs de verdant">
      {tabs.map((tab) => (
        <TabItem
          key={tab.id}
          tab={tab}
          active={tab.id === activeTab}
          onSelect={() => onSelect(tab.id)}
          onClose={() => onClose(tab.id)}
          onRename={(title) => onRename(tab.id, title)}
        />
      ))}
      <button
        type="button"
        className="tab-new"
        onClick={onCreate}
        aria-label="Nueva tab"
        title="Nueva tab"
      >
        {NEW_TAB_LABEL}
      </button>
      <div className="tab-actions">
        <button
          type="button"
          className={`tab-action-btn${sidebarOpen ? " active" : ""}`}
          onClick={onToggleSidebar}
          aria-label="Alternar panel de sesiones"
          aria-pressed={sidebarOpen}
          title="Panel de sesiones"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <rect x="1.5" y="2.5" width="13" height="11" rx="2.2" />
            <line x1="6" y1="2.5" x2="6" y2="13.5" />
          </svg>
        </button>
        <button
          type="button"
          className={`tab-action-btn${themeMode === "ryoku" ? " active" : ""}`}
          onClick={onToggleTheme}
          aria-label="Alternar tema: ryoku (auto) o base"
          aria-pressed={themeMode === "ryoku"}
          title={
            themeMode === "ryoku"
              ? "Tema ryoku: sigue al wallpaper · Ctrl+Shift+M"
              : "Tema base: fijo · Ctrl+Shift+M"
          }
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="8" cy="8" r="5.8" />
            <circle cx="11.2" cy="4.8" r="1.9" fill="currentColor" stroke="none" />
          </svg>
        </button>
      </div>
    </nav>
  );
}

function TabItem({
  tab,
  active,
  onSelect,
  onClose,
  onRename,
}: {
  tab: Tab;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
  onRename: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tab.title);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed.length > 0) {
      onRename(trimmed);
    }
    setEditing(false);
  };

  return (
    <div
      className={`tab-item${active ? " tab-active" : ""}`}
      role="tab"
      aria-selected={active}
    >
      {editing ? (
        <input
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          className="tab-rename"
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              commit();
            } else if (event.key === "Escape") {
              setDraft(tab.title);
              setEditing(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="tab-title"
          onClick={onSelect}
          onDoubleClick={() => {
            setDraft(tab.title);
            setEditing(true);
          }}
          title={`Renombrar: ${tab.title}`}
        >
          {tab.title}
        </button>
      )}
      <button
        type="button"
        className="tab-close"
        onClick={onClose}
        aria-label={`Cerrar ${tab.title}`}
        title="Cerrar tab"
      >
        ×
      </button>
    </div>
  );
}