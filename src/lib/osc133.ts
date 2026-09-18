/**
 * OSC 133 shell integration parser.
 *
 * Splits a raw PTY stream chunk into text segments and OSC 133 markers
 * (A: prompt start, B: command start with optional payload, C: command end).
 * Markers are REMOVED from the text so xterm never sees them; everything else
 * is preserved byte-for-byte.
 *
 * A trailing incomplete sequence (e.g. a marker split across data chunks) is
 * returned in `remaining` and must be prepended to the next chunk by the
 * caller (see TerminalPane).
 */

export type Osc133Marker = "A" | "B" | "C";

export interface Osc133Segment {
  text: string;
  marker?: Osc133Marker;
  payload?: string;
}

export interface Osc133ParseResult {
  segments: Osc133Segment[];
  remaining: string;
}

const OSC133_PREFIX = "\x1b]133;";
const MARKER_CHARS: ReadonlySet<string> = new Set(["A", "B", "C"]);
const BEL = "\x07";
const ST_LEN = 2; // ESC \

/** Guard for an unterminated sequence held in `remaining` that never completes. */
export const MAX_OSC133_TAIL = 4096;

function findTerminator(input: string, from: number): number {
  for (let i = from; i < input.length; i++) {
    if (input[i] === BEL) return i;
    if (input[i] === "\x1b" && input[i + 1] === "\\") return i;
  }
  return -1;
}

/** True if the tail could be the head of a (possibly split) OSC 133 sequence. */
function tailIsPlausibleOscHead(tail: string): boolean {
  const lastEsc = tail.lastIndexOf("\x1b");
  if (lastEsc === -1) return false;
  const suffix = tail.slice(lastEsc);
  return OSC133_PREFIX.startsWith(suffix) || suffix.startsWith(OSC133_PREFIX);
}

/** Decodes the base64 command payload emitted by the fish integration. */
export function decodeBase64Utf8(encoded: string): string {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function parseOsc133(input: string): Osc133ParseResult {
  const segments: Osc133Segment[] = [];
  let cursor = 0;

  while (cursor < input.length) {
    const start = input.indexOf(OSC133_PREFIX, cursor);
    if (start === -1) break;

    const markerPos = start + OSC133_PREFIX.length;
    const marker = input[markerPos];

    if (marker === undefined) {
      // The chunk ends right after the prefix: possible split, hold it.
      if (start > cursor) segments.push({ text: input.slice(cursor, start) });
      return { segments, remaining: input.slice(start) };
    }

    if (!MARKER_CHARS.has(marker)) {
      // Complete prefix but unsupported marker: plain text, keep it intact.
      if (start > cursor) segments.push({ text: input.slice(cursor, start) });
      segments.push({ text: OSC133_PREFIX });
      cursor = start + OSC133_PREFIX.length;
      continue;
    }

    const term = findTerminator(input, markerPos + 1);
    const nextPrefix = input.indexOf(OSC133_PREFIX, markerPos + 1);

    if (term === -1 && nextPrefix === -1) {
      // Valid marker but unterminated at the end of the chunk: possible split.
      if (start > cursor) segments.push({ text: input.slice(cursor, start) });
      return { segments, remaining: input.slice(start) };
    }
    if (term === -1 || (nextPrefix !== -1 && term > nextPrefix)) {
      // Unterminated sequence followed by another one: junk, treat as text.
      if (markerPos + 1 > cursor) {
        segments.push({ text: input.slice(cursor, markerPos + 1) });
      }
      cursor = markerPos + 1;
      continue;
    }

    if (start > cursor) segments.push({ text: input.slice(cursor, start) });
    const raw = input.slice(markerPos + 1, term);
    const payload = raw.startsWith(";") ? raw.slice(1) : undefined;
    segments.push({ text: "", marker: marker as Osc133Marker, payload });
    cursor = input[term] === BEL ? term + 1 : term + ST_LEN;
  }

  const tail = input.slice(cursor);
  if (tail.length > 0 && tailIsPlausibleOscHead(tail)) {
    return { segments, remaining: tail };
  }
  if (tail.length > 0) segments.push({ text: tail });
  return { segments, remaining: "" };
}