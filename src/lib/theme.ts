//! Tema de verdant: define los tokens visuales base y expone una API de
//! suscripción para que Fase 4 (generación desde Ryoku/wallpaper) inyecte
//! temas dinámicos con live-reload sin tocar los componentes.

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