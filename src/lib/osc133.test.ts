import { describe, expect, it } from "vitest";
import {
  decodeBase64Utf8,
  parseOsc133,
  type Osc133Segment,
} from "./osc133";

function text(s: string): Osc133Segment {
  return { text: s };
}

function toBase64Utf8(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

describe("parseOsc133", () => {
  it("deja el texto plano intacto en un solo segmento", () => {
    const res = parseOsc133("hola\r\nmundo");
    expect(res.segments).toEqual([text("hola\r\nmundo")]);
    expect(res.remaining).toBe("");
  });

  it("reconoce un marcador A simple con BEL", () => {
    const res = parseOsc133("\x1b]133;A\x07");
    expect(res.segments).toEqual([{ text: "", marker: "A" }]);
    expect(res.remaining).toBe("");
  });

  it("extrae el payload de B quitando el ';' inicial", () => {
    const res = parseOsc133("\x1b]133;B;cmd=QUJD\x07");
    expect(res.segments).toEqual([{ text: "", marker: "B", payload: "cmd=QUJD" }]);
  });

  it("mezcla texto y marcadores en orden", () => {
    const res = parseOsc133(
      "abc\x1b]133;A\x07prompt\x1b]133;B;cmd=ZQ==\x07out\x1b]133;C\x07rest",
    );
    expect(res.segments).toEqual([
      text("abc"),
      { text: "", marker: "A" },
      text("prompt"),
      { text: "", marker: "B", payload: "cmd=ZQ==" },
      text("out"),
      { text: "", marker: "C" },
      text("rest"),
    ]);
    expect(res.remaining).toBe("");
  });

  it("reconoce la forma nativa de fish (A;click_events, B, C;cmdline_url)", () => {
    const res = parseOsc133(
      "prompt\x1b]133;A;click_events=1\x07\x1b]133;B\x07salida\r\n\x1b]133;C;cmdline_url=echo%20hi\x07",
    );
    expect(res.segments).toEqual([
      text("prompt"),
      { text: "", marker: "A", payload: "click_events=1" },
      { text: "", marker: "B" },
      text("salida\r\n"),
      { text: "", marker: "C", payload: "cmdline_url=echo%20hi" },
    ]);
  });

  it("acepta ESC \\ (ST) como terminador", () => {
    const res = parseOsc133("\x1b]133;A\x1b\\");
    expect(res.segments).toEqual([{ text: "", marker: "A" }]);
  });

  it("conserva payloads base64 con = + /", () => {
    const res = parseOsc133("\x1b]133;B;cmd=QUJD/Q==+/\x07");
    expect(res.segments[0].payload).toBe("cmd=QUJD/Q==+/");
  });

  it("trata una secuencia con marcador no soportado como texto", () => {
    const res = parseOsc133("x\x1b]133;D\x07y");
    // byte a byte se conserva y no se produce ningún marcador
    expect(res.segments.map((s) => s.text).join("")).toBe("x\x1b]133;D\x07y");
    expect(res.segments.filter((s) => s.marker)).toHaveLength(0);
  });

  it("deja pasar OSC ajeno al protocolo (p.ej. título OSC 0)", () => {
    const res = parseOsc133("a\x1b]0;title\x07b");
    expect(res.segments).toEqual([text("a\x1b]0;title\x07b")]);
  });

  it("retiene una secuencia válida sin terminador al final", () => {
    const res = parseOsc133("x\x1b]133;B;cmd=QUJD");
    expect(res.segments).toEqual([text("x")]);
    expect(res.remaining).toBe("\x1b]133;B;cmd=QUJD");
  });

  it("retiene una cola que es prefijo partido del prefijo OSC", () => {
    expect(parseOsc133("hola\x1b]").remaining).toBe("hola\x1b]");
    expect(parseOsc133("hola\x1b").remaining).toBe("hola\x1b");
    const tailCase = parseOsc133("hola\x1b]133;");
    expect(tailCase.segments).toEqual([text("hola")]);
    expect(tailCase.remaining).toBe("\x1b]133;");
  });

  it("completa un marcador partido entre chunks", () => {
    const first = parseOsc133("hola\x1b]133;A");
    expect(first.segments).toEqual([text("hola")]);
    expect(first.remaining).toBe("\x1b]133;A");

    const second = parseOsc133(first.remaining + "\x07gi");
    expect(second.segments).toEqual([
      { text: "", marker: "A" },
      text("gi"),
    ]);
    expect(second.remaining).toBe("");
  });

  it("emite como texto una secuencia basura sin terminar antes de otra real", () => {
    const res = parseOsc133("\x1b]133;B;basura\x1b]133;A\x07hola");
    // byte a byte se conserva; el único marcador real es A
    expect(res.segments.map((s) => s.text).join("")).toBe("\x1b]133;B;basurahola");
    expect(res.segments.filter((s) => s.marker).map((s) => s.marker)).toEqual(["A"]);
  });

  it("reconstruye byte a byte todo lo que no es marcador", () => {
    const junk = "\x1b[32mverde\x1b[0m \x1b]133;Q\x07 \x1b]0;tit\x07 fin";
    const res = parseOsc133(junk);
    const joined = res.segments.map((s) => s.text).join("");
    expect(joined).toBe(junk + (res.remaining ?? ""));
  });
});

describe("decodeBase64Utf8", () => {
  it("decodifica comandos con acentos y espacios", () => {
    const encoded = toBase64Utf8('echo "saludo: á é í"');
    expect(decodeBase64Utf8(encoded)).toBe('echo "saludo: á é í"');
  });

  it("decodifica comandos multilínea", () => {
    const encoded = toBase64Utf8("git add .\ngit commit -m x");
    expect(decodeBase64Utf8(encoded)).toBe("git add .\ngit commit -m x");
  });
});