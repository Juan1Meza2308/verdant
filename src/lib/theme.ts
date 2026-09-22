//! Tema de verdant: define los tokens visuales base y expone una API de
//! suscripción para que Fase 4 (generación desde Ryoku/wallpaper) inyecte
//! temas dinámicos con live-reload sin tocar los componentes.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ITheme } from "@xterm/xterm";

export interface VerdantTheme {
  /** Fondo de la ventana: la capa más profunda, detrás de terminales y chrome. */
  canvas: string;
  /** Fondo principal del shell (la hoja del terminal). */
  background: string;
  /** Fondo elevado (barra de tabs, superficies intermedias). */
  surface: string;
  /** Superficie elevada: overlays, popovers, pestaña activa. */
  surfaceRaised: string;
  /** Borde sutil entre superficies. */
  border: string;
  /** Anillo de foco / acento translúcido (focus-visible, pane activo). */
  ring: string;
  /** Texto principal. */
  foreground: string;
  /** Texto secundario/dim. */
  foregroundDim: string;
  /** Acento (foco, selección activa, marca). */
  accent: string;
  /** Fondo de selección de texto/terminal. */
  selectionBackground: string;
  /** Telón semiopaco para overlays (scrim). */
  scrim: string;
  /** Color de peligro (cerrar, acciones destructivas). */
  danger: string;
  /** Paleta ANSI de 16 colores (normal + brillante). */
  ansi: [
    string, string, string, string, string, string, string, string,
    string, string, string, string, string, string, string, string,
  ];
}

const ANSI_GITHUB_EQUIV = {
  red: "#ff7b72",
  green: "#3fb950",
  yellow: "#d29922",
  blue: "#58a6ff",
  magenta: "#bc8cff",
  cyan: "#39c5cf",
  white: "#b1bac4",
  brightRed: "#ffa198",
  brightGreen: "#56d364",
  brightYellow: "#e3b341",
  brightBlue: "#79c0ff",
  brightMagenta: "#d2a8ff",
  brightCyan: "#56d4dd",
  brightWhite: "#f0f6fc",
} as const;

/** Tema por defecto: oscuro, frío, acento menta (vibra con la estética ryoku). */
export const baseTheme: VerdantTheme = {
  canvas: "#080a0f",
  background: "#0d1017",
  surface: "#12161f",
  surfaceRaised: "#181d29",
  border: "rgba(255, 255, 255, 0.07)",
  ring: "rgba(94, 234, 212, 0.45)",
  foreground: "#e2e8f0",
  foregroundDim: "#8b93a7",
  accent: "#5eead4",
  selectionBackground: "rgba(94, 234, 212, 0.25)",
  scrim: "rgba(4, 6, 9, 0.62)",
  danger: "#ff7b72",
  ansi: [
    "#0b0e14",
    ANSI_GITHUB_EQUIV.red,
    ANSI_GITHUB_EQUIV.green,
    ANSI_GITHUB_EQUIV.yellow,
    ANSI_GITHUB_EQUIV.blue,
    ANSI_GITHUB_EQUIV.magenta,
    ANSI_GITHUB_EQUIV.cyan,
    ANSI_GITHUB_EQUIV.white,
    "#6e7681",
    ANSI_GITHUB_EQUIV.brightRed,
    ANSI_GITHUB_EQUIV.brightGreen,
    ANSI_GITHUB_EQUIV.brightYellow,
    ANSI_GITHUB_EQUIV.brightBlue,
    ANSI_GITHUB_EQUIV.brightMagenta,
    ANSI_GITHUB_EQUIV.brightCyan,
    ANSI_GITHUB_EQUIV.brightWhite,
  ],
};

/** Convierte el tema de verdant al formato que espera xterm.js. */
export function themeToXterm(theme: VerdantTheme): ITheme {
  const [black, red, green, yellow, blue, magenta, cyan, white, brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite] = theme.ansi;
  return {
    background: theme.background,
    foreground: theme.foreground,
    cursor: theme.accent,
    cursorAccent: theme.background,
    selectionBackground: theme.selectionBackground,
    black,
    red,
    green,
    yellow,
    blue,
    magenta,
    cyan,
    white,
    brightBlack,
    brightRed,
    brightGreen,
    brightYellow,
    brightBlue,
    brightMagenta,
    brightCyan,
    brightWhite,
  };
}

/** Aplica el tema como variables CSS en :root (chrome de la app). */
export function applyThemeCss(theme: VerdantTheme): void {
  const root = document.documentElement;
  const vars: Record<string, string> = {
    "--v-canvas": theme.canvas,
    "--v-bg": theme.background,
    "--v-surface": theme.surface,
    "--v-surface-raised": theme.surfaceRaised,
    "--v-border": theme.border,
    "--v-ring": theme.ring,
    "--v-fg": theme.foreground,
    "--v-fg-dim": theme.foregroundDim,
    "--v-accent": theme.accent,
    "--v-selection": theme.selectionBackground,
    "--v-scrim": theme.scrim,
    "--v-danger": theme.danger,
  };
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }
}

