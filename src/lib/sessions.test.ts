import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  debounce,
  searchSessions,
  sessionLabel,
  formatSessionTime,
  SESSION_DEBOUNCE_MS,
  type Block,
} from "./sessions";

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  invokeMock.mockReset();
});

describe("debounce", () => {
  it("ejecuta solo la última llamada dentro de la ventana", async () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const { run } = debounce(fn, 150);
    run("a");
    run("b");
    run("c");
    vi.advanceTimersByTime(100);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(51);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("c");
    vi.useRealTimers();
  });

  it("cancel detiene el timer pendiente", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const { run, cancel } = debounce(fn, 150);
    run("x");
    cancel();
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("searchSessions", () => {
  it("query vacía devuelve [] sin tocar la API", async () => {
    const hits = await searchSessions("   ");
    expect(hits).toEqual([]);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("consulta no vacía invoca search_sessions con límite", async () => {
    invokeMock.mockResolvedValueOnce([]);
    const hits = await searchSessions("git commit");
    expect(hits).toEqual([]);
    expect(invokeMock).toHaveBeenCalledWith("search_sessions", {
      query: "git commit",
      limit: 50,
    });
  });

  it("usa el límite pasado por el llamador", async () => {
    invokeMock.mockResolvedValueOnce([]);
    await searchSessions("nvim", 10);
    expect(invokeMock).toHaveBeenCalledWith("search_sessions", {
      query: "nvim",
      limit: 10,
    });
  });
});

describe("sessionLabel", () => {
  const base = {
    id: 7,
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:00:00Z",
    cwd: "/home/felipe",
    shell: "fish",
    cols: 120,
    rows: 30,
    exit_code: 0,
    title: null,
    env_json: null,
    scrollback_limit: 5000,
  };

  it("prioriza el título editable", () => {
    expect(sessionLabel({ ...base, title: "deploy" })).toBe("deploy");
  });

  it("cae al último comando ejecutado", () => {
    const blocks = [
      { command: "ls", seq: 1 },
      { command: "git push", seq: 2 },
    ] as unknown as Block[];
    expect(sessionLabel(base, blocks)).toBe("git push");
  });

  it("cae a shell + cwd si no hay comandos", () => {
    expect(sessionLabel(base, [])).toBe("fish — /home/felipe");
  });
});

describe("formatSessionTime", () => {
  it("fecha inválida devuelve el string original", () => {
    expect(formatSessionTime("nope")).toBe("nope");
  });

  it("fecha válida produce un formato local corto", () => {
    const out = formatSessionTime("2026-09-01T10:00:00Z");
    expect(out).toMatch(/\d{1,2}:\d{2}/);
  });
});

describe("SESSION_DEBOUNCE_MS", () => {
  it("es la ventana especificada en SPEC", () => {
    expect(SESSION_DEBOUNCE_MS).toBe(150);
  });
});