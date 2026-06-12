import { expect, test } from "@playwright/test";

/**
 * Smoke-level happy path: an admin can log in and land on the dashboard.
 *
 * Assumes the API at NEXT_PUBLIC_API_URL is running and has a seeded admin
 * matching ADMIN_EMAIL / ADMIN_PASSWORD (defaults below mirror the dev seed).
 */
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@linkfit.app";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "AdminPass123!";
const ADMIN_DISPLAY_NAME = process.env.ADMIN_DISPLAY_NAME ?? "Admin";

test.describe("admin login", () => {
  test("logs in and redirects to the dashboard", async ({ page }) => {
    await page.goto("/login");

    // Be lenient about field labels so we don't have to lock the UI agents
    // into one exact wording. Either explicit labels or input types work.
    const emailField = page
      .getByLabel(/email/i)
      .or(page.locator('input[type="email"]'))
      .first();
    const passwordField = page
      .getByLabel(/password/i)
      .or(page.locator('input[type="password"]'))
      .first();

    await emailField.fill(ADMIN_EMAIL);
    await passwordField.fill(ADMIN_PASSWORD);

    const submit = page
      .getByRole("button", { name: /sign in|log in|login/i })
      .first();
    await submit.click();

    // Should land on the dashboard root.
    await page.waitForURL((url) => url.pathname === "/" || url.pathname === "/dashboard", {
      timeout: 15_000,
    });

    // Dashboard should greet the admin somehow — either a "Welcome" banner
    // or the admin's display name in the header. Either is acceptable.
    const greeting = page
      .getByText(/welcome/i)
      .or(page.getByText(new RegExp(ADMIN_DISPLAY_NAME, "i")));

    await expect(greeting.first()).toBeVisible({ timeout: 10_000 });
  });
});
