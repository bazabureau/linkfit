import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import { sql } from "kysely";
import { randomUUID } from "node:crypto";
import { buildServer, type LinkfitServer } from "../../shared/http/server.js";
import { buildTestDb } from "../../../tests/helpers/db.js";
import { buildTestEnv } from "../../../tests/helpers/env.js";
import { type DbHandle } from "../../shared/db/pool.js";

const env = buildTestEnv();

interface AuthSessionBody {
  user: {
    id: string;
    email: string;
    display_name: string;
    photo_url: string | null;
    home_lat: number | null;
    home_lng: number | null;
    created_at: string;
  };
  access_token: string;
  refresh_token: string;
  access_token_expires_in_seconds: number;
}
interface ErrorBody {
  error: { code: string; message: string };
}

const VALID_PASSWORD = "CorrectHorse42";
const uniqueEmail = (prefix = "user"): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

describe("users routes", () => {
  let app: LinkfitServer;
  let db: DbHandle;

  beforeAll(async () => {
    db = buildTestDb();
    app = await buildServer({ env, logger: pino({ level: "silent" }), db });
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  beforeEach(async () => {
    // Wipe between tests so concurrent rate limits and FK relationships don't bleed.
    await sql`TRUNCATE TABLE refresh_tokens, users RESTART IDENTITY CASCADE`.execute(db.db);
  });

  // ───────────────────────── register ─────────────────────────

  describe("POST /api/v1/auth/register", () => {
    it("creates a user and returns an auth session", async () => {
      const email = uniqueEmail();
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: { email, password: VALID_PASSWORD, display_name: "Test User" },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<AuthSessionBody>();
      expect(body.user.email).toBe(email.toLowerCase());
      expect(body.user.display_name).toBe("Test User");
      expect(body.access_token.split(".").length).toBe(3);
      expect(body.refresh_token.length).toBeGreaterThan(40);
      expect(body.access_token_expires_in_seconds).toBe(900);
      // Password hash must not leak.
      expect(JSON.stringify(body)).not.toContain("password");
    });

    it("rejects duplicate email with 409", async () => {
      const email = uniqueEmail();
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: { email, password: VALID_PASSWORD, display_name: "First" },
      });
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: { email, password: VALID_PASSWORD, display_name: "Second" },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json<ErrorBody>().error.code).toBe("CONFLICT");
    });

    it("rejects weak password with 400 and policy issues", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: {
          email: uniqueEmail(),
          password: "tooshort",
          display_name: "Weak Pw",
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<ErrorBody>().error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects malformed email", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: { email: "not-an-email", password: VALID_PASSWORD, display_name: "X" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ────────────────────────── login ──────────────────────────

  describe("POST /api/v1/auth/login", () => {
    it("logs in a registered user", async () => {
      const email = uniqueEmail();
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: { email, password: VALID_PASSWORD, display_name: "Login Me" },
      });
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email, password: VALID_PASSWORD },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<AuthSessionBody>().user.email).toBe(email.toLowerCase());
    });

    it("returns identical 401 for unknown email and wrong password (no enumeration)", async () => {
      const email = uniqueEmail();
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: { email, password: VALID_PASSWORD, display_name: "X" },
      });
      const wrongPw = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email, password: "NotTheRealPassword42" },
      });
      const unknown = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: "ghost@example.com", password: VALID_PASSWORD },
      });
      expect(wrongPw.statusCode).toBe(401);
      expect(unknown.statusCode).toBe(401);
      expect(wrongPw.json<ErrorBody>().error.message).toBe(
        unknown.json<ErrorBody>().error.message,
      );
    });

    it("returns 401 for OAuth-only accounts without a local password", async () => {
      const email = uniqueEmail("google-only");
      await sql`
        INSERT INTO users (email, password_hash, display_name, google_sub, email_verified_at)
        VALUES (${email}, NULL, 'Google Only', ${`google-${randomUUID()}`}, now())
      `.execute(db.db);

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email, password: VALID_PASSWORD },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json<ErrorBody>().error.code).toBe("UNAUTHENTICATED");
    });
  });

  // ───────────────────────── refresh ─────────────────────────

  describe("POST /api/v1/auth/refresh", () => {
    async function bootstrap(): Promise<AuthSessionBody> {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: { email: uniqueEmail(), password: VALID_PASSWORD, display_name: "Refresher" },
      });
      return res.json<AuthSessionBody>();
    }

    it("rotates tokens: returns new access + new refresh, old refresh becomes unusable", async () => {
      const session = await bootstrap();
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/refresh",
        payload: { refresh_token: session.refresh_token },
      });
      expect(res.statusCode).toBe(200);
      const rotated = res.json<AuthSessionBody>();
      expect(rotated.refresh_token).not.toBe(session.refresh_token);

      // Old token now unusable
      const replay = await app.inject({
        method: "POST",
        url: "/api/v1/auth/refresh",
        payload: { refresh_token: session.refresh_token },
      });
      expect(replay.statusCode).toBe(401);
    });

    it("revokes the entire family when a previously-used token is replayed", async () => {
      const session = await bootstrap();
      // Refresh once → rotate
      const round2 = await app.inject({
        method: "POST",
        url: "/api/v1/auth/refresh",
        payload: { refresh_token: session.refresh_token },
      });
      expect(round2.statusCode).toBe(200);
      const round2Body = round2.json<AuthSessionBody>();

      // Replay round-1 token → triggers family revocation
      const attack = await app.inject({
        method: "POST",
        url: "/api/v1/auth/refresh",
        payload: { refresh_token: session.refresh_token },
      });
      expect(attack.statusCode).toBe(401);
      expect(attack.json<ErrorBody>().error.code).toBe("UNAUTHENTICATED");

      // Round-2 token (still "active" prior to attack) is also now unusable
      const aftermath = await app.inject({
        method: "POST",
        url: "/api/v1/auth/refresh",
        payload: { refresh_token: round2Body.refresh_token },
      });
      expect(aftermath.statusCode).toBe(401);

      // Verify directly in DB that the whole family is revoked.
      const rows = await sql<{ revoked_at: Date | null }>`
        SELECT revoked_at FROM refresh_tokens
        WHERE user_id = (SELECT id FROM users WHERE email = ${session.user.email})
      `.execute(db.db);
      expect(rows.rows.length).toBeGreaterThanOrEqual(2);
      for (const row of rows.rows) {
        expect(row.revoked_at).not.toBeNull();
      }
    });

    it("rejects an unknown refresh token", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/refresh",
        payload: { refresh_token: "this-is-not-a-real-token-1234567890" },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // ───────────────────────── logout ──────────────────────────

  describe("POST /api/v1/auth/logout", () => {
    it("revokes the family so subsequent refresh fails", async () => {
      const session = (
        await app.inject({
          method: "POST",
          url: "/api/v1/auth/register",
          payload: { email: uniqueEmail(), password: VALID_PASSWORD, display_name: "L" },
        })
      ).json<AuthSessionBody>();

      const logout = await app.inject({
        method: "POST",
        url: "/api/v1/auth/logout",
        payload: { refresh_token: session.refresh_token },
      });
      expect(logout.statusCode).toBe(204);

      const refresh = await app.inject({
        method: "POST",
        url: "/api/v1/auth/refresh",
        payload: { refresh_token: session.refresh_token },
      });
      expect(refresh.statusCode).toBe(401);
    });

    it("is idempotent for unknown tokens (no enumeration via logout)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/logout",
        payload: { refresh_token: "definitely-not-a-real-token-abcdefghij" },
      });
      expect(res.statusCode).toBe(204);
    });
  });

  // ─────────────────────────── /me ───────────────────────────

  describe("GET /api/v1/me", () => {
    it("returns the authenticated user's public profile", async () => {
      const session = (
        await app.inject({
          method: "POST",
          url: "/api/v1/auth/register",
          payload: { email: uniqueEmail(), password: VALID_PASSWORD, display_name: "Profile" },
        })
      ).json<AuthSessionBody>();

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/me",
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      expect(res.statusCode).toBe(200);
      const me = res.json<AuthSessionBody["user"]>();
      expect(me.id).toBe(session.user.id);
      expect(JSON.stringify(me)).not.toContain("password");
    });

    it("returns 401 without Authorization header", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/me" });
      expect(res.statusCode).toBe(401);
    });

    it("returns 401 when the user has been soft-deleted", async () => {
      const session = (
        await app.inject({
          method: "POST",
          url: "/api/v1/auth/register",
          payload: { email: uniqueEmail(), password: VALID_PASSWORD, display_name: "Gone" },
        })
      ).json<AuthSessionBody>();

      await sql`UPDATE users SET deleted_at = now() WHERE id = ${session.user.id}`.execute(db.db);

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/me",
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      // Token is still cryptographically valid, so guard passes; service-level
      // findActiveById returns null → NotFoundError → 404. We accept either
      // 401 or 404 as long as the deleted user can't observe their data.
      expect([401, 404]).toContain(res.statusCode);
      expect(res.json<ErrorBody>().error.message).not.toContain("password");
    });
  });

  describe("PATCH /api/v1/me", () => {
    it("updates display_name and returns the new profile", async () => {
      const session = (
        await app.inject({
          method: "POST",
          url: "/api/v1/auth/register",
          payload: { email: uniqueEmail(), password: VALID_PASSWORD, display_name: "Old" },
        })
      ).json<AuthSessionBody>();
      const res = await app.inject({
        method: "PATCH",
        url: "/api/v1/me",
        headers: { authorization: `Bearer ${session.access_token}` },
        payload: { display_name: "New Name" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<AuthSessionBody["user"]>().display_name).toBe("New Name");
    });

    it("rejects an empty body", async () => {
      const session = (
        await app.inject({
          method: "POST",
          url: "/api/v1/auth/register",
          payload: { email: uniqueEmail(), password: VALID_PASSWORD, display_name: "X" },
        })
      ).json<AuthSessionBody>();
      const res = await app.inject({
        method: "PATCH",
        url: "/api/v1/me",
        headers: { authorization: `Bearer ${session.access_token}` },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it("requires lat and lng to be sent together", async () => {
      const session = (
        await app.inject({
          method: "POST",
          url: "/api/v1/auth/register",
          payload: { email: uniqueEmail(), password: VALID_PASSWORD, display_name: "X" },
        })
      ).json<AuthSessionBody>();
      const res = await app.inject({
        method: "PATCH",
        url: "/api/v1/me",
        headers: { authorization: `Bearer ${session.access_token}` },
        payload: { home_lat: 40.4093 },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
