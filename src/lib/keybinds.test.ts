import { describe, expect, it } from "vitest";
import { comboMatches, parseCombo, type KeyEventLike } from "./keybinds";

function ev(partial: Partial<KeyEventLike> & { key: string }): KeyEventLike {
  return {
    key: partial.key,
    ctrlKey: partial.ctrlKey ?? false,
    altKey: partial.altKey ?? false,
    shiftKey: partial.shiftKey ?? false,
    metaKey: partial.metaKey ?? false,
  };
}

describe("parseCombo", () => {
  it("parsea letras con modificadores", () => {
    const combo = parseCombo("Ctrl+Shift+T");
    expect(combo).toEqual({ ctrl: true, alt: false, shift: true, meta: false, key: "T" });
  });

  it("conserva mayúsculas en teclas no-letra (regresión Ctrl+Tab)", () => {
    const combo = parseCombo("Ctrl+Tab");
    expect(combo?.key).toBe("Tab");
    expect(combo?.ctrl).toBe(true);
  });

  it("acepta aliases de modificadores (Super/Cmd/Control)", () => {
    expect(parseCombo("Super+Alt+Space")?.key).toBe("Space");
    expect(parseCombo("Super+Alt+Space")?.meta).toBe(true);
    expect(parseCombo("Control+Shift+Escape")?.ctrl).toBe(true);
  });

  it("rechaza combos sin tecla o sin sentido", () => {
    expect(parseCombo("Ctrl+Shift")).toBeNull();
    expect(parseCombo("")).toBeNull();
    expect(parseCombo("Ctrl+Foo+Bar")).toBeNull();
  });
});

describe("comboMatches", () => {
  it("matchea letra con modificadores exactos", () => {
    const combo = parseCombo("Ctrl+Shift+T")!;
    expect(comboMatches(ev({ key: "T", ctrlKey: true, shiftKey: true }), combo)).toBe(true);
  });

  it("matchea insensible a mayúsculas en letras", () => {
    const combo = parseCombo("Ctrl+Shift+T")!;
    expect(comboMatches(ev({ key: "t", ctrlKey: true, shiftKey: true }), combo)).toBe(true);
  });

  it("matchea teclas no-letra independiente del caso (regresión Ctrl+Tab)", () => {
    const combo = parseCombo("Ctrl+Tab")!;
    expect(comboMatches(ev({ key: "Tab", ctrlKey: true }), combo)).toBe(true);
    expect(comboMatches(ev({ key: "tab", ctrlKey: true }), combo)).toBe(true);
  });

  it("falla con modificadores faltantes o extras", () => {
    const combo = parseCombo("Ctrl+Shift+T")!;
    expect(comboMatches(ev({ key: "T", ctrlKey: true }), combo)).toBe(false);
    expect(comboMatches(ev({ key: "T", ctrlKey: true, shiftKey: true, altKey: true }), combo)).toBe(false);
  });

  it("falla con otra tecla", () => {
    const combo = parseCombo("Ctrl+Tab")!;
    expect(comboMatches(ev({ key: "Escape", ctrlKey: true }), combo)).toBe(false);
  });

  it("matchea F-keys y flechas", () => {
    expect(comboMatches(ev({ key: "F5", altKey: true }), parseCombo("Alt+F5")!)).toBe(true);
    expect(comboMatches(ev({ key: "ArrowUp", ctrlKey: true, shiftKey: true }), parseCombo("Ctrl+Shift+ArrowUp")!)).toBe(true);
  });
});