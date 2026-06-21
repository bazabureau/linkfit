import { expect, test } from "@playwright/test";
import { execSync } from "child_process";

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
  test.beforeAll(async ({ request }) => {
    const dbUrl = "postgres://linkfit:linkfit_dev_password@localhost:5432/linkfit";
    // 0. Clean up any existing stale user and rate limits
    try {
      execSync(`psql "${dbUrl}" -c "TRUNCATE TABLE signup_attempts; DELETE FROM users WHERE email = '${ADMIN_EMAIL}';"`);
    } catch {
      // Ignored
    }

    // 1. Attempt to register the user via the genuine auth register endpoint
    try {
      await request.post("http://localhost:3000/api/v1/auth/register", {
        data: {
          email: ADMIN_EMAIL,
          password: ADMIN_PASSWORD,
          display_name: "Admin Baku Padel",
        },
      });
    } catch {
      // Ignored if already registered
    }

    // 2. Run psql command to elevate role to 'admin' (or partner) and link to 'Padel Center Baku' venue
    try {
      execSync(
        `psql "${dbUrl}" -c "
          UPDATE users
          SET admin_role = 'admin',
              venue_id = (SELECT id FROM venues WHERE name = 'Padel Center Baku' LIMIT 1)
          WHERE email = '${ADMIN_EMAIL}';
        "`
      );
      console.log("Successfully seeded admin user associated with Padel Center Baku.");
    } catch (dbError) {
      console.error("Database seeding failed:", dbError);
    }
  });
  test("logs in and redirects to the dashboard", async ({ page }) => {
    await page.goto("/admin/login");

    // Be lenient about field labels so we don't have to lock the UI agents
    // into one exact wording. Either explicit labels or input types work.
    const emailField = page
      .getByLabel(/email|e-poçt/i)
      .or(page.locator('input[type="email"]'))
      .first();
    const passwordField = page
      .getByLabel(/password|şifrə/i)
      .or(page.locator('input[type="password"]'))
      .first();

    await emailField.fill(ADMIN_EMAIL);
    await passwordField.fill(ADMIN_PASSWORD);

    const submit = page
      .getByRole("button", { name: /daxil ol|sign in|log in|login|giriş/i })
      .first();
    await submit.click();

    // Should land on the dashboard root under basePath /admin
    await page.waitForURL((url) => url.pathname === "/admin" || url.pathname === "/admin/", {
      timeout: 15_000,
    });

    // Dashboard should greet the admin somehow — either a "Welcome/Xoş gəlmisiniz" banner
    // or the admin's display name or "Giriş edilib" in the header. Either is acceptable.
    const greeting = page
      .getByText(/xoş gəlmisiniz|giriş edilib/i)
      .or(page.getByText(new RegExp(ADMIN_DISPLAY_NAME, "i")));

    await expect(greeting.first()).toBeVisible({ timeout: 10_000 });
  });
});
