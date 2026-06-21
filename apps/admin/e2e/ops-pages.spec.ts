import { expect, test, type Page } from "@playwright/test";

/**
 * New ops pages + nav (admin-4) and the full-inventory venue picker (admin-5).
 *
 * Walks the six newly-wired admin screens to confirm they render (no client
 * crash / error boundary) and that their sidebar entries are present. Requires
 * an authenticated session, so it logs in through the UI first. When no live
 * API / seeded admin is reachable, login won't complete and the whole suite is
 * skipped rather than reported as a failure — mirroring login.spec.ts's
 * assumption that the API at NEXT_PUBLIC_API_URL is up with a seeded admin.
 */

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@linkfit.app";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "AdminPass123!";

// The app is served under the /admin basePath; leading-slash gotos resolve
// against the origin and drop it, so prefix every navigation with BASE.
const BASE = process.env.NEXT_PUBLIC_ADMIN_BASE_PATH || "/admin";

// Pages added in admin-4, plus the nav label that should link to each.
const OPS_PAGES: Array<{ path: string; nav: RegExp }> = [
  { path: "/analytics", nav: /analytics/i },
  { path: "/support", nav: /support/i },
  { path: "/moderation", nav: /moderation/i },
  { path: "/promos", nav: /promo/i },
  { path: "/staff", nav: /staff/i },
  { path: "/data-rights", nav: /data rights/i },
];

async function tryLogin(page: Page): Promise<boolean> {
  await page.goto(`${BASE}/login`);
  await page
    .getByLabel(/email/i)
    .or(page.locator('input[type="email"]'))
    .first()
    .fill(ADMIN_EMAIL);
  await page
    .getByLabel(/password/i)
    .or(page.locator('input[type="password"]'))
    .first()
    .fill(ADMIN_PASSWORD);
  await page
    .getByRole("button", { name: /sign in|log in|login/i })
    .first()
    .click();

  try {
    await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

test.describe("new ops pages", () => {
  test.describe.configure({ mode: "serial" });

  let loggedIn = false;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    loggedIn = await tryLogin(page);
    await page.close();
  });

  test.beforeEach(async ({ page }) => {
    test.skip(!loggedIn, "No live API / seeded admin — skipping authenticated ops pages.");
    await tryLogin(page);
  });

  for (const { path, nav } of OPS_PAGES) {
    test(`renders ${path} without a client error`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));

      const res = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
      // Must not be a 4xx/5xx and must not have bounced back to /login.
      expect(res?.status() ?? 200).toBeLessThan(400);
      await expect(page).not.toHaveURL(/\/login(\?|$)/);

      // Sidebar nav entry for this page should be present and link to it.
      const navLink = page.getByRole("link", { name: nav }).first();
      await expect(navLink).toBeVisible({ timeout: 10_000 });

      // No uncaught client exceptions while the page hydrated.
      expect(errors, errors.join("\n")).toEqual([]);
    });
  }

  test("sidebar exposes all six new nav entries together", async ({ page }) => {
    await page.goto(`${BASE}/analytics`, { waitUntil: "domcontentloaded" });
    for (const { nav } of OPS_PAGES) {
      await expect(page.getByRole("link", { name: nav }).first()).toBeVisible();
    }
  });
});
