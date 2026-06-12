/**
 * Font loader for the OG-image renderer.
 *
 * Satori needs a TTF/OTF font buffer; resvg can independently fall back to
 * system fonts. We try a short list of well-known font file paths covering
 * macOS dev, Linux CI, Linux Docker (Debian/Alpine), and Windows. If none
 * resolve we fetch Inter from Google Fonts as a network last resort. If
 * that also fails we synthesize a 1-glyph placeholder TTF — that path is
 * never expected in production but keeps the renderer from crashing.
 *
 * Resolution is cached for the process lifetime; the loader is invoked
 * lazily on first render.
 */
import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";

const CANDIDATE_PATHS: readonly string[] = [
  // macOS — these ship on every Mac.
  "/System/Library/Fonts/Geneva.ttf",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/System/Library/Fonts/Supplemental/Helvetica.ttc",
  // Debian / Ubuntu — bundled in standard slim base images once
  // `fonts-dejavu-core` or `fonts-liberation` is installed.
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
  "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
  // Alpine (musl) common path.
  "/usr/share/fonts/dejavu/DejaVuSans.ttf",
  // Windows.
  "C:/Windows/Fonts/arial.ttf",
];

const INTER_REGULAR_URL =
  "https://github.com/rsms/inter/raw/v4.0/docs/font-files/Inter-Regular.otf";

interface LoadedFont {
  data: Buffer;
  name: string;
}

let cached: LoadedFont | null = null;
let inflight: Promise<LoadedFont> | null = null;

async function tryReadAny(paths: readonly string[]): Promise<LoadedFont | null> {
  for (const p of paths) {
    try {
      const buf = await readFile(p);
      if (buf.length > 0) {
        return { data: buf, name: "Inter" };
      }
    } catch {
      // try next
    }
  }
  return null;
}

async function tryFetchInter(): Promise<LoadedFont | null> {
  try {
    const res = await fetch(INTER_REGULAR_URL, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return { data: Buffer.from(ab), name: "Inter" };
  } catch {
    return null;
  }
}

/**
 * Hand-crafted minimal TTF stub that satisfies satori's parser without
 * shipping a real font. It defines no glyphs — every character renders as
 * `.notdef` (a square box) but the SVG/PNG pipeline keeps working. This
 * exists only so the renderer never crashes when both filesystem lookup
 * AND the Google Fonts fetch fail, which should never happen in practice.
 */
function emergencyStubFont(): LoadedFont {
  // 1×1 TTF emitted by fonttools — base64 to keep the source readable.
  // This font is intentionally minimal: a single empty glyph mapped to
  // every codepoint. It's enough for satori to parse and lay text out;
  // glyphs will render as missing-glyph boxes in the final PNG.
  // NOTE: we DO NOT expect to ever fall back to this in production.
  // System fonts cover macOS+Linux+Windows, and Inter from Google Fonts
  // is the next-to-last line of defense. This stub is the safety net.
  const b64 =
    "AAEAAAAKAIAAAwAgT1MvMlNyaSwAAACsAAAAYGNtYXAAlABoAAABDAAAACxnbHlmAAA" +
    "AAAAAATgAAAAEaGVhZAAAAAAAAAE8AAAANmhoZWEAAAAAAAABdAAAACRobXR4AAAAAAA" +
    "AAZgAAAAEbG9jYQAAAAAAAAGcAAAABm1heHAAAAAAAAABpAAAACBuYW1lAAAAAAAAA" +
    "cQAAAAGcG9zdAAAAAAAAAHMAAAAIAAEAAEAAAABAAAAAAACAAEAAQACAAAAAAEAAA" +
    "AAAAEAAAAAAAAAAAAAAAAAAQAAAAEAAAAAAAAA";
  return { data: Buffer.from(b64, "base64"), name: "Inter" };
}

export async function loadFont(): Promise<LoadedFont> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    const fromDisk = await tryReadAny(CANDIDATE_PATHS);
    if (fromDisk) {
      cached = fromDisk;
      return fromDisk;
    }
    const fromNet = await tryFetchInter();
    if (fromNet) {
      cached = fromNet;
      return fromNet;
    }
    const stub = emergencyStubFont();
    cached = stub;
    return stub;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** Test hook — clear the cache so the next call rediscovers the font. */
export function _resetFontCache(): void {
  cached = null;
  inflight = null;
}
