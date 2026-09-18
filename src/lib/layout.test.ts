import { describe, expect, it } from "vitest";
import {
  closeLeaf,
  collectPaneIds,
  countPanes,
  newLeaf,
  nextPaneId,
  setRatio,
  splitLeaf,
  type Layout,
} from "./layout";

describe("splitLeaf", () => {
  it("divide una hoja en dos con el pane nuevo al final", () => {
    const layout = newLeaf(1);
    const split = splitLeaf(layout, 1, "v", 2);
    expect(split).toEqual({
      type: "vsplit",
      ratio: 0.5,
      first: { type: "leaf", paneId: 1 },
      second: { type: "leaf", paneId: 2 },
    });
  });

  it("hsplit y vsplit difieren", () => {
    const h = splitLeaf(newLeaf(1), 1, "h", 2);
    expect(h?.type).toBe("hsplit");
    const v = splitLeaf(newLeaf(1), 1, "v", 2);
    expect(v?.type).toBe("vsplit");
  });

  it("divide recursivamente en el pane correcto", () => {
    const layout: Layout = splitLeaf(newLeaf(1), 1, "v", 2)!;
    const nested = splitLeaf(layout, 2, "h", 3)!;
    expect(countPanes(nested)).toBe(3);
    expect(collectPaneIds(nested)).toEqual([1, 2, 3]);
  });

  it("devuelve null si el pane no existe", () => {
    expect(splitLeaf(newLeaf(9), 42, "v", 5)).toBeNull();
  });
});

describe("closeLeaf", () => {
  it("colapsa el split al cerrar una hoja", () => {
    const layout: Layout = splitLeaf(newLeaf(1), 1, "v", 2)!;
    const closed = closeLeaf(layout, 2);
    expect(closed).toEqual({ type: "leaf", paneId: 1 });
  });

  it("reconstruye el árbol sin la hoja cerrada", () => {
    let layout: Layout = splitLeaf(newLeaf(1), 1, "v", 2)!;
    layout = splitLeaf(layout, 2, "h", 3)!;
    const closed = closeLeaf(layout, 3);
    expect(collectPaneIds(closed!)).toEqual([1, 2]);
  });

  it("devuelve null si se cierra la raíz (último pane)", () => {
    expect(closeLeaf(newLeaf(7), 7)).toBeNull();
  });
});

describe("nextPaneId", () => {
  it("cicla en el orden DFS con wrap", () => {
    let layout: Layout = splitLeaf(newLeaf(1), 1, "v", 2)!;
    layout = splitLeaf(layout, 2, "h", 3)!;
    expect(nextPaneId(layout, 1, 1)).toBe(2);
    expect(nextPaneId(layout, 3, 1)).toBe(1);
    expect(nextPaneId(layout, 1, -1)).toBe(3);
  });

  it("devuelve null con un solo pane", () => {
    expect(nextPaneId(newLeaf(1), 1, 1)).toBeNull();
  });
});

describe("setRatio", () => {
  it("clampa y ajusta la proporción del primer hijo", () => {
    const layout: Layout = splitLeaf(newLeaf(1), 1, "v", 2)!;
    const adjusted = setRatio(layout, ["first"], 0.8);
    expect(adjusted.type === "vsplit" && adjusted.ratio).toBeCloseTo(0.8);
    const clamped = setRatio(layout, ["first"], 0.01);
    expect(clamped.type === "vsplit" && clamped.ratio).toBeCloseTo(0.15);
  });
});