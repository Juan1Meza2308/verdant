//! Frontend snippets: caché singleton, resolución de variables
//! y overlay por-pane (se instancia en TerminalPane).

import { invoke } from "@tauri-apps/api/core";

export interface Snippet {
  trigger: string;
  description: string;
  body: string;
}

export interface SnippetResolved {
  text: string;
  variables: Map<string, string>;
}

let cache: Snippet[] | null = null;
let loading: Promise<Snippet[]> | null = null;

/** Carga snippets del backend (una vez; subsiguientes usan caché). */
export async function loadSnippets(): Promise<Snippet[]> {
  if (cache) return cache;
  if (loading) return loading;
  loading = invoke<Snippet[]>("get_snippets").then((snippets) => {
    cache = snippets;
    loading = null;
    return snippets;
  });
  return loading;
}

/** Invalida la caché (útil si el usuario edita el archivo externamente). */
export function invalidateSnippetsCache(): void {
  cache = null;
}

/** Resuelve un snippet sustituyendo {{var}} y {{var:default}}. */
export function resolveSnippet(snippet: Snippet, provided: Record<string, string> = {}): string {
  return snippet.body.replace(/\{\{(\w+)(?::([^}]+))?\}\}/g, (_match, name, defaultValue) => {
    if (name in provided) return provided[name];
    if (defaultValue !== undefined) return defaultValue;
    return `{{${name}}}`; // deja placeholder si no hay valor ni default
  });
}

/** Detecta variables en el body de un snippet: devuelve array de nombres únicos. */
export function extractVariables(body: string): string[] {
  const vars = new Set<string>();
  body.replace(/\{\{(\w+)(?::[^}]+)?\}\}/g, (_m, name) => {
    vars.add(name);
    return "";
  });
  return Array.from(vars);
}

/** Variables built-in que la app resuelve automáticamente. */
export async function resolveBuiltins(): Promise<Record<string, string>> {
  const now = new Date();
  const iso = now.toISOString().split("T")[0];
  return {
    date: iso,
    time: now.toTimeString().split(" ")[0],
    datetime: now.toISOString().replace("T", " ").split(".")[0],
    cwd: await invoke<string>("get_cwd").catch(() => (typeof navigator !== "undefined" ? "~" : "~")),
  };
}