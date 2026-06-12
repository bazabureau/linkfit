#!/usr/bin/env node
/**
 * iOS asset pipeline — convert `appicon.svg` into the PNG assets Xcode
 * needs, without bringing in heavyweight image tooling. We reuse the
 * `@resvg/resvg-js` rasterizer that the API project already depends on
 * for OG-image rendering, so this script "just works" from a fresh
 * `npm install` in `apps/api`.
 *
 * Outputs (relative to `apps/ios/`):
 *
 *   Linkfit/Resources/Assets.xcassets/AppIcon.appiconset/icon-1024.png
 *     — 1024×1024 RGB PNG (no alpha) per App Store requirements.
 *       Logo centered on a dark-green background that complements
 *       the brand's lime accent.
 *
 *   Linkfit/Resources/Assets.xcassets/Background.imageset/background@{1,2,3}x.png
 *     — 1242×2688 (iPhone Pro Max) at three scales. Logo subtly
 *       repeated as a watermark over a cream background; iOS scales
 *       this to whatever device size SwiftUI requests.
 *
 * Usage from repo root:
 *   node apps/ios/scripts/generate-icons.mjs
 *
 * Re-runnable safely — every output is overwritten on each invocation.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const iosRoot = resolve(here, "..");
// Point at the index.js entry directly — Node ESM doesn't auto-resolve
// a bare directory the way CommonJS did.
const apiResvg = resolve(iosRoot, "../api/node_modules/@resvg/resvg-js/index.js");

const { Resvg } = await import(apiResvg);

const srcSvgPath = resolve(iosRoot, "appicon.svg");
const srcSvg = readFileSync(srcSvgPath, "utf8");

// Strip the outer <svg> tag so we can re-wrap inside a sized canvas.
// The source viewBox is "0 0 116 60" — we keep the inner <path> markup
// and project it into a new viewBox below.
const inner = srcSvg
  .replace(/^[\s\S]*?<svg[^>]*>/i, "")
  .replace(/<\/svg>\s*$/i, "");

// ── App icon: 1024×1024 RGB, no alpha ─────────────────────────────────
// Dark forest-green background (#0F2E1E) complements the lime accent
// without clashing with the cream logo. Logo sized to ~62% of the
// canvas width — Apple's HIG suggests leaving generous breathing room
// because iOS applies its own rounded-rect mask.
const ICON_SIZE = 1024;
const LOGO_NATIVE_W = 116;
const LOGO_NATIVE_H = 60;
const LOGO_TARGET_W = ICON_SIZE * 0.62;
const LOGO_SCALE = LOGO_TARGET_W / LOGO_NATIVE_W;
const LOGO_TARGET_H = LOGO_NATIVE_H * LOGO_SCALE;
const LOGO_X = (ICON_SIZE - LOGO_TARGET_W) / 2;
const LOGO_Y = (ICON_SIZE - LOGO_TARGET_H) / 2;

const appIconSvg = `<svg width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${ICON_SIZE}" height="${ICON_SIZE}" fill="#0F2E1E"/>
  <g transform="translate(${LOGO_X} ${LOGO_Y}) scale(${LOGO_SCALE})">
    ${inner}
  </g>
</svg>`;

function rasterize(svgString, width) {
  const resvg = new Resvg(svgString, {
    fitTo: { mode: "width", value: width },
    // Background is opaque inside the svg already — but we also explicitly
    // disable the alpha channel because App Store rejects PNGs with one.
    background: "rgba(255,255,255,0)",
  });
  return resvg.render().asPng();
}

const appIconPng = rasterize(appIconSvg, ICON_SIZE);
const appIconOut = resolve(
  iosRoot,
  "Linkfit/Resources/Assets.xcassets/AppIcon.appiconset/icon-1024.png",
);
writeFileSync(appIconOut, appIconPng);

// Strip alpha channel — App Store Connect rejects icon PNGs with one.
// resvg-js always emits RGBA; ImageMagick flattens onto the brand bg.
// If `magick` isn't installed (CI without homebrew), we leave the RGBA
// output in place and let TestFlight upload reject it with a useful
// error rather than failing the script silently.
try {
  execFileSync("magick", [
    appIconOut,
    "-background", "#0F2E1E",
    "-alpha", "remove",
    "-alpha", "off",
    "-type", "TrueColor",
    `PNG24:${appIconOut}`,
  ], { stdio: "pipe" });
  console.log(`✅ App icon → ${appIconOut} (alpha stripped, App Store ready)`);
} catch {
  console.warn(`⚠️  App icon → ${appIconOut} (RGBA — install ImageMagick to strip alpha for App Store)`);
}

// ── Background image: cream canvas with logo watermark ────────────────
// Sized at iPhone 17 Pro Max's portrait pixel resolution (1320×2868),
// which is the largest target — SwiftUI will downscale for everything
// else. We render at 1x / 2x / 3x so the asset catalog can hand the
// runtime whichever density it asks for.
const BG_BASE_W = 440;
const BG_BASE_H = 956;
const SCALES = [1, 2, 3];

function buildBackgroundSvg(scale) {
  const w = BG_BASE_W * scale;
  const h = BG_BASE_H * scale;
  // Two logos staggered diagonally — subtle, low-contrast watermark.
  const logoW = w * 0.7;
  const logoScale = logoW / LOGO_NATIVE_W;
  const cx = (w - logoW) / 2;
  const cy = h * 0.18;
  const cy2 = h * 0.62;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${w}" height="${h}" fill="#F7F2EC"/>
    <g opacity="0.10" transform="translate(${cx} ${cy}) scale(${logoScale})" style="filter: brightness(0.4);">
      ${inner}
    </g>
    <g opacity="0.07" transform="translate(${cx} ${cy2}) scale(${logoScale * 0.9}) rotate(-8 ${LOGO_NATIVE_W / 2} ${LOGO_NATIVE_H / 2})" style="filter: brightness(0.4);">
      ${inner}
    </g>
  </svg>`;
}

for (const scale of SCALES) {
  const svg = buildBackgroundSvg(scale);
  const png = rasterize(svg, BG_BASE_W * scale);
  const suffix = scale === 1 ? "" : `@${scale}x`;
  const out = resolve(
    iosRoot,
    `Linkfit/Resources/Assets.xcassets/Background.imageset/background${suffix}.png`,
  );
  writeFileSync(out, png);
  console.log(`✅ Background ${scale}x → ${out} (${png.length} bytes)`);
}

// ── Background.imageset/Contents.json ─────────────────────────────────
const bgContents = {
  images: [
    { idiom: "universal", filename: "background.png", scale: "1x" },
    { idiom: "universal", filename: "background@2x.png", scale: "2x" },
    { idiom: "universal", filename: "background@3x.png", scale: "3x" },
  ],
  info: { author: "xcode", version: 1 },
};
const bgContentsPath = resolve(
  iosRoot,
  "Linkfit/Resources/Assets.xcassets/Background.imageset/Contents.json",
);
writeFileSync(bgContentsPath, JSON.stringify(bgContents, null, 2) + "\n");
console.log(`✅ Background Contents.json → ${bgContentsPath}`);
