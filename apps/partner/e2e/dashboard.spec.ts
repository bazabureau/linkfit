import { expect, test } from "@playwright/test";
import { execSync } from "child_process";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@linkfit.app";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "AdminPass123!";

test.describe("B2B Partner Dashboard E2E", () => {
  // Ensure the database has an admin user linked to Padel Center Baku before all tests run.
  test.beforeAll(async ({ request }) => {
    const dbUrl = "postgres://linkfit:linkfit_dev_password@localhost:5432/linkfit";
    // 0. Clean up any existing stale user and rate limits
    try {
      execSync(`psql "${dbUrl}" -c "TRUNCATE TABLE signup_attempts; DELETE FROM users WHERE email = '${ADMIN_EMAIL}';"`);
    } catch (e) {
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
    } catch (e) {
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

  // Verify business administrator sign-in and session retention
  test("1. Admin can log in and retain session", async ({ page }) => {
    await page.goto("/admin/login");

    const emailField = page.locator('input[type="email"]');
    const passwordField = page.locator('input[type="password"]');

    await emailField.fill(ADMIN_EMAIL);
    await passwordField.fill(ADMIN_PASSWORD);

    const submit = page.getByRole("button", { name: /daxil ol|sign in|log in|login|giriş/i }).first();
    await submit.click();

    // Verify redirection to dashboard overview
    await page.waitForURL((url) => url.pathname === "/admin" || url.pathname === "/admin/" || url.pathname === "/admin/dashboard", {
      timeout: 15_000,
    });

    // Check greeting
    const welcomeHeading = page.getByText(/xoş gəlmisiniz!/i);
    await expect(welcomeHeading).toBeVisible({ timeout: 10_000 });

    // Session retention: reload page and ensure still logged in (no redirect to login)
    await page.reload();
    await expect(welcomeHeading).toBeVisible({ timeout: 10_000 });
    expect(page.url()).not.toContain("/login");
  });

  // Verify court slot creation, slot availability, and slot cancellation
  test("2. Court slot creation and cancellation", async ({ page }) => {
    // Log in first
    await page.goto("/admin/login");
    await page.locator('input[type="email"]').fill(ADMIN_EMAIL);
    await page.locator('input[type="password"]').fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: /daxil ol|sign in|log in|login|giriş/i }).first().click();
    await page.waitForURL("/admin", { timeout: 10_000 });

    // Navigate to Reservations & Timelines page
    await page.click('a[href="/admin/bookings"]');
    await expect(page.getByText(/Venue Reservations & Timelines/i)).toBeVisible({ timeout: 10_000 });

    // Ensure Visual Calendar is active
    const calendarBtn = page.getByRole("button", { name: /vizual təqvim/i });
    if (await calendarBtn.isVisible()) {
      await calendarBtn.click();
    }

    // Find a free slot ("Rezerv et") and click it
    const freeSlot = page.getByText("Rezerv et").first();
    await expect(freeSlot).toBeVisible({ timeout: 5_000 });
    await freeSlot.click();

    // Fill in walk-in booking details
    await page.getByPlaceholder("Məs. Kamran Namazov").fill("E2E Test Rider");
    await page.getByPlaceholder("Məs. kamran@linkfit.az").fill("e2e.rider@linkfit.az");

    // Submit reservation
    await page.getByRole("button", { name: "Rezervasiyanı Təsdiqlə" }).click();

    // Verify cell shows booked customer name
    const bookedCell = page.getByText("E2E Test Rider").first();
    await expect(bookedCell).toBeVisible({ timeout: 10_000 });

    // Cancel the booking we just created
    const cancelBtn = page.getByRole("button", { name: "Ləğv" }).first();
    await cancelBtn.click();

    // Confirm cancel in dialog
    const confirmCancelBtn = page.getByRole("button", { name: "Təsdiqlə" });
    await confirmCancelBtn.click();

    // Verify slot is empty and back to "Rezerv et"
    await expect(page.getByText("E2E Test Rider")).not.toBeVisible({ timeout: 5_000 });
  });

  // Verify pricing adjustment and instant schedule updates
  test("3. Pricing adjustment and instant schedule updates", async ({ page }) => {
    // Log in
    await page.goto("/admin/login");
    await page.locator('input[type="email"]').fill(ADMIN_EMAIL);
    await page.locator('input[type="password"]').fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: /daxil ol|sign in|log in|login|giriş/i }).first().click();
    await page.waitForURL("/admin", { timeout: 10_000 });

    // Navigate to Courts page
    await page.click('a[href="/admin/courts"]');
    await expect(page.getByText(/My Courts/i)).toBeVisible({ timeout: 10_000 });

    // Edit the first court
    const editBtn = page.locator("table button").first();
    await editBtn.click();

    // Change hourly price to 75.00
    const priceInput = page.locator("#court-price");
    await priceInput.clear();
    await priceInput.fill("75.00");

    // Save changes
    await page.getByRole("button", { name: "Yadda Saxla" }).click();

    // Verify updated price in table
    await expect(page.getByText("75.00 AZN")).toBeVisible({ timeout: 10_000 });

    // Navigate to Reservations page and check scheduler headers
    await page.click('a[href="/admin/bookings"]');
    await page.waitForTimeout(1000); // Wait for transition/query fetch

    // Visual Calendar should display the updated court price
    await expect(page.getByText("75.00 AZN/saat")).toBeVisible({ timeout: 10_000 });
  });

  // Verify transactional dashboard revenue statistics rendering correctly
  test("4. Dashboard revenue statistics render correctly", async ({ page }) => {
    // Log in
    await page.goto("/admin/login");
    await page.locator('input[type="email"]').fill(ADMIN_EMAIL);
    await page.locator('input[type="password"]').fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: /daxil ol|sign in|log in|login|giriş/i }).first().click();
    await page.waitForURL("/admin", { timeout: 10_000 });

    // Navigate to bookings page to create a PAID slot
    await page.click('a[href="/admin/bookings"]');
    
    // Create new walk-in slot
    const freeSlot = page.getByText("Rezerv et").first();
    await freeSlot.click();
    await page.getByPlaceholder("Məs. Kamran Namazov").fill("Revenue Contributor");
    await page.getByPlaceholder("Məs. kamran@linkfit.az").fill("rev.contrib@linkfit.az");
    await page.getByRole("button", { name: "Rezervasiyanı Təsdiqlə" }).click();

    // Wait for the booking cell to be visible
    const cell = page.getByText("Revenue Contributor").first();
    await expect(cell).toBeVisible({ timeout: 10_000 });

    // Click "Ödə" (Mark Paid) to transition booking to PAID
    const payBtn = page.getByRole("button", { name: "Ödə" }).first();
    await payBtn.click();

    // Confirm Payment
    const confirmPayBtn = page.getByRole("button", { name: "Ödənişi Təsdiqlə" });
    await confirmPayBtn.click();

    // Verify the cell turns into paid state (badge success / paid)
    await expect(page.getByText("Paid").first()).toBeVisible({ timeout: 10_000 });

    // Navigate back to overview page
    await page.click('a[href="/admin"]');

    // Revenue KPI should now display a positive amount and not "0.00 AZN" or "0"
    const totalRevenueKpi = page.locator("div").getByText(/Ümumi Gəlir/i).locator("xpath=../..");
    await expect(totalRevenueKpi).not.toContainText("0.00 AZN");
  });

  // Negative validation tests: form validation boundaries
  test("5. Negative input validation and error boundaries", async ({ page }) => {
    // Log in
    await page.goto("/admin/login");
    await page.locator('input[type="email"]').fill(ADMIN_EMAIL);
    await page.locator('input[type="password"]').fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: /daxil ol|sign in|log in|login|giriş/i }).first().click();
    await page.waitForURL("/admin", { timeout: 10_000 });

    // Navigate to Courts page
    await page.click('a[href="/admin/courts"]');

    // Click "Kort Əlavə Et"
    await page.getByRole("button", { name: "Kort Əlavə Et" }).click();

    // Input negative price
    await page.locator("#court-name").fill("Invalid Court");
    await page.locator("#court-sport").selectOption({ index: 1 });
    await page.locator("#court-price").fill("-10.00");

    // Click Save
    await page.getByRole("button", { name: "Yadda Saxla" }).click();

    // Verify error toast
    await expect(page.getByText(/düzgün qiymət daxil edin/i)).toBeVisible({ timeout: 10_000 });
  });
});
