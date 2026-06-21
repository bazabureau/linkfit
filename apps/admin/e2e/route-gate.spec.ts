import { expect, test } from "@playwright/test";

/**
 * Route-auth gate (admin-2).
 *
 * The edge proxy (src/proxy.ts, `export proxy` — the Next 16 file convention)
 * redirects any request without the `lf_admin_access` cookie to /login. These
 * tests need only the dev server; no API or credentials are required, so they
 * are the most reliable signal that the gate is actually wired into the build.
 *
 * The app is served under the `/admin` basePath, so every navigable URL must
 * carry that prefix. A leading-slash path passed to page.goto() is resolved
 * against the ORIGIN (dropping any basePath in baseURL), so we prefix paths
 * with BASE explicitly. The proxy itself sees basePath-stripped paths.
 */

const BASE = process.env.NEXT_PUBLIC_ADMIN_BASE_PATH || "/admin";

// Protected dashboard routes — a clean (cookie-less) context must be bounced.
const PROTECTED_PATHS = [
  "/",
  "/analytics",
  "/users",
  "/venues",
  "/bookings",
  "/promos",
  "/support",
  "/moderation",
  "/staff",
  "/data-rights",
];

test.describe("route-auth gate", () => {
  // Run with a guaranteed-empty cookie jar.
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const path of PROTECTED_PATHS) {
    test(`redirects unauthenticated ${path} → /login`, async ({ page }) => {
      const res = await page.goto(`${BASE}${path === "/" ? "" : path}`, {
        waitUntil: "domcontentloaded",
      });
      // We should end up on the login page regardless of how many hops it took.
      await expect(page).toHaveURL(/\/login(\?|$)/);
      // And the gate should preserve where we were heading via ?from=.
      if (path !== "/") {
        expect(page.url()).toContain("from=");
      }
      // Final response must not be an error page.
      expect(res?.status() ?? 200).toBeLessThan(400);
    });
  }

  test("the login page itself is reachable without a cookie", async ({ page }) => {
    const res = await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    expect(res?.status() ?? 200).toBeLessThan(400);
    await expect(page).toHaveURL(/\/login(\?|$)/);
    // Login form should render (email + password fields).
    await expect(
      page.getByLabel(/email/i).or(page.locator('input[type="email"]')).first(),
    ).toBeVisible();
  });
});
