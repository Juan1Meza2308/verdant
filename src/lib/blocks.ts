/**
 * Block model: one block = prompt + command + output, built from OSC 133
 * markers. Pure state machine (no DOM), one instance per terminal pane.
 *
 * Marker semantics (native fish >= 4):
 *   A  -> open a new block (previous open block is finalized at row - 1)
 *   B  -> command start (no payload; informational)
 *   C  -> set command (payload cmdline_url=, percent-encoded) and endRow
 *
 * Command text comes from the shell itself, so it is exactly what the user
 * typed: aliases and pipelines survive for re-runs.
 */

import { decodeBase64Utf8, type Osc133Marker } from "./osc133";

export interface Block {
  id: number;
  startRow: number;
  endRow: number | null; // null while the block is still open
  command: string;
}

const CMDLINE_URL_PREFIX = "cmdline_url=";
const CMD_B64_PREFIX = "cmd=";

/** Decodes the command payload: percent-encoded (native fish) or base64 (fallback conf.d). */
export function decodeCommandPayload(payload: string | undefined): string {
  if (!payload) return "";
  if (payload.startsWith(CMDLINE_URL_PREFIX)) {
    const raw = payload.slice(CMDLINE_URL_PREFIX.length);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw; // malformed percent-encoding: keep readable
    }
  }
  if (payload.startsWith(CMD_B64_PREFIX)) {
    const raw = payload.slice(CMD_B64_PREFIX.length);
    try {
      return decodeBase64Utf8(raw);
    } catch {
      return raw;
    }
  }
  return payload;
}

/** Block id one step before/after the given one, or null at the edges. */
export function adjacentBlockId(
  blocks: readonly Block[],
  id: number,
  dir: 1 | -1,
): number | null {
  const index = blocks.findIndex((b) => b.id === id);
  const next = index + dir;
  return index !== -1 && next >= 0 && next < blocks.length ? blocks[next].id : null;
}

/** The block that visually owns the requested row, if any. */
export function blockContainingRow(
  blocks: readonly Block[],
  row: number,
): Block | null {
  for (const block of blocks) {
    if (row < block.startRow) return null;
    if (block.endRow === null || row <= block.endRow) return block;
  }
  return null;
}

export class BlocksState {
  readonly blocks: Block[] = [];
  current: Block | null = null;
  private nextId = 1;

  onMarker(marker: Osc133Marker, row: number, payload?: string): void {
    if (marker === "A") {
      if (this.current && this.current.endRow === null) {
        this.current.endRow = Math.max(this.current.startRow, row - 1);
      }
      const block: Block = {
        id: this.nextId++,
        startRow: row,
        endRow: null,
        command: "",
      };
      this.blocks.push(block);
      this.current = block;
      return;
    }
    if (marker === "C") {
      if (this.current && this.current.endRow === null) {
        this.current.command = payload ? decodeCommandPayload(payload) : this.current.command;
        this.current.endRow = row;
      }
      return;
    }
    // B: command start, no payload in native fish; nothing to track here.
  }

  /**
   * Rebuild the state from persisted blocks (session restore).
   * Seed ids are the DB seqs so navigation and DB sequence stay aligned;
   * the next live "A" continues at seed.length + 1.
   */
  restore(seed: Block[]): void {
    this.blocks.length = 0;
    for (const block of seed) this.blocks.push(block);
    this.current = seed.length > 0 ? seed[seed.length - 1] : null;
    this.nextId = seed.length + 1;
  }
}