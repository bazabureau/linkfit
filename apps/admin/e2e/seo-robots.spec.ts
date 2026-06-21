import { expect, test } from "@playwright/test";

/**
 * SEO / a11y hardening (admin-6).
 *
 * The admin panel is internet-facing and must never be indexed. Two independent
 * guards are asserted:
 *   1. app/robots.ts emits robots.txt with `Disallow: /`.
 *   2. layout.tsx Metadata sets robots:{index:false,follow:false} → a
 *      `<meta name="robots" content="noindex, nofollow">` on rendered pages.
 *
 * Needs only the dev server (no API). The app runs under the `/admin` basePath,
 * so robots.txt is emitted at <origin>/admin/robots.txt and navigable pages
 * must be prefixed with BASE.
 */

const BASE = process.env.NEXT_PUBLIC_ADMIN_BASE_PATH || "/admin";

test.describe("robots / noindex", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("robots.txt disallows all crawlers", async ({ request, baseURL }) => {
    const origin = new URL(baseURL ?? "http://localhost:3100").origin;
    const res = await request.get(`${origin}${BASE}/robots.txt`);
    expect(res.ok()).toBeTruthy();
    const body = (await res.text()).toLowerCase();
    expect(body).toContain("user-agent: *");
    expect(body).toContain("disallow: /");
  });

  test("login page carries a noindex robots meta tag", async ({ page }) => {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    const robotsMeta = page.locator('meta[name="robots"]');
    // Next may emit more than one robots meta; at least one must say noindex.
    await expect(robotsMeta.first()).toHaveCount(1);
    const contents = (await robotsMeta.evaluateAll((els) =>
      els.map((e) => (e.getAttribute("content") ?? "").toLowerCase()),
    )) as string[];
    expect(contents.some((c) => c.includes("noindex"))).toBe(true);
    expect(contents.some((c) => c.includes("nofollow"))).toBe(true);
  });
});
