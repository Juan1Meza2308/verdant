//! Engine de keybinds: parsea combinaciones tipo `Ctrl+Shift+T` y decide
//! si un KeyboardEvent matchea. Los defaults vienen del backend (config).

export interface KeyCombo {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  key: string;
}

const MODIFIER_NAMES = new Set(["ctrl", "alt", "shift", "meta", "super", "cmd", "control"]);

/** Subconjunto de KeyboardEvent que necesita el matcher (testeable sin DOM). */
export interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export function parseCombo(spec: string): KeyCombo | null {
  const parts = spec.split("+").map((part) => part.trim());
  if (parts.length === 0) return null;
  const keyToken = parts[parts.length - 1];
  if (keyToken.length === 0 || MODIFIER_NAMES.has(keyToken.toLowerCase())) return null;

  const combo: KeyCombo = { ctrl: false, alt: false, shift: false, meta: false, key: keyToken };
  for (const part of parts.slice(0, -1)) {
    const lower = part.toLowerCase();
    if (lower === "ctrl" || lower === "control") combo.ctrl = true;
    else if (lower === "alt") combo.alt = true;
    else if (lower === "shift") combo.shift = true;
    else if (lower === "meta" || lower === "super" || lower === "cmd") combo.meta = true;
    else return null;
  }

  // Normaliza letras a mayúscula ("t" == "T"); el resto (Tab, F1, Escape…)
  // se conserva tal cual para compararlo contra event.key.
  combo.key = combo.key.length === 1 ? combo.key.toUpperCase() : combo.key;
  return combo;
}

export function comboMatches(event: KeyEventLike, combo: KeyCombo): boolean {
  if (event.ctrlKey !== combo.ctrl) return false;
  if (event.altKey !== combo.alt) return false;
  if (event.shiftKey !== combo.shift) return false;
  if (event.metaKey !== combo.meta) return false;

  const eventKey = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  // Comparación insensible a mayúsculas ("Tab" == "tab", "T" == "t").
  return eventKey.toLowerCase() === combo.key.toLowerCase();
}