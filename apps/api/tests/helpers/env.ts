import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Env } from "../../src/shared/config/env.js";

/**
 * Canonical env used in integration tests. Rate limits are set high enough
 * that suites can hammer endpoints without spurious 429s; secrets are
 * dev-only strings.
 *
 * Each call mints a unique `UPLOAD_DIR` so attachment tests can't collide
 * across runs (and the tmp dir disappears with the OS reaper).
 */
export function buildTestEnv(): Env {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("TEST_DATABASE_URL must be set by tests/setup/globalSetup.ts");
  }
  return {
    NODE_ENV: "test",
    PORT: 0,
    HOST: "127.0.0.1",
    DATABASE_URL: databaseUrl,
    LOG_LEVEL: "silent",
    CORS_ORIGINS: ["http://localhost:3000"],
    JWT_ACCESS_SECRET: "x".repeat(32),
    JWT_REFRESH_SECRET: "y".repeat(32),
    JWT_ACCESS_TTL_SECONDS: 900,
    JWT_REFRESH_TTL_DAYS: 30,
    RATE_LIMIT_MAX: 10_000,
    RATE_LIMIT_WINDOW_SECONDS: 60,
    AUTH_RATE_LIMIT_MAX: 10_000,
    AUTH_RATE_LIMIT_WINDOW_SECONDS: 60,
    // Trust & safety thresholds — relaxed in the shared test env so the
    // hundred-odd suites that spin up >5 fixtures per case don't trip
    // the production-default IP limit. The dedicated `auth-spam.test.ts`
    // suite builds its own env with the production-default values so
    // boundary behavior is still covered.
    // PostHog opt-out by default in tests — empty API key disables the
    // SDK (see analytics.ts initAnalytics). Host stays at the public
    // endpoint so any non-empty API key in CI smoke jobs still routes
    // somewhere sane instead of a default fallback.
    POSTHOG_HOST: "https://app.posthog.com",
    SMTP_PORT: 587,
    MAIL_FROM: "no-reply@linkfit.app",
    OAUTH_APPLE_CLIENT_IDS: ["az.linkfit.app"],
    OAUTH_GOOGLE_CLIENT_IDS: [
      "655337821050-pi74ppu4gjv7b0gs0v417djtndrl7nt2.apps.googleusercontent.com",
    ],
    SIGNUP_RATE_LIMIT_PER_DAY: 10_000,
    FOLLOW_BURST_THRESHOLD: 10_000,
    FOLLOW_BURST_WINDOW_SEC: 60,
    FEATURE_BOOKINGS: true,
    PUBLIC_BASE_URL: "http://127.0.0.1",
    UPLOAD_DIR: mkdtempSync(join(tmpdir(), "linkfit-uploads-test-")),
    // APNs creds intentionally omitted — server.ts falls back to LoggingSender.
    APNS_USE_SANDBOX: false,
    // Stripe — test-mode placeholders are sufficient because the
    // payments module accepts a `StripeGateway` interface that tests
    // replace with a fake sender. The real Stripe SDK is never invoked.
    STRIPE_SECRET_KEY: "sk_test_dummy",
    STRIPE_WEBHOOK_SECRET: "whsec_test_dummy",
    // Metrics endpoint credentials — only used by suites that hit
    // /metrics directly; weak values are fine because the server is
    // bound to 127.0.0.1 during tests.
    METRICS_USER: "metrics",
    METRICS_PASSWORD: "metrics-test-password",
    // iOS app-version gate — public `/api/v1/app/version` endpoint reads
    // these. Values mirror the env.ts defaults; suites that assert on the
    // exact payload override per-test.
    IOS_LATEST_BUILD: 1,
    IOS_LATEST_VERSION: "1.0.0",
    IOS_MIN_SUPPORTED_BUILD: 1,
    IOS_FORCE_UPDATE: false,
    IOS_RELEASE_NOTES_URL: "https://linkfit.app/releases/ios/1.0.0",
    // App metadata — public `/api/v1/app/metadata` endpoint reads these.
    // Values mirror the env.ts defaults; suites that assert on the exact
    // payload override per-test.
    APP_SUPPORT_EMAIL: "support@linkfit.app",
    APP_PRIVACY_POLICY_URL: "https://linkfit.app/privacy",
    APP_TERMS_URL: "https://linkfit.app/terms",
    APP_INSTAGRAM_URL: "https://instagram.com/linkfit.app",
    APP_TIKTOK_URL: "https://tiktok.com/@linkfit.app",
    APP_COMPANY_NAME: "Linkfit",
    APP_COMPANY_ADDRESS: "Baku, Azerbaijan",
    // Azerbaijan-market defaults — Manat currency, Baku timezone, Azerbaijani
    // locale. Surfaced via `/api/v1/app/metadata`; suites that assert on the
    // exact payload override per-test.
    APP_DEFAULT_CURRENCY: "AZN",
    APP_DEFAULT_TIMEZONE: "Asia/Baku",
    APP_DEFAULT_LOCALE: "az",
  };
}
