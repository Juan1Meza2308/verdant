import { useState } from "react";

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
}

const NEW_TAB_LABEL = "+";

export function TabBar({ tabs, activeTab, onSelect, onCreate, onClose, onRename }: TabBarProps) {
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