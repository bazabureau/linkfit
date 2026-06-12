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
    expect(() => loadEnv({})).toThrowError(EnvValidationError);
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
    ).toThrowError(/postgres/);
  });

  it("rejects PORT that is not a positive integer", () => {
    expect(() => loadEnv({ ...valid, PORT: "abc" })).toThrowError(/PORT/);
    expect(() => loadEnv({ ...valid, PORT: "-1" })).toThrowError(/PORT/);
  });

  it("rejects too-short JWT secrets", () => {
    expect(() =>
      loadEnv({ ...valid, JWT_ACCESS_SECRET: "tooshort" }),
    ).toThrowError(/JWT_ACCESS_SECRET/);
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
    expect(env.AUTH_RATE_LIMIT_MAX).toBe(10);
    expect(env.FEATURE_BOOKINGS).toBe(false);
    expect(env.APNS_USE_SANDBOX).toBe(false);
    // UPLOAD_DIR has a default — exists but is opinionated.
    expect(env.UPLOAD_DIR.length).toBeGreaterThan(0);
  });

  it("rejects PORT above the 65535 ceiling", () => {
    expect(() => loadEnv({ ...valid, PORT: "70000" })).toThrowError(/PORT/);
  });

  it("coerces APNS_USE_SANDBOX correctly and rejects invalid values", () => {
    expect(loadEnv({ ...valid, APNS_USE_SANDBOX: "true" }).APNS_USE_SANDBOX).toBe(true);
    expect(loadEnv({ ...valid, APNS_USE_SANDBOX: "false" }).APNS_USE_SANDBOX).toBe(false);
    expect(() =>
      loadEnv({ ...valid, APNS_USE_SANDBOX: "yes" }),
    ).toThrowError(EnvValidationError);
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
    METRICS_PASSWORD: "real-strong-password",
    CORS_ORIGINS: "https://app.linkfit.app",
  };

  it("accepts a properly-configured production environment", () => {
    expect(() => loadEnv(prodBase)).not.toThrow();
  });

  it("rejects placeholder Stripe secret key in production", () => {
    expect(() =>
      loadEnv({ ...prodBase, STRIPE_SECRET_KEY: "sk_test_dummy" }),
    ).toThrowError(/Stripe secret key/);
  });

  it("rejects placeholder Stripe webhook secret in production", () => {
    expect(() =>
      loadEnv({ ...prodBase, STRIPE_WEBHOOK_SECRET: "whsec_test_dummy" }),
    ).toThrowError(/Stripe webhook secret/);
  });

  it("rejects dev-prefixed JWT secrets in production", () => {
    expect(() =>
      loadEnv({ ...prodBase, JWT_ACCESS_SECRET: "dev-access-secret-" + "x".repeat(20) }),
    ).toThrowError(/JWT access secret/);
    expect(() =>
      loadEnv({ ...prodBase, JWT_REFRESH_SECRET: "dev-refresh-" + "y".repeat(25) }),
    ).toThrowError(/JWT refresh secret/);
  });

  it("rejects default /metrics password in production", () => {
    expect(() =>
      loadEnv({ ...prodBase, METRICS_PASSWORD: "change-me-in-production" }),
    ).toThrowError(/metrics password/);
  });

  it("rejects empty CORS allowlist in production", () => {
    expect(() =>
      loadEnv({ ...prodBase, CORS_ORIGINS: "" }),
    ).toThrowError(/CORS allowlist/);
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
