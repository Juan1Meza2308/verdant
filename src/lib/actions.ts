//! Bus de acciones global: permite que cualquier componente dispare o
//! escuche acciones de la app (ej. "search") sin acoplarse a React context.

export type ActionName =
  | "search"
  | "copy"
  | "paste"
  | "block-prev"
  | "block-next"
  | "block-rerun"
  | "block-copy"
  | "snippets"
  | "sessions";

const listeners = new Map<ActionName, Set<() => void>>();

export function onAction(name: ActionName, callback: () => void): () => void {
  let set = listeners.get(name);
  if (!set) {
    set = new Set();
    listeners.set(name, set);
  }
  set.add(callback);
  return () => {
    set.delete(callback);
  };
}

export function dispatchAction(name: ActionName): void {
  const set = listeners.get(name);
  if (!set) return;
  for (const callback of set) {
    callback();
  }
}