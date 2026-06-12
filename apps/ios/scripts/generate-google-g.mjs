#!/usr/bin/env node
/**
 * Convert the official Google "G" SVG into 1x/2x/3x PNGs for the
 * SocialAuthButton. We render at 20pt base size — that's the size
 * SocialAuthButton actually frames the icon to, so the source pixels
 * exactly match the rendered pixels. Higher-DPI screens get 40pt/60pt
 * variants so the multi-color G doesn't shimmer on Retina.
 *
 * Run from the iOS project root: `node scripts/generate-google-g.mjs`.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const iosRoot = resolve(here, "..");
const apiResvg = resolve(iosRoot, "../api/node_modules/@resvg/resvg-js/index.js");
const { Resvg } = await import(apiResvg);

const svg = readFileSync(resolve(iosRoot, "google-g.svg"), "utf8");
const outDir = resolve(iosRoot, "Linkfit/Resources/Assets.xcassets/GoogleG.imageset");
mkdirSync(outDir, { recursive: true });

const BASE_PT = 20;

for (const scale of [1, 2, 3]) {
  const px = BASE_PT * scale;
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: px },
    background: "rgba(0,0,0,0)", // keep alpha so it works on any button bg
  });
  const png = resvg.render().asPng();
  const suffix = scale === 1 ? "" : `@${scale}x`;
  const outPath = resolve(outDir, `google-g${suffix}.png`);
  writeFileSync(outPath, png);
  console.log(`✅ ${scale}x → ${outPath} (${px}×${px})`);
}

const contents = {
  images: [
    { idiom: "universal", filename: "google-g.png", scale: "1x" },
    { idiom: "universal", filename: "google-g@2x.png", scale: "2x" },
    { idiom: "universal", filename: "google-g@3x.png", scale: "3x" },
  ],
  info: { author: "xcode", version: 1 },
  properties: {
    // template-rendering off — the brand colors MUST be preserved.
    "template-rendering-intent": "original",
  },
};
writeFileSync(resolve(outDir, "Contents.json"), JSON.stringify(contents, null, 2) + "\n");
console.log(`✅ Contents.json → ${outDir}/Contents.json`);
