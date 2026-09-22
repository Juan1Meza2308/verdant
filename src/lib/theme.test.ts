//! Pruebas del tema dinámico ryoku: mapper de paleta material → tokens,
//! contraste WCAG y fallback seguro a baseTheme.

import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

import {
  baseTheme,
  contrastRatio,
  paletteToTheme,
  type RyokuPalette,
} from "./theme";

function paletteFixture(overrides: Partial<RyokuPalette> = {}): RyokuPalette {
  return {
    background: "#210e0b",
    onSurface: "#ffdad4",
    onSurfaceVariant: "#ebbcb4",
    primary: "#ffb4a8",
    error: "#ffb4ab",
    scrim: "#000000",
    cursor: "#ffdad4",
    ansi: Array.from({ length: 16 }, (_, i) => `#${String(i).padStart(2, "0")}0000`),
    ...overrides,
  };
}

describe("paletteToTheme", () => {
  it("null degrada a baseTheme (fallback seguro)", () => {
    expect(paletteToTheme(null)).toBe(baseTheme);
  });

  it("mapea las claves centrales de la paleta", () => {
    const theme = paletteToTheme(paletteFixture());
    expect(theme.background).toBe("#210e0b");
    expect(theme.accent).toBe("#ffb4a8");
    expect(theme.danger).toBe("#ffb4ab");
    expect(theme.ansi).toEqual(paletteFixture().ansi);
  });

  it("deriva superficies más claras que el fondo y un scrim translúcido", () => {
    const theme = paletteToTheme(paletteFixture());
    expect(contrastRatio(theme.surface, theme.background)).toBeGreaterThan(1);
    expect(theme.scrim).toMatch(/^rgba\(0, 0, 0, 0\.62\)$/);
    expect(theme.border).toMatch(/^rgba\(/);
  });

  it("sube el contraste del texto principal hasta ≥ 4.5:1 (AA)", () => {
    // onSurface gris oscuro sobre fondo casi negro: por debajo de AA.
    const theme = paletteToTheme(paletteFixture({ onSurface: "#777777" }));
    expect(contrastRatio(theme.foreground, theme.background)).toBeGreaterThanOrEqual(4.5);
  });

  it("sube el contraste del texto dim sobre la superficie derivada", () => {
    const theme = paletteToTheme(paletteFixture({ onSurfaceVariant: "#888888" }));
    expect(contrastRatio(theme.foregroundDim, theme.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("respetar el text claro existente sin aclararlo de más", () => {
    const theme = paletteToTheme(paletteFixture());
    expect(theme.foreground).toBe("#ffdad4"); // ya ≥ 4.5:1 sobre el fondo
  });
});

describe("contrastRatio", () => {
  it("blanco vs negro = 21", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 8);
  });

  it("mismo color = 1", () => {
    expect(contrastRatio("#123456", "#123456")).toBeCloseTo(1, 8);
  });
});