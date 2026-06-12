/**
 * SVG → PNG render pipeline shared by all OG cards.
 *
 *   satori     (element tree)       → SVG string
 *   @resvg     (SVG string)         → PNG buffer
 *
 * Satori is dynamically imported so that simply importing the OG module
 * doesn't synchronously pull in WASM at server boot. The font is loaded
 * once and reused (see `font.ts`).
 */
import { type Buffer } from "node:buffer";
import { loadFont } from "./font.js";
import { type SatoriElement } from "./templates.js";

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 630;

type SatoriFn = (
  element: unknown,
  options: {
    width: number;
    height: number;
    fonts: { name: string; data: Buffer; weight?: number; style?: "normal" | "italic" }[];
    embedFont?: boolean;
  },
) => Promise<string>;

type ResvgClass = new (svg: string | Buffer, options?: unknown) => {
    render(): { asPng(): Buffer };
  };

interface SatoriModule {
  default: SatoriFn;
}
interface ResvgModule {
  Resvg: ResvgClass;
}

let satoriPromise: Promise<SatoriFn> | null = null;
let resvgPromise: Promise<ResvgClass> | null = null;

async function getSatori(): Promise<SatoriFn> {
  satoriPromise ??= import("satori").then((m) => (m as unknown as SatoriModule).default);
  return satoriPromise;
}

async function getResvg(): Promise<ResvgClass> {
  resvgPromise ??= import("@resvg/resvg-js").then(
    (m) => (m as unknown as ResvgModule).Resvg,
  );
  return resvgPromise;
}

export async function renderToPng(element: SatoriElement): Promise<Buffer> {
  const [satori, Resvg, font] = await Promise.all([
    getSatori(),
    getResvg(),
    loadFont(),
  ]);

  const svg = await satori(element, {
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    fonts: [
      { name: font.name, data: font.data, weight: 400, style: "normal" },
      { name: font.name, data: font.data, weight: 500, style: "normal" },
      { name: font.name, data: font.data, weight: 600, style: "normal" },
      { name: font.name, data: font.data, weight: 700, style: "normal" },
      { name: font.name, data: font.data, weight: 800, style: "normal" },
    ],
    embedFont: true,
  });

  // resvg falls back to system fonts when needed (the stub font from
  // `font.ts` produces missing-glyph boxes; resvg with `loadSystemFonts`
  // can salvage glyph shapes on the same machine).
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: CANVAS_WIDTH },
    font: {
      loadSystemFonts: true,
      defaultFontFamily: "Inter",
    },
  });
  return resvg.render().asPng();
}
