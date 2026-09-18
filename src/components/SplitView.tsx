import type { Layout, PaneRef } from "../lib/layout";
import { TerminalPane } from "./TerminalPane";

interface SplitViewProps {
  layout: Layout;
  /** true si la tab que contiene este layout está activa (las ocultas no enfocan). */
  tabActive: boolean;
  /** Pane enfocado dentro de la tab. */
  activePane: PaneRef;
  /** Click en una hoja -> enfocar ese pane. */
  onFocusPane: (paneId: PaneRef) => void;
}

export function SplitView({ layout, tabActive, activePane, onFocusPane }: SplitViewProps) {
  if (layout.type === "leaf") {
    const focused = tabActive && layout.paneId === activePane;
    return (
      <div
        className={`split-leaf${focused ? " pane-focused" : ""}`}
        onMouseDownCapture={() => onFocusPane(layout.paneId)}
      >
        <TerminalPane active={focused} />
      </div>
    );
  }

  const direction = layout.type === "hsplit" ? "row" : "col";
  return (
    <div className={`split-${direction}`}>
      <div className="split-slot" style={{ flexGrow: layout.ratio, flexBasis: "0%" }}>
        <SplitView layout={layout.first} tabActive={tabActive} activePane={activePane} onFocusPane={onFocusPane} />
      </div>
      <div className="split-slot" style={{ flexGrow: 1 - layout.ratio, flexBasis: "0%" }}>
        <SplitView layout={layout.second} tabActive={tabActive} activePane={activePane} onFocusPane={onFocusPane} />
      </div>
    </div>
  );
}