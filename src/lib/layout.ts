//! Modelo de layout de panes dentro de una tab: árbol binario de splits.
//! Puro y testeable: App solo decide direcciones e ids, la geometría vive acá.

export type PaneRef = number;

export type Layout =
  | { type: "leaf"; paneId: PaneRef }
  | { type: "hsplit"; ratio: number; first: Layout; second: Layout }
  | { type: "vsplit"; ratio: number; first: Layout; second: Layout };

export type SplitDirection = "h" | "v";

export const DEFAULT_RATIO = 0.5;

export function newLeaf(paneId: PaneRef): Layout {
  return { type: "leaf", paneId };
}

/** Pane ids en orden de lectura (DFS). */
export function collectPaneIds(layout: Layout): PaneRef[] {
  if (layout.type === "leaf") return [layout.paneId];
  return [...collectPaneIds(layout.first), ...collectPaneIds(layout.second)];
}

export function countPanes(layout: Layout): number {
  return collectPaneIds(layout).length;
}

/** Busca el siguiente pane en el orden DFS, con wrap-around. */
export function nextPaneId(layout: Layout, current: PaneRef, direction: 1 | -1): PaneRef | null {
  const ids = collectPaneIds(layout);
  if (ids.length <= 1) return null;
  const index = ids.indexOf(current);
  const base = index === -1 ? 0 : index;
  const next = ids[(base + direction + ids.length) % ids.length];
  return next === current ? null : next;
}

/**
 * Reemplaza la hoja `paneId` por un split al 50% con un pane nuevo a la
 * derecha ("v") o debajo ("h"). Devuelve null si el pane no existe.
 */
export function splitLeaf(
  layout: Layout,
  paneId: PaneRef,
  direction: SplitDirection,
  newPaneId: PaneRef,
): Layout | null {
  if (layout.type === "leaf") {
    if (layout.paneId !== paneId) return null;
    const created: Layout =
      direction === "h"
        ? { type: "hsplit", ratio: DEFAULT_RATIO, first: layout, second: newLeaf(newPaneId) }
        : { type: "vsplit", ratio: DEFAULT_RATIO, first: layout, second: newLeaf(newPaneId) };
    return created;
  }

  const first = splitLeaf(layout.first, paneId, direction, newPaneId);
  if (first) return { ...layout, first };
  const second = splitLeaf(layout.second, paneId, direction, newPaneId);
  if (second) return { ...layout, second };
  return null;
}

/**
 * Elimina la hoja `paneId`. Si el split padre queda con un solo hijo, lo
 * promueve (el layout colapsa). Devuelve null solo si se eliminó la raíz.
 */
export function closeLeaf(layout: Layout, paneId: PaneRef): Layout | null {
  if (layout.type === "leaf") {
    if (layout.paneId === paneId) return null;
    return layout;
  }

  const first = closeLeaf(layout.first, paneId);
  const second = closeLeaf(layout.second, paneId);

  if (first === null && second === null) return null;
  if (first === null) return second;
  if (second === null) return first;
  return { ...layout, first, second };
}

/** Ajusta la proporción de un split (útil después para drag del gutter). */
export function setRatio(layout: Layout, path: Array<"first" | "second">, ratio: number): Layout {
  if (path.length === 0 || layout.type === "leaf") return layout;
  const step = path[0];
  const rest = path.slice(1);
  const clamped = Math.min(Math.max(ratio, 0.15), 0.85);
  if (step === "first") {
    return { ...layout, ratio: clamped, first: setRatio(layout.first, rest, ratio) };
  }
  return { ...layout, ratio: 1 - clamped, second: setRatio(layout.second, rest, ratio) };
}