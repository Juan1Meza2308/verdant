import { describe, expect, it } from "vitest";
import {
  adjacentBlockId,
  blockContainingRow,
  BlocksState,
  decodeCommandPayload,
  type Block,
} from "./blocks";

describe("decodeCommandPayload", () => {
  it("decodifica cmdline_url percent-encoded (nativo de fish)", () => {
    expect(decodeCommandPayload("cmdline_url=echo%20hi")).toBe("echo hi");
    expect(decodeCommandPayload("cmdline_url=echo%20%22saludo%3A%20%C3%A1%22")).toBe(
      'echo "saludo: á"',
    );
  });

  it("decodifica cmd= base64 (fallback conf.d)", () => {
    const encoded = Buffer.from("git add .", "utf8").toString("base64");
    expect(decodeCommandPayload(`cmd=${encoded}`)).toBe("git add .");
  });

  it("deja payloads desconocidos tal cual y payload vacío como vacío", () => {
    expect(decodeCommandPayload("foo=bar")).toBe("foo=bar");
    expect(decodeCommandPayload("")).toBe("");
    expect(decodeCommandPayload(undefined)).toBe("");
  });

  it("no revienta con percent-encoding inválido", () => {
    expect(decodeCommandPayload("cmdline_url=100%")).toBe("100%");
  });
});

describe("BlocksState", () => {
  it("abre un bloque en A con startRow exacta", () => {
    const s = new BlocksState();
    s.onMarker("A", 3);
    expect(s.blocks).toHaveLength(1);
    expect(s.blocks[0]).toEqual({ id: 1, startRow: 3, endRow: null, command: "" });
    expect(s.current).toBe(s.blocks[0]);
  });

  it("C fija command y endRow; B no hace nada", () => {
    const s = new BlocksState();
    s.onMarker("A", 0);
    s.onMarker("B", 1);
    expect(s.current?.endRow).toBeNull();
    s.onMarker("C", 5, "cmdline_url=ls%20-la");
    expect(s.current).toMatchObject({ command: "ls -la", endRow: 5, startRow: 0 });
  });

  it("un A siguiente cierra el bloque abierto en row - 1", () => {
    const s = new BlocksState();
    s.onMarker("A", 0);
    s.onMarker("C", 8, "cmdline_url=echo%20ok");
    s.onMarker("A", 10);
    expect(s.blocks[0]).toMatchObject({ endRow: 8, command: "echo ok" });
    expect(s.blocks[1]).toMatchObject({ id: 2, startRow: 10, endRow: null });
    expect(s.current).toBe(s.blocks[1]);
  });

  it("dos A consecutivas (sin C) cierran la primera en row - 1", () => {
    const s = new BlocksState();
    s.onMarker("A", 0);
    s.onMarker("A", 4);
    expect(s.blocks[0]).toMatchObject({ startRow: 0, endRow: 3, command: "" });
    expect(s.blocks).toHaveLength(2);
  });

  it("A en la misma fila no produce endRow < startRow", () => {
    const s = new BlocksState();
    s.onMarker("A", 4);
    s.onMarker("A", 4);
    expect(s.blocks[0].endRow).toBe(4);
  });

  it("ignora C huérfano (sin bloque abierto)", () => {
    const s = new BlocksState();
    expect(() => s.onMarker("C", 2, "cmdline_url=ls")).not.toThrow();
    expect(s.blocks).toHaveLength(0);
    expect(s.current).toBeNull();
  });

  it("no sobreescribe command si llega un C con payload vacío", () => {
    const s = new BlocksState();
    s.onMarker("A", 0);
    s.onMarker("C", 4, "cmdline_url=echo%20hi");
    s.onMarker("C", 5, "");
    expect(s.blocks[0].command).toBe("echo hi");
    expect(s.blocks[0].endRow).toBe(4);
  });
});

describe("navegación sobre bloques", () => {
  const blocks: readonly Block[] = [
    { id: 1, startRow: 0, endRow: 10, command: "a" },
    { id: 2, startRow: 12, endRow: 20, command: "b" },
    { id: 3, startRow: 22, endRow: null, command: "c" },
  ];

  it("adjacentBlockId navega en ambas direcciones y respeta bordes", () => {
    expect(adjacentBlockId(blocks, 1, 1)).toBe(2);
    expect(adjacentBlockId(blocks, 2, -1)).toBe(1);
    expect(adjacentBlockId(blocks, 3, 1)).toBeNull();
    expect(adjacentBlockId(blocks, 1, -1)).toBeNull();
    expect(adjacentBlockId(blocks, 99, 1)).toBeNull();
  });

  it("blockContainingRow encuentra el bloque dueño de la fila", () => {
    expect(blockContainingRow(blocks, 5)?.id).toBe(1);
    expect(blockContainingRow(blocks, 15)?.id).toBe(2);
    expect(blockContainingRow(blocks, 25)?.id).toBe(3); // bloque abierto cubre hacia abajo
    expect(blockContainingRow(blocks, 11)).toBeNull(); // hueco entre bloques
    expect(blockContainingRow(blocks, -1)).toBeNull(); // antes del primero
  });
});