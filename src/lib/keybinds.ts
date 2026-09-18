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

export function parseCombo(spec: string): KeyCombo | null {
  const parts = spec.split("+").map((part) => part.trim().toLowerCase());
  if (parts.length === 0) return null;
  const keyToken = parts[parts.length - 1];
  if (MODIFIER_NAMES.has(keyToken)) return null;

  const combo: KeyCombo = { ctrl: false, alt: false, shift: false, meta: false, key: keyToken };
  for (const part of parts.slice(0, -1)) {
    if (part === "ctrl" || part === "control") combo.ctrl = true;
    else if (part === "alt") combo.alt = true;
    else if (part === "shift") combo.shift = true;
    else if (part === "meta" || part === "super" || part === "cmd") combo.meta = true;
    else return null;
  }

  // Normaliza letras a mayúscula ("t" == "T"); el resto se compara tal cual.
  combo.key = combo.key.length === 1 ? combo.key.toUpperCase() : combo.key;
  return combo;
}

export function comboMatches(event: KeyboardEvent, combo: KeyCombo): boolean {
  if (event.ctrlKey !== combo.ctrl) return false;
  if (event.altKey !== combo.alt) return false;
  if (event.shiftKey !== combo.shift) return false;
  if (event.metaKey !== combo.meta) return false;

  const eventKey = combo.key.length === 1 ? event.key.toUpperCase() : event.key;
  return eventKey === combo.key;
}