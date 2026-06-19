import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import { sql } from "kysely";
import { buildServer, type LinkfitServer } from "../../shared/http/server.js";
import { buildTestDb } from "../../../tests/helpers/db.js";
import { buildTestEnv } from "../../../tests/helpers/env.js";
import { type DbHandle } from "../../shared/db/pool.js";
import { LoggingTransport, type MailTransport, type OutgoingEmail } from "./email.transport.js";

/**
 * Integration tests for the Email agent. Every test runs against a real
 * Postgres (provided by globalSetup.ts via Testcontainers) and a fake
 * MailTransport that simply collects outgoing messages.
 *
 * Code extraction strategy: verification and password-reset emails both
 * contain a six-digit code. The plain code is never stored in the database.
 */

const env = buildTestEnv();

interface AuthSessionBody {
  user: {
    id: string;
    email: string;
    email_verified_at: string | null;
  };
  access_token: string;
  refresh_token: string;
}

interface ErrorBody {
  error: { code: string; message: string };
}

class CaptureTransport implements MailTransport {
  private readonly _outbox: OutgoingEmail[] = [];
  public get outbox(): readonly OutgoingEmail[] {
    return this._outbox;
  }
  public send(message: OutgoingEmail): Promise<void> {
    this._outbox.push(message);
    return Promise.resolve();
  }
  public clear(): void {
    this._outbox.length = 0;
  }
  public lastFor(to: string): OutgoingEmail | undefined {
    return [...this._outbox].reverse().find((m) => m.to === to);
  }
}

const VALID_PASSWORD = "CorrectHorse42";
const uniqueEmail = (prefix = "email"): string =>
  `${prefix}-${Date.now().toString()}-${Math.random().toString(36).slice(2)}@example.com`;

function extractCode(body: string): string {
  const match = /\b(\d{6})\b/.exec(body);
  if (!match?.[1]) {
    throw new Error(`No 6-digit code found in email body:\n${body}`);
  }
  return match[1];
}

async function register(
  app: LinkfitServer,
  email: string,
  password = VALID_PASSWORD,
): Promise<AuthSessionBody> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: { email, password, display_name: "Tester" },
  });
  if (res.statusCode !== 201) {
    throw new Error(`register failed: ${String(res.statusCode)} ${res.body}`);
  }
  return res.json<AuthSessionBody>();
}

