import { describe, it, expect } from "vitest";
import { EnvValidationError, loadEnv } from "./env.js";

const valid: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  PORT: "4000",
  HOST: "127.0.0.1",
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  LOG_LEVEL: "info",
  CORS_ORIGINS: "http://localhost:3000,http://localhost:5173",
  JWT_ACCESS_SECRET: "x".repeat(32),
  JWT_REFRESH_SECRET: "y".repeat(32),
  JWT_ACCESS_TTL_SECONDS: "900",
  JWT_REFRESH_TTL_DAYS: "30",
  RATE_LIMIT_MAX: "300",
  RATE_LIMIT_WINDOW_SECONDS: "60",
};

describe("env loader", () => {
  it("parses a fully valid environment", () => {
    const env = loadEnv(valid);
    expect(env.NODE_ENV).toBe("test");
    expect(env.PORT).toBe(4000);
    expect(env.CORS_ORIGINS).toEqual([
      "http://localhost:3000",
      "http://localhost:5173",
    ]);
  });

  it("throws EnvValidationError listing every missing required key", () => {
    expect(() => loadEnv({})).toThrow(EnvValidationError);
    try {
      loadEnv({});
    } catch (err) {
      const e = err as EnvValidationError;
      const paths = e.issues.map((i) => i.path.join("."));
      expect(paths).toContain("DATABASE_URL");
      expect(paths).toContain("JWT_ACCESS_SECRET");
      expect(paths).toContain("JWT_REFRESH_SECRET");
    }
  });

  it("rejects DATABASE_URL that is not postgres://", () => {
    expect(() =>
      loadEnv({ ...valid, DATABASE_URL: "mysql://u:p@localhost:3306/db" }),
    ).toThrow(/postgres/);
  });

  it("rejects PORT that is not a positive integer", () => {
    expect(() => loadEnv({ ...valid, PORT: "abc" })).toThrow(/PORT/);
    expect(() => loadEnv({ ...valid, PORT: "-1" })).toThrow(/PORT/);
  });

  it("rejects too-short JWT secrets", () => {
    expect(() =>
      loadEnv({ ...valid, JWT_ACCESS_SECRET: "tooshort" }),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });

  it("treats CORS_ORIGINS as a trim-aware, empty-tolerant CSV list", () => {
    const env = loadEnv({
      ...valid,
      CORS_ORIGINS: "  http://a.com  ,, http://b.com ,",
    });
    expect(env.CORS_ORIGINS).toEqual(["http://a.com", "http://b.com"]);

    const empty = loadEnv({ ...valid, CORS_ORIGINS: "" });
    expect(empty.CORS_ORIGINS).toEqual([]);
  });

  it("applies sensible defaults when optional knobs are omitted", () => {
    // Strip every key with a default: PORT, HOST, LOG_LEVEL, CORS_ORIGINS,
    // RATE_LIMIT_*, AUTH_RATE_LIMIT_*, FEATURE_BOOKINGS, APNS_USE_SANDBOX,
    // UPLOAD_DIR. JWT secrets are still required.
    const env = loadEnv({
      DATABASE_URL: "postgres://u:p@localhost:5432/db",
      JWT_ACCESS_SECRET: "x".repeat(32),
      JWT_REFRESH_SECRET: "y".repeat(32),
    });
    expect(env.NODE_ENV).toBe("development");
    expect(env.PORT).toBe(3000);
    expect(env.HOST).toBe("0.0.0.0");
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.RATE_LIMIT_MAX).toBe(300);
    expect(env.REQUIRE_API_KEY).toBe(false);
    expect(env.APP_PUBLIC_API_KEYS).toEqual([]);
    expect(env.APP_PUBLIC_API_KEY_HASHES).toEqual([]);
    expect(env.AUTH_RATE_LIMIT_MAX).toBe(10);
    expect(env.FEATURE_BOOKINGS).toBe(false);
    expect(env.APNS_USE_SANDBOX).toBe(false);
    expect(env.SMTP_PORT).toBe(587);
    expect(env.MAIL_FROM).toBe("no-reply@linkfit.app");
    expect(env.OAUTH_APPLE_CLIENT_IDS).toEqual(["az.linkfit.app"]);
    expect(env.OAUTH_GOOGLE_CLIENT_IDS).toEqual([
      "655337821050-pi74ppu4gjv7b0gs0v417djtndrl7nt2.apps.googleusercontent.com",
    ]);
    // UPLOAD_DIR has a default — exists but is opinionated.
    expect(env.UPLOAD_DIR.length).toBeGreaterThan(0);
  });

  it("rejects PORT above the 65535 ceiling", () => {
    expect(() => loadEnv({ ...valid, PORT: "70000" })).toThrow(/PORT/);
  });

  it("coerces APNS_USE_SANDBOX correctly and rejects invalid values", () => {
    expect(loadEnv({ ...valid, APNS_USE_SANDBOX: "true" }).APNS_USE_SANDBOX).toBe(true);
    expect(loadEnv({ ...valid, APNS_USE_SANDBOX: "false" }).APNS_USE_SANDBOX).toBe(false);
    expect(() =>
      loadEnv({ ...valid, APNS_USE_SANDBOX: "yes" }),
    ).toThrow(EnvValidationError);
  });

  it("parses OAuth client ID CSVs with stable de-duplication", () => {
    const env = loadEnv({
      ...valid,
      OAUTH_APPLE_CLIENT_IDS: "az.linkfit.app, com.example.debug, az.linkfit.app",
      OAUTH_GOOGLE_CLIENT_IDS: "google-ios, google-web, google-ios",
    });
    expect(env.OAUTH_APPLE_CLIENT_IDS).toEqual([
      "az.linkfit.app",
      "com.example.debug",
    ]);
    expect(env.OAUTH_GOOGLE_CLIENT_IDS).toEqual(["google-ios", "google-web"]);
  });

  it("treats blank optional SMTP and public URL settings as unset", () => {
    const env = loadEnv({
      ...valid,
      SMTP_HOST: "",
      SMTP_USER: " ",
      SMTP_PASS: "",
      SMTP_PORT: "",
      PUBLIC_BASE_URL: "",
      PUBLIC_APP_URL: "",
      OAUTH_GOOGLE_CLIENT_IDS: "",
      SENTRY_DSN: "",
      SENTRY_RELEASE: "",
      MEDICAL_ENCRYPTION_KEY: "",
    });
    expect(env.SMTP_HOST).toBeUndefined();
    expect(env.SMTP_USER).toBeUndefined();
    expect(env.SMTP_PASS).toBeUndefined();
    expect(env.SMTP_PORT).toBe(587);
    expect(env.PUBLIC_BASE_URL).toBeUndefined();
    expect(env.PUBLIC_APP_URL).toBeUndefined();
    expect(env.SENTRY_DSN).toBeUndefined();
    expect(env.SENTRY_RELEASE).toBeUndefined();
    expect(env.MEDICAL_ENCRYPTION_KEY).toBeUndefined();
    expect(env.OAUTH_GOOGLE_CLIENT_IDS).toEqual([
      "655337821050-pi74ppu4gjv7b0gs0v417djtndrl7nt2.apps.googleusercontent.com",
    ]);
  });

  it("rejects partial SMTP configuration", () => {
    expect(() =>
      loadEnv({
        ...valid,
        SMTP_HOST: "smtp.example.com",
        SMTP_USER: "mailer",
      }),
    ).toThrow(/SMTP_HOST, SMTP_USER, and SMTP_PASS/);
  });

  it("rejects partial APNs configuration", () => {
    expect(() =>
      loadEnv({
        ...valid,
        APNS_KEY_ID: "ABC123DEFG",
        APNS_TEAM_ID: "TEAM123456",
      }),
    ).toThrow(/APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, and APNS_AUTH_KEY/);
  });

  it("rejects OAuth client ID CSVs that resolve to no values", () => {
    expect(() =>
      loadEnv({ ...valid, OAUTH_APPLE_CLIENT_IDS: ", , ," }),
    ).toThrow(/OAUTH_APPLE_CLIENT_IDS/);
  });

  // ── Production-only invariants ─────────────────────────────────────
  // These guards run after Zod parsing when NODE_ENV=production. They
  // reject placeholder secrets that would otherwise let the API serve
  // real users with dev-grade credentials.

  const prodBase: NodeJS.ProcessEnv = {
    ...valid,
    NODE_ENV: "production",
    JWT_ACCESS_SECRET: "a".repeat(40),
    JWT_REFRESH_SECRET: "b".repeat(40),
    STRIPE_SECRET_KEY: "sk_live_real_key",
    STRIPE_WEBHOOK_SECRET: "whsec_real",
    STRIPE_MEMBERSHIP_PLUS_PRICE_ID: "price_plus",
    STRIPE_MEMBERSHIP_PREMIUM_PRICE_ID: "price_premium",
    METRICS_PASSWORD: "real-strong-password",
    CORS_ORIGINS: "https://app.linkfit.app",
    PUBLIC_BASE_URL: "https://api.linkfit.app",
    PUBLIC_APP_URL: "https://linkfit.app",
    APNS_KEY_ID: "ABC123DEFG",
    APNS_TEAM_ID: "TEAM123456",
    APNS_BUNDLE_ID: "az.linkfit.app",
    APNS_AUTH_KEY: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----",
    MEDICAL_ENCRYPTION_KEY: "a".repeat(64),
    SMTP_HOST: "smtp.linkfit.app",
    SMTP_USER: "mailer",
    SMTP_PASS: "smtp-secret",
    REQUIRE_API_KEY: "true",
    APP_PUBLIC_API_KEYS: "",
    APP_PUBLIC_API_KEY_HASHES: "a".repeat(64),
  };

  it("accepts a properly-configured production environment", () => {
    expect(() => loadEnv(prodBase)).not.toThrow();
  });

  it("rejects placeholder Stripe secret key in production", () => {
    expect(() =>
      loadEnv({ ...prodBase, STRIPE_SECRET_KEY: "sk_test_dummy" }),
    ).toThrow(/Stripe secret key/);
    expect(() =>
      loadEnv({ ...prodBase, STRIPE_SECRET_KEY: "sk_live_dummy" }),
    ).toThrow(/Stripe secret key/);
  });

  it("rejects non-live Stripe secret keys in production", () => {
    expect(() =>
      loadEnv({ ...prodBase, STRIPE_SECRET_KEY: "sk_test_real_key" }),
    ).toThrow(/non-live Stripe secret key/);
  });

  it("rejects placeholder Stripe webhook secret in production", () => {
    expect(() =>
      loadEnv({ ...prodBase, STRIPE_WEBHOOK_SECRET: "whsec_test_dummy" }),
    ).toThrow(/Stripe webhook secret/);
    expect(() =>
      loadEnv({ ...prodBase, STRIPE_WEBHOOK_SECRET: "whsec_live_dummy" }),
    ).toThrow(/Stripe webhook secret/);
  });

  it("rejects missing membership Stripe Price IDs in production with real Stripe keys", () => {
    expect(() =>
      loadEnv({ ...prodBase, STRIPE_MEMBERSHIP_PLUS_PRICE_ID: "" }),
    ).toThrow(/Plus membership price id/);
    expect(() =>
      loadEnv({ ...prodBase, STRIPE_MEMBERSHIP_PREMIUM_PRICE_ID: "" }),
    ).toThrow(/Premium membership price id/);
  });

  it("rejects dev-prefixed JWT secrets in production", () => {
    expect(() =>
      loadEnv({ ...prodBase, JWT_ACCESS_SECRET: "dev-access-secret-" + "x".repeat(20) }),
    ).toThrow(/JWT access secret/);
    expect(() =>
      loadEnv({ ...prodBase, JWT_REFRESH_SECRET: "dev-refresh-" + "y".repeat(25) }),
    ).toThrow(/JWT refresh secret/);
  });

  it("rejects default /metrics password in production", () => {
    expect(() =>
      loadEnv({ ...prodBase, METRICS_PASSWORD: "change-me-in-production" }),
    ).toThrow(/metrics password/);
  });

  it("rejects empty CORS allowlist in production", () => {
    expect(() =>
      loadEnv({ ...prodBase, CORS_ORIGINS: "" }),
    ).toThrow(/CORS allowlist/);
  });

  it("accepts disabling the public app API key gate in production", () => {
    expect(() =>
      loadEnv({
        ...prodBase,
        REQUIRE_API_KEY: "false",
        APP_PUBLIC_API_KEYS: "",
        APP_PUBLIC_API_KEY_HASHES: "",
      }),
    ).not.toThrow();
  });

  it("rejects stale public app API key hashes when the gate is disabled in production", () => {
    expect(() =>
      loadEnv({
        ...prodBase,
        REQUIRE_API_KEY: "false",
        APP_PUBLIC_API_KEYS: "",
        APP_PUBLIC_API_KEY_HASHES: "a".repeat(64),
      }),
    ).toThrow(/public app API key hashes/);
  });

  it("requires hash-only public app API keys when the gate is enabled in production", () => {
    expect(() =>
      loadEnv({
        ...prodBase,
        APP_PUBLIC_API_KEYS: "test-public-client-key-1234567890abcdef",
        APP_PUBLIC_API_KEY_HASHES: "",
      }),
    ).toThrow(/plaintext public app API keys/);
    expect(() =>
      loadEnv({ ...prodBase, APP_PUBLIC_API_KEY_HASHES: "" }),
    ).toThrow(/public app API key hashes/);
    expect(() =>
      loadEnv({ ...prodBase, APP_PUBLIC_API_KEY_HASHES: "not-a-sha256" }),
    ).toThrow(/public app API key hash/);
  });

  it("rejects missing SMTP credentials in production", () => {
    expect(() =>
      loadEnv({
        ...prodBase,
        SMTP_HOST: undefined,
        SMTP_USER: undefined,
        SMTP_PASS: undefined,
      }),
    ).toThrow(/SMTP credentials/);
  });

  it("rejects missing public URLs and APNs credentials in production", () => {
    expect(() =>
      loadEnv({ ...prodBase, PUBLIC_BASE_URL: "" }),
    ).toThrow(/public API base URL/);
    expect(() =>
      loadEnv({ ...prodBase, PUBLIC_APP_URL: "" }),
    ).toThrow(/public app URL/);
    expect(() =>
      loadEnv({
        ...prodBase,
        APNS_KEY_ID: undefined,
        APNS_TEAM_ID: undefined,
        APNS_BUNDLE_ID: undefined,
        APNS_AUTH_KEY: undefined,
      }),
    ).toThrow(/APNs credentials/);
  });

  it("rejects non-HTTPS public URLs and APNs sandbox in production", () => {
    expect(() =>
      loadEnv({ ...prodBase, PUBLIC_BASE_URL: "http://api.linkfit.app" }),
    ).toThrow(/non-HTTPS public API base URL/);
    expect(() =>
      loadEnv({ ...prodBase, PUBLIC_APP_URL: "http://linkfit.app" }),
    ).toThrow(/non-HTTPS public app URL/);
    expect(() =>
      loadEnv({ ...prodBase, APNS_USE_SANDBOX: "true" }),
    ).toThrow(/APNs sandbox/);
  });

  it("rejects missing medical encryption key in production", () => {
    expect(() =>
      loadEnv({ ...prodBase, MEDICAL_ENCRYPTION_KEY: "" }),
    ).toThrow(/medical encryption key/);
  });

  it("allows placeholder secrets in development/test", () => {
    // The same values that fail in production should pass in dev/test.
    expect(() =>
      loadEnv({
        ...valid,
        NODE_ENV: "development",
        STRIPE_SECRET_KEY: "sk_test_dummy",
        STRIPE_WEBHOOK_SECRET: "whsec_test_dummy",
        JWT_ACCESS_SECRET: "dev-" + "a".repeat(40),
        JWT_REFRESH_SECRET: "dev-" + "b".repeat(40),
      }),
    ).not.toThrow();
  });
});