let currentTheme: VerdantTheme = baseTheme;
const subscribers = new Set<(theme: VerdantTheme) => void>();

export function getTheme(): VerdantTheme {
  return currentTheme;
}

/** Cambia el tema en vivo: actualiza CSS vars y avisa a los suscriptores. */
export function setTheme(theme: VerdantTheme): void {
  currentTheme = theme;
  applyThemeCss(theme);
  for (const callback of subscribers) {
    callback(theme);
  }
}

/** Suscripción a cambios de tema (la usarán los panes para re-themear xterm). */
export function subscribeTheme(callback: (theme: VerdantTheme) => void): () => void {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

/** Inicialización en el arranque de la app. */
export function initTheme(): void {
  applyThemeCss(baseTheme);
}

// ---------------------------------------------------------------------------
// Tema ryoku (auto): paleta Material You que matugen publica en
// ~/.cache/ryoku/colors.json. verdant solo la lee; ryogami/matugen siguen
// siendo los únicos autores del color del escritorio.
// ---------------------------------------------------------------------------

export type ThemeMode = "ryoku" | "base";

/** Paleta Material You (subconjunto que verdant consume; espejo backend). */
export interface RyokuPalette {
  background: string;
  onSurface: string;
  onSurfaceVariant: string;
  primary: string;
  error: string;
  scrim: string;
  cursor: string;
  ansi: string[];
}

/** Ratio de contraste WCAG 2.1 entre dos colores (#rrggbb). */
export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const MIN_CONTRAST_TEXT = 4.5;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Mezcla a hacia b con un peso 0..1. */
function mix(a: string, b: string, weight: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * weight, ag + (bg - ag) * weight, ab + (bb - ab) * weight);
}

/** Convierte #rrggbb a rgba() con alpha 0..1. */
function alpha(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Luminancia relativa (WCAG 2.1): sRGB -> lineal. */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Sube el contraste de un texto contra su fondo hasta ≥ ratio (hacia blanco). */
function ensureContrast(color: string, background: string, ratio: number): string {
  if (contrastRatio(color, background) >= ratio) return color;
  let adjusted = color;
  for (let i = 0; i < 40 && contrastRatio(adjusted, background) < ratio; i += 1) {
    adjusted = mix(adjusted, "#ffffff", 0.08);
  }
  return adjusted;
}

/**
 * Traduce la paleta de ryoku a un tema completo. `null` (paleta no
 * disponible o inválida) degrada con gracia a baseTheme, nunca rompe
 * contraste.
 */
export function paletteToTheme(palette: RyokuPalette | null): VerdantTheme {
  if (!palette) return baseTheme;

  const background = palette.background;
  const surface = mix(background, palette.onSurface, 0.07);
  const surfaceRaised = mix(background, palette.onSurface, 0.12);
  const canvas = mix(background, "#000000", 0.28);

  const foreground = ensureContrast(palette.onSurface, background, MIN_CONTRAST_TEXT);
  const foregroundDim = ensureContrast(palette.onSurfaceVariant, surface, MIN_CONTRAST_TEXT);

  const ansi = palette.ansi.map((color, i) => color ?? baseTheme.ansi[i]) as VerdantTheme["ansi"];

  return {
    canvas,
    background,
    surface,
    surfaceRaised,
    border: alpha(palette.onSurface, 0.1),
    ring: alpha(palette.primary, 0.5),
    foreground,
    foregroundDim,
    accent: palette.primary,
    selectionBackground: alpha(palette.primary, 0.25),
    scrim: alpha(palette.scrim, 0.62),
    danger: palette.error,
    ansi,
  };
}

let currentMode: ThemeMode = "base";
let unlistenPalette: (() => void) | null = null;

export function getThemeMode(): ThemeMode {
  return currentMode;
}

/** Arranque: registra el live-reload y aplica el modo inicial. */
export function initThemeMode(mode: ThemeMode): void {
  currentMode = mode;
  if (unlistenPalette) return; // ya inicializado
  let disposed = false;
  void listen<RyokuPalette>("ryoku:palette", (event) => {
    if (disposed || currentMode !== "ryoku") return;
    setTheme(paletteToTheme(event.payload));
  }).then((unlisten) => {
    if (disposed) unlisten();
    else unlistenPalette = unlisten;
  });
  if (mode === "ryoku") void refreshRyokuTheme();
}

/** Alterna el modo de tema y persiste la elección en verdant.jsonc. */
export function toggleThemeMode(): ThemeMode {
  const next: ThemeMode = currentMode === "ryoku" ? "base" : "ryoku";
  currentMode = next;
  void invoke("set_theme_mode", { mode: next });
  if (next === "ryoku") {
    void refreshRyokuTheme();
  } else {
    setTheme(baseTheme);
  }
  return next;
}

async function refreshRyokuTheme(): Promise<void> {
  try {
    const palette = await invoke<RyokuPalette | null>("get_ryoku_theme");
    setTheme(paletteToTheme(palette));
  } catch {
    setTheme(baseTheme); // fallback seguro: nunca romper contraste
  }
}