describe("email module — verification + password reset", () => {
  let app: LinkfitServer;
  let db: DbHandle;
  let transport: CaptureTransport;

  beforeAll(async () => {
    db = buildTestDb();
    transport = new CaptureTransport();
    app = await buildServer({
      env,
      logger: pino({ level: "silent" }),
      db,
      mailTransport: transport,
    });
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  beforeEach(async () => {
    await sql`TRUNCATE TABLE email_tokens, refresh_tokens, users RESTART IDENTITY CASCADE`.execute(
      db.db,
    );
    transport.clear();
  });

  // ───────────────────────── send-verification ─────────────────────────

  describe("POST /api/v1/auth/send-verification", () => {
    it("emails a fresh verification code to a logged-in unverified user", async () => {
      const email = uniqueEmail();
      const session = await register(app, email);
      expect(session.user.email_verified_at).toBeNull();

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/send-verification",
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ sent: boolean }>().sent).toBe(true);

      const message = transport.lastFor(email.toLowerCase());
      expect(message).toBeDefined();
      expect(message?.subject).toMatch(/\d{6}/);
      expect(message?.html).toContain("https://linkfit.az/brand/logolinkfit-dark.png");
      expect(extractCode(message?.text ?? "")).toMatch(/^\d{6}$/);
    });

    it("rejects unauthenticated callers with 401", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/send-verification",
      });
      expect(res.statusCode).toBe(401);
    });

    it("is rate-limited (60s cool-down) on consecutive sends", async () => {
      const email = uniqueEmail();
      const session = await register(app, email);
      const first = await app.inject({
        method: "POST",
        url: "/api/v1/auth/send-verification",
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      expect(first.statusCode).toBe(200);
      const second = await app.inject({
        method: "POST",
        url: "/api/v1/auth/send-verification",
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      expect(second.statusCode).toBe(429);
      expect(second.json<ErrorBody>().error.code).toBe("RATE_LIMITED");
    });

    it("returns sent=false when the account is already verified", async () => {
      const email = uniqueEmail();
      const session = await register(app, email);
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/send-verification",
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      const code = extractCode(transport.lastFor(email.toLowerCase())?.text ?? "");
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/verify-email",
        headers: { authorization: `Bearer ${session.access_token}` },
        payload: { token: code },
      });
      transport.clear();
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/send-verification",
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ sent: boolean }>().sent).toBe(false);
      expect(transport.outbox.length).toBe(0);
    });
  });

  // ───────────────────────── verify-email ─────────────────────────

  describe("POST /api/v1/auth/verify-email", () => {
    it("flips email_verified_at on success", async () => {
      const email = uniqueEmail();
      const session = await register(app, email);
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/send-verification",
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      const code = extractCode(transport.lastFor(email.toLowerCase())?.text ?? "");
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/verify-email",
        headers: { authorization: `Bearer ${session.access_token}` },
        payload: { token: code },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ verified: boolean }>().verified).toBe(true);

      const me = await app.inject({
        method: "GET",
        url: "/api/v1/me",
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      const body = me.json<{ email_verified_at: string | null }>();
      expect(body.email_verified_at).not.toBeNull();
    });

    it("requires auth", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/verify-email",
        payload: { token: "123456" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns verified=false for a wrong code and invalidates after five failures", async () => {
      const email = uniqueEmail();
      const session = await register(app, email);
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/send-verification",
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      const code = extractCode(transport.lastFor(email.toLowerCase())?.text ?? "");
      const wrongCode = code === "000000" ? "000001" : "000000";
      for (let i = 0; i < 5; i += 1) {
        const wrong = await app.inject({
          method: "POST",
          url: "/api/v1/auth/verify-email",
          headers: { authorization: `Bearer ${session.access_token}` },
          payload: { token: wrongCode },
        });
        expect(wrong.statusCode).toBe(200);
        expect(wrong.json<{ verified: boolean }>().verified).toBe(false);
      }
      const correctAfterInvalidation = await app.inject({
        method: "POST",
        url: "/api/v1/auth/verify-email",
        headers: { authorization: `Bearer ${session.access_token}` },
        payload: { token: code },
      });
      expect(correctAfterInvalidation.statusCode).toBe(200);
      expect(correctAfterInvalidation.json<{ verified: boolean }>().verified).toBe(false);
    });

    it("returns verified=false for a re-used code", async () => {
      const email = uniqueEmail();
      const session = await register(app, email);
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/send-verification",
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      const code = extractCode(transport.lastFor(email.toLowerCase())?.text ?? "");
      const first = await app.inject({
        method: "POST",
        url: "/api/v1/auth/verify-email",
        headers: { authorization: `Bearer ${session.access_token}` },
        payload: { token: code },
      });
      expect(first.statusCode).toBe(200);
      const second = await app.inject({
        method: "POST",
        url: "/api/v1/auth/verify-email",
        headers: { authorization: `Bearer ${session.access_token}` },
        payload: { token: code },
      });
      expect(second.statusCode).toBe(200);
      expect(second.json<{ verified: boolean }>().verified).toBe(false);
    });
  });

  // ───────────────────────── password reset ─────────────────────────

  describe("password reset flow", () => {
    it("always returns 200 — never leaks whether the email exists", async () => {
      const ghost = await app.inject({
        method: "POST",
        url: "/api/v1/auth/request-password-reset",
        payload: { email: "ghost@example.com" },
      });
      expect(ghost.statusCode).toBe(200);
      expect(ghost.json<{ requested: boolean }>().requested).toBe(true);
      expect(transport.outbox.length).toBe(0);

      const email = uniqueEmail();
      await register(app, email);
      const real = await app.inject({
        method: "POST",
        url: "/api/v1/auth/request-password-reset",
        payload: { email },
      });
      expect(real.statusCode).toBe(200);
      expect(real.json<{ requested: boolean }>().requested).toBe(true);
      expect(transport.outbox.length).toBe(1);
      expect(transport.outbox[0]?.subject).toContain("Reset");
      expect(transport.outbox[0]?.html).toContain("https://linkfit.az/brand/logolinkfit-dark.png");
    });

    it("resets password with a valid code and revokes refresh tokens", async () => {
      const email = uniqueEmail();
      const session = await register(app, email);

      await app.inject({
        method: "POST",
        url: "/api/v1/auth/request-password-reset",
        payload: { email },
      });
      const code = extractCode(transport.lastFor(email.toLowerCase())?.text ?? "");

      const NEW_PASSWORD = "BrandNewPass99";
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/reset-password",
        payload: { email, code, new_password: NEW_PASSWORD },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ reset: boolean }>().reset).toBe(true);

      const oldRefresh = await app.inject({
        method: "POST",
        url: "/api/v1/auth/refresh",
        payload: { refresh_token: session.refresh_token },
      });
      expect(oldRefresh.statusCode).toBe(401);

      const oldLogin = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email, password: VALID_PASSWORD },
      });
      expect(oldLogin.statusCode).toBe(401);
      const newLogin = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email, password: NEW_PASSWORD },
      });
      expect(newLogin.statusCode).toBe(200);
    });

    it("rejects a re-used reset code on the second attempt", async () => {
      const email = uniqueEmail();
      await register(app, email);
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/request-password-reset",
        payload: { email },
      });
      const code = extractCode(transport.lastFor(email.toLowerCase())?.text ?? "");
      const first = await app.inject({
        method: "POST",
        url: "/api/v1/auth/reset-password",
        payload: { email, code, new_password: "AnotherStrong42" },
      });
      expect(first.statusCode).toBe(200);
      const second = await app.inject({
        method: "POST",
        url: "/api/v1/auth/reset-password",
        payload: { email, code, new_password: "AndAnother42Aa" },
      });
      expect(second.statusCode).toBe(400);
    });

    it("invalidates older pending reset codes when a newer reset is requested", async () => {
      const email = uniqueEmail();
      await register(app, email);

      await app.inject({
        method: "POST",
        url: "/api/v1/auth/request-password-reset",
        payload: { email },
      });
      const firstCode = extractCode(transport.lastFor(email.toLowerCase())?.text ?? "");

      await sql`
        UPDATE email_tokens
           SET created_at = now() - interval '61 seconds'
         WHERE kind = 'reset_password'
           AND used_at IS NULL
      `.execute(db.db);

      await app.inject({
        method: "POST",
        url: "/api/v1/auth/request-password-reset",
        payload: { email },
      });
      const secondCode = extractCode(transport.lastFor(email.toLowerCase())?.text ?? "");

      const oldReset = await app.inject({
        method: "POST",
        url: "/api/v1/auth/reset-password",
        payload: { email, code: firstCode, new_password: "OlderTokenPass99" },
      });
      expect(oldReset.statusCode).toBe(400);

      const newestReset = await app.inject({
        method: "POST",
        url: "/api/v1/auth/reset-password",
        payload: { email, code: secondCode, new_password: "NewestTokenPass99" },
      });
      expect(newestReset.statusCode).toBe(200);
    });

    it("rejects a weak password against the reset endpoint", async () => {
      const email = uniqueEmail();
      await register(app, email);
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/request-password-reset",
        payload: { email },
      });
      const code = extractCode(transport.lastFor(email.toLowerCase())?.text ?? "");
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/reset-password",
        payload: { email, code, new_password: "short" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ───────────────────────── transport ─────────────────────────

  describe("LoggingTransport fallback", () => {
    it("captures messages in its outbox", async () => {
      const fallback = new LoggingTransport(pino({ level: "silent" }));
      await fallback.send({
        to: "x@example.com",
        subject: "Hi",
        text: "Body",
        html: "<p>Body</p>",
      });
      expect(fallback.outbox.length).toBe(1);
      expect(fallback.outbox[0]?.to).toBe("x@example.com");
    });
  });
});
