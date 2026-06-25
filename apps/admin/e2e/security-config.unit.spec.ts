import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Static guards for the admin security + SEO config. These read the committed
 * config/source files (no server needed) so a future edit that weakens the CSP,
 * drops the https assertion, or re-enables crawling fails the suite. Mirrors
 * apps/partner/e2e/security-config.unit.spec.ts so the highest-value panel
 * cannot silently fall behind partner's hardening.
 *
 * Playwright runs specs from the project root, so paths are resolved off cwd.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

test.describe("next.config CSP / security headers", () => {
  const cfg = read("next.config.mjs");

  test("CSP locks default-src, frame-ancestors and object-src down", () => {
    expect(cfg).toContain("default-src 'self'");
    expect(cfg).toContain("frame-ancestors 'none'");
    expect(cfg).toContain("object-src 'none'");
  });

  test("connect-src is limited to self + the API origin", () => {
    expect(cfg).toContain("connect-src 'self'");
    expect(cfg).toContain("apiOrigin");
  });

  test("ships the hardening header set", () => {
    expect(cfg).toContain("X-Content-Type-Options");
    expect(cfg).toContain("X-Frame-Options");
    expect(cfg).toContain("Content-Security-Policy");
    expect(cfg).toContain("Referrer-Policy");
  });
});

test.describe("api.ts https-in-production assertion", () => {
  const api = read("src/lib/api.ts");

  test("throws when NEXT_PUBLIC_API_URL is missing or non-https in prod", () => {
    expect(api).toContain('process.env.NODE_ENV === "production"');
    expect(api).toContain('startsWith("https://")');
    // Build phase is exempted via NEXT_PHASE (set only during `next build`) so
    // the guard never bakes an inlined "true" into the runtime bundle.
    expect(api).toContain("NEXT_PHASE");
  });

  test("app key is read from LINKFIT_APP_KEY with API_KEY fallback", () => {
    expect(api).toContain("NEXT_PUBLIC_LINKFIT_APP_KEY");
    expect(api).toContain("NEXT_PUBLIC_API_KEY");
    expect(api).toContain('"X-Linkfit-App-Key"');
  });
});

test.describe("robots / SEO", () => {
  test("robots.ts disallows all crawling", () => {
    const robots = read("src/app/robots.ts");
    expect(robots).toContain('disallow: "/"');
    expect(robots).toContain('userAgent: "*"');
  });

  test("layout sets noindex metadata + metadataBase", () => {
    const layout = read("src/app/layout.tsx");
    expect(layout).toContain("metadataBase");
    expect(layout).toMatch(/index:\s*false/);
  });
});
