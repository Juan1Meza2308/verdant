//! Frontend sessions: tipos espejo de Rust, store con caché y búsqueda
//! debounced para el SessionPicker (Ctrl+Shift+P).

import { invoke } from "@tauri-apps/api/core";

/** Ventana de debounce para búsqueda en vivo (SPEC: 150ms). */
export const SESSION_DEBOUNCE_MS = 150;

/** Sesión persistida (espejo de `sessions::Session`). */
export interface Session {
  id: number;
  created_at: string;
  updated_at: string;
  cwd: string;
  shell: string;
  cols: number;
  rows: number;
  exit_code: number | null;
  title: string | null;
  env_json: string | null;
  scrollback_limit: number | null;
}

/** Bloque de una sesión (espejo de `sessions::Block`). */
export interface Block {
  id: number;
  session_id: number;
  seq: number;
  start_row: number;
  end_row: number | null;
  command: string;
  command_hash: string;
  created_at: string;
}

/** Hit de búsqueda FTS5 (espejo de `sessions::SearchHit`). */
export interface SearchHit {
  session_id: number;
  block_id: number;
  command: string;
  output_snippet: string;
  cwd: string;
  rank: number;
}

/** Filtros de listado (espejo de `sessions::SessionFilter`). */
export interface SessionFilter {
  limit?: number;
  offset?: number;
  cwd?: string;
  from_date?: string;
  to_date?: string;
  exited_only?: boolean;
}

/** Sesión + sus bloques (respuesta de `get_session`). */
export interface SessionDetail {
  session: Session;
  blocks: Block[];
}

/** Resumen de sesión para la home (espejo de `sessions::RecentSession`). */
export interface RecentSession {
  id: number;
  cwd: string;
  title: string | null;
  updated_at: string;
  last_command: string | null;
  block_count: number;
}

/** Firma de invocation para poder mockear en tests. */
export interface SessionsApi {
  list_sessions(filter?: SessionFilter | null): Promise<Session[]>;
  search_sessions(query: string, limit?: number | null): Promise<SearchHit[]>;
  get_session(id: number): Promise<SessionDetail | null>;
  get_block_output(session_id: number, block_seq: number): Promise<number[] | null>;
  recent_sessions(limit?: number | null): Promise<RecentSession[]>;
}

const api: SessionsApi = {
  list_sessions: (filter) => invoke("list_sessions", { filter: filter ?? null }),
  search_sessions: (query, limit) => invoke("search_sessions", { query, limit: limit ?? null }),
  get_session: (id) => invoke("get_session", { session_id: id }),
  get_block_output: (session_id, block_seq) =>
    invoke("get_block_output", { session_id, block_seq }),
  recent_sessions: (limit) => invoke("recent_sessions", { limit: limit ?? null }),
};

/** Debounce genérico: devuelve wrapper que pospone `fn` hasta `ms` de silencio. */
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  ms: number,
): { run: (...args: Args) => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = (...args: Args) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return { run, cancel };
}

/** Cache de listados por query (para evitar roundtrips repetidos del picker). */
const listCache = new Map<string, Session[]>();

/** Lista sesiones (paginado). Cachea por clave de filtro. */
export async function listSessions(filter?: SessionFilter): Promise<Session[]> {
  const key = JSON.stringify(filter ?? {});
  const hit = listCache.get(key);
  if (hit) return hit;
  const sessions = await api.list_sessions(filter ?? null);
  listCache.set(key, sessions);
  return sessions;
}

/** Invalida la caché completa (al crear/cerrar sesiones o editar títulos). */
export function invalidateSessionsCache(): void {
  listCache.clear();
}

/** Búsqueda FTS5 directa (sin caché; cada keystroke debounced en el picker). */
export function searchSessions(query: string, limit = 50): Promise<SearchHit[]> {
  const q = query.trim();
  if (q.length === 0) return Promise.resolve([]);
  return api.search_sessions(q, limit);
}

/** Detalle de sesión (metadatos + bloques) para el preview del picker. */
export function getSessionDetail(id: number): Promise<SessionDetail | null> {
  return api.get_session(id);
}

/** Resumen de sesiones recientes para la pantalla de inicio (sin caché). */
export function recentSessions(limit = 6): Promise<RecentSession[]> {
  return api.recent_sessions(limit);
}

/** Output crudo de un bloque (para restore/replay y preview). */
export function getBlockOutput(sessionId: number, blockSeq: number): Promise<Uint8Array | null> {
  return api.get_block_output(sessionId, blockSeq).then((bytes) =>
    bytes ? new Uint8Array(bytes) : null,
  );
}

/** Título legible para la UI: title ?? último comando ?? `cwd` + shell. */
export function sessionLabel(s: Session, blocks: Block[] = []): string {
  if (s.title && s.title.length > 0) return s.title;
  const lastCmd = [...blocks].reverse().find((b) => b.command.length > 0);
  if (lastCmd) return lastCmd.command;
  return `${s.shell} — ${s.cwd}`;
}

/** Timestamp legible (UTC → local corto). */
export function formatSessionTime(updated_at: string): string {
  const d = new Date(updated_at);
  if (Number.isNaN(d.getTime())) return updated_at;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}