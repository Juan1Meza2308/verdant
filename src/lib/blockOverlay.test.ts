import { describe, expect, it } from "vitest";
import { baseTheme } from "./theme";
import { blendOver, blockFillColor } from "./blockOverlay";

describe("blendOver", () => {
  it("devuelve el fondo sin cambio con alpha 0", () => {
    expect(blendOver("#5eead4", "#0b0e14", 0)).toBe("#0b0e14");
  });

  it("devuelve el acento sin cambio con alpha 1", () => {
    expect(blendOver("#5eead4", "#0b0e14", 1)).toBe("#5eead4");
  });

  it("mezcla correctamente con alpha 0.5", () => {
    expect(blendOver("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  it("produce un color sólido #RRGGBB de 6 dígitos", () => {
    expect(blockFillColor(baseTheme)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("el relleno es un tinte sutil del acento sobre el fondo", () => {
    const fill = blockFillColor(baseTheme);
    expect(fill).not.toBe(baseTheme.background);
    expect(fill).not.toBe(baseTheme.accent);
    // Cerca del fondo (alpha bajo), no del acento.
    const deltaBg = Math.abs(parseInt(fill.slice(1), 16) - parseInt(baseTheme.background.slice(1), 16));
    const deltaAccent = Math.abs(parseInt(fill.slice(1), 16) - parseInt(baseTheme.accent.slice(1), 16));
    expect(deltaBg).toBeLessThan(deltaAccent);
  });
});