import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";
import pino from "pino";
import { REDACTION_PATHS } from "./logger.js";

/**
 * We don't use createLogger() here because pino-pretty's transport runs in a
 * worker thread, which makes capturing output racy. Instead we construct a
 * plain pino logger with the same redaction config and assert directly.
 */
function captureLogs(): { logger: pino.Logger; lines: () => unknown[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer | string, _enc, cb) {
      chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      cb();
    },
  });
  const logger = pino(
    {
      level: "trace",
      redact: { paths: REDACTION_PATHS, censor: "[REDACTED]" },
    },
    stream,
  );
  return {
    logger,
    lines: () =>
      chunks
        .join("")
        .split("\n")
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l) as unknown),
  };
}

describe("logger redaction", () => {
  it("redacts top-level password and token fields", () => {
    const cap = captureLogs();
    cap.logger.info({ password: "hunter2", token: "abc123" }, "login attempt");
    const [entry] = cap.lines() as Record<string, unknown>[];
    expect(entry?.password).toBe("[REDACTED]");
    expect(entry?.token).toBe("[REDACTED]");
    expect(entry?.msg).toBe("login attempt");
  });

  it("redacts nested authorization header on req object", () => {
    const cap = captureLogs();
    cap.logger.info(
      { req: { headers: { authorization: "Bearer secret", cookie: "session=x" } } },
      "incoming",
    );
    const [entry] = cap.lines() as Record<string, Record<string, Record<string, string>>>[];
    expect(entry?.req?.headers?.authorization).toBe("[REDACTED]");
    expect(entry?.req?.headers?.cookie).toBe("[REDACTED]");
  });

  it("does not redact unrelated fields", () => {
    const cap = captureLogs();
    cap.logger.info({ email: "a@b.com", user_id: "u_1" }, "ok");
    const [entry] = cap.lines() as Record<string, unknown>[];
    expect(entry?.email).toBe("a@b.com");
    expect(entry?.user_id).toBe("u_1");
  });

  it("redacts password fields nested one level deep via the wildcard", () => {
    // The `*.password` / `*.token` paths catch one-deep nesting like
    // `{ user: { password: "..." } }` — common when we log a full DTO.
    const cap = captureLogs();
    cap.logger.info(
      {
        user: { id: "u_1", password: "raw", refresh_token: "rt_secret" },
        ctx: { token: "abc" },
      },
      "dto",
    );
    const [entry] = cap.lines() as Record<string, Record<string, unknown>>[];
    expect(entry?.user?.password).toBe("[REDACTED]");
    expect(entry?.user?.refresh_token).toBe("[REDACTED]");
    expect(entry?.ctx?.token).toBe("[REDACTED]");
    // Sibling, non-sensitive fields are preserved.
    expect(entry?.user?.id).toBe("u_1");
  });

  it("REDACTION_PATHS is complete enough to cover all known sensitive keys", () => {
    // Pin the contract — if a future PR removes a path the suite breaks
    // loudly, not silently in production.
    const mustInclude = [
      "password",
      "password_hash",
      "token",
      "access_token",
      "refresh_token",
      "authorization",
      "req.headers.authorization",
      "req.headers.cookie",
    ];
    for (const path of mustInclude) {
      expect(REDACTION_PATHS).toContain(path);
    }
  });
});
