//! Overlay visual de bloques: una decoration xterm por bloque (layer bottom)
//! con el fondo sutil del bloque y el contorno del seleccionado como clase
//! CSS en el mismo elemento. Las decorations siguen el scroll de forma
//! nativa y se descartan solas cuando su fila sale del scrollback.

import { type IDecoration, type IMarker, Terminal } from "@xterm/xterm";
import { getTheme, type VerdantTheme } from "./theme";
import type { Block } from "./blocks";

/** Intensidad del tinte de acento sobre el fondo del bloque (sutil). */
const BLOCK_FILL_ALPHA = 0.07;

interface BlockDecoration {
  id: number;
  marker: IMarker;
  decoration: IDecoration;
  height: number;
}

function hexToRgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** Mezcla `over` sobre `under` con alpha; devuelve #RRGGBB sólido (formato de xterm). */
export function blendOver(over: string, under: string, alpha: number): string {
  const [or, og, ob] = hexToRgb(over);
  const [ur, ug, ub] = hexToRgb(under);
  const mix = (o: number, u: number) => Math.round(o * alpha + u * (1 - alpha));
  return `#${[mix(or, ur), mix(og, ug), mix(ob, ub)]
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Color de relleno de un bloque: acento muy diluido sobre el fondo del tema. */
export function blockFillColor(theme: VerdantTheme): string {
  return blendOver(theme.accent, theme.background, BLOCK_FILL_ALPHA);
}

export class BlockOverlay {
  private readonly decorated = new Map<number, BlockDecoration>();
  private selectedId: number | null = null;
  private fillColor: string;

  constructor(private readonly terminal: Terminal) {
    this.fillColor = blockFillColor(getTheme());
  }

  /** Alto en celdas: bloque abierto pinta hasta el borde inferior de la vista. */
  private heightOf(block: Block): number {
    if (block.endRow === null) return this.terminal.rows;
    return Math.max(1, block.endRow - block.startRow + 1);
  }

  private registerDecoration(entry: Omit<BlockDecoration, "decoration">): IDecoration | undefined {
    const decoration = this.terminal.registerDecoration({
      marker: entry.marker,
      x: 0,
      width: this.terminal.cols,
      height: entry.height,
      layer: "bottom",
      backgroundColor: this.fillColor,
    });
    if (!decoration) return undefined;
    const id = entry.id;
    decoration.onRender((element) => {
      element.classList.add("verdant-block");
      element.classList.toggle("verdant-block-active", id === this.selectedId);
    });
    decoration.onDispose(() => {
      const current = this.decorated.get(id);
      if (current && current.decoration === decoration) {
        this.decorated.delete(id);
      }
    });
    return decoration;
  }

  private rebuild(entry: BlockDecoration): void {
    entry.decoration.dispose();
    const decoration = this.registerDecoration(entry);
    if (!decoration) {
      entry.marker.dispose();
      this.decorated.delete(entry.id);
      return;
    }
    entry.decoration = decoration;
  }

  /**
   * Se llama al procesar A: crea el marker en la fila del prompt (cursor).
   * En restore, `cursorYOffset` ancla la fila del prompt histórico restando
   * el alto del bloque de la posición actual del cursor (fin del output).
   */
  openBlock(block: Block, cursorYOffset = 0): void {
    const height = this.heightOf(block);
    const marker = this.terminal.registerMarker(cursorYOffset);
    const decoration = this.registerDecoration({ id: block.id, marker, height });
    if (!decoration) {
      marker.dispose();
      return;
    }
    const entry: BlockDecoration = {
      id: block.id,
      marker,
      decoration,
      height,
    };
    this.decorated.set(block.id, entry);
    this.select(block.id);
  }

  /** Recalcula el alto cuando C cierra el bloque o el siguiente A lo finaliza. */
  updateBlock(block: Block): void {
    const entry = this.decorated.get(block.id);
    if (!entry) return;
    const height = this.heightOf(block);
    if (entry.height === height) return;
    this.rebuild(entry);
    entry.height = height;
  }

  /** Bloque destacado (navegación, Fase 2 tarea 6). Re-renderiza las decorations visibles. */
  select(id: number | null): void {
    this.selectedId = id;
    this.terminal.refresh(0, this.terminal.rows - 1);
  }

  /** Rebuild total: cambio de tamaño (ancho en celdas) o de colores del tema. */
  rebuildAll(): void {
    for (const entry of this.decorated.values()) {
      this.rebuild(entry);
    }
  }

  /** Actualiza los colores tras un cambio de tema en vivo. */
  setTheme(theme: VerdantTheme): void {
    this.fillColor = blockFillColor(theme);
    this.rebuildAll();
  }

  dispose(): void {
    for (const entry of this.decorated.values()) {
      entry.decoration.dispose();
      entry.marker.dispose();
    }
    this.decorated.clear();
  }
}