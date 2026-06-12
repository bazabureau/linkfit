import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import { sql } from "kysely";
import { buildServer, type LinkfitServer } from "../../shared/http/server.js";
import { buildTestDb } from "../../../tests/helpers/db.js";
import { buildTestEnv } from "../../../tests/helpers/env.js";
import { truncateAll } from "../../../tests/helpers/fixtures.js";
import { type DbHandle } from "../../shared/db/pool.js";

/**
 * Trust & safety integration coverage:
 *   - per-IP signup budget (default 5/day → 6th = 429)
 *   - disposable-email blacklist (400 with code `domain.invalid`)
 *   - follow-burst tripwire flips `users.flagged_for_review` and the
 *     follows service starts silently rate-limiting the actor.
 *
 * Spins up its OWN server with the PRODUCTION-default thresholds so the
 * boundary (5 allowed, 6th rejected) is exercised faithfully. The shared
 * test env relaxes the limits to 10_000 to keep the rest of the suite
 * free of accidental rate-limit interference.
 */

const VALID_PASSWORD = "CorrectHorse42";
const uniqueEmail = (prefix = "user"): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

interface AuthSessionBody {
  user: { id: string; email: string };
  access_token: string;
  refresh_token: string;
}

describe("auth spam-checks", () => {
  // Production-default thresholds. Built off the shared test env so we
  // inherit the test DB + JWT secrets but override the three knobs we
  // actually want to exercise.
  const env = {
    ...buildTestEnv(),
    SIGNUP_RATE_LIMIT_PER_DAY: 5,
    FOLLOW_BURST_THRESHOLD: 5,
    FOLLOW_BURST_WINDOW_SEC: 60,
  };

  let app: LinkfitServer;
  let db: DbHandle;

  beforeAll(async () => {
    db = buildTestDb();
    app = await buildServer({ env, logger: pino({ level: "silent" }), db });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  // ─────────────────── IP rate limit ───────────────────

  describe("per-IP signup budget", () => {
    it("allows 5 signups from the same IP and rejects the 6th with 429", async () => {
      const ip = "203.0.113.42"; // TEST-NET-3 — clearly synthetic
      for (let i = 1; i <= 5; i++) {
        const res = await app.inject({
          method: "POST",
          url: "/api/v1/auth/register",
          remoteAddress: ip,
          payload: {
            email: uniqueEmail(`burst${String(i)}`),
            password: VALID_PASSWORD,
            display_name: `Burst ${String(i)}`,
          },
        });
        expect(res.statusCode, `signup #${String(i)} should succeed`).toBe(201);
      }

      const sixth = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        remoteAddress: ip,
        payload: {
          email: uniqueEmail("burst6"),
          password: VALID_PASSWORD,
          display_name: "Burst 6",
        },
      });
      expect(sixth.statusCode).toBe(429);
      const body = sixth.json<{ error: { code: string; message: string } }>();
      expect(body.error.code).toBe("RATE_LIMITED");

      // Sanity check: no 6th user landed in the DB — the reject ran
      // BEFORE the service call, so we didn't burn an Argon2 hash either.
      const count = await sql<{ c: string }>`SELECT count(*)::text AS c FROM users`.execute(
        db.db,
      );
      expect(Number(count.rows[0]!.c)).toBe(5);
    });

    it("isolates the budget per IP — a second IP can still register", async () => {
      const ipA = "203.0.113.10";
      const ipB = "203.0.113.11";
      // Exhaust A's budget.
      for (let i = 1; i <= 5; i++) {
        const res = await app.inject({
          method: "POST",
          url: "/api/v1/auth/register",
          remoteAddress: ipA,
          payload: {
            email: uniqueEmail(`a${String(i)}`),
            password: VALID_PASSWORD,
            display_name: `A${String(i)}`,
          },
        });
        expect(res.statusCode).toBe(201);
      }
      // B is still fresh.
      const fromB = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        remoteAddress: ipB,
        payload: {
          email: uniqueEmail("b1"),
          password: VALID_PASSWORD,
          display_name: "B1",
        },
      });
      expect(fromB.statusCode).toBe(201);
    });
  });

  // ─────────────────── disposable email ───────────────────

  describe("disposable-email blacklist", () => {
    it("rejects mailinator.com with 400 / domain.invalid", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        remoteAddress: "203.0.113.99",
        payload: {
          email: `throwaway-${String(Date.now())}@mailinator.com`,
          password: VALID_PASSWORD,
          display_name: "Disposable",
        },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json<{ error: { code: string } }>();
      expect(body.error.code).toBe("domain.invalid");

      // No user row created.
      const count = await sql<{ c: string }>`SELECT count(*)::text AS c FROM users`.execute(
        db.db,
      );
      expect(Number(count.rows[0]!.c)).toBe(0);
    });

    it("still counts toward the IP budget even when rejected", async () => {
      const ip = "203.0.113.55";
      // Three disposable attempts (rejected) + two legit signups should
      // bring the IP to its 5/day cap; the 6th legit attempt = 429.
      for (let i = 1; i <= 3; i++) {
        const res = await app.inject({
          method: "POST",
          url: "/api/v1/auth/register",
          remoteAddress: ip,
          payload: {
            email: `bot${String(i)}-${String(Date.now())}@mailinator.com`,
            password: VALID_PASSWORD,
            display_name: `Bot${String(i)}`,
          },
        });
        expect(res.statusCode).toBe(400);
      }
      for (let i = 1; i <= 2; i++) {
        const res = await app.inject({
          method: "POST",
          url: "/api/v1/auth/register",
          remoteAddress: ip,
          payload: {
            email: uniqueEmail(`legit${String(i)}`),
            password: VALID_PASSWORD,
            display_name: `Legit${String(i)}`,
          },
        });
        expect(res.statusCode).toBe(201);
      }
      const sixth = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        remoteAddress: ip,
        payload: {
          email: uniqueEmail("legit6"),
          password: VALID_PASSWORD,
          display_name: "Legit6",
        },
      });
      expect(sixth.statusCode).toBe(429);
    });

    it("accepts a domain that merely contains a blacklisted substring (no subdomain match)", async () => {
      // `notmailinator.com` is NOT on the list — only the exact `mailinator.com`
      // matches. This guards the matcher from over-eager substring hits.
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        remoteAddress: "203.0.113.77",
        payload: {
          email: `user-${String(Date.now())}@notmailinator.com`,
          password: VALID_PASSWORD,
          display_name: "Edge",
        },
      });
      expect(res.statusCode).toBe(201);
    });
  });

  // ─────────────────── follow burst ───────────────────

  describe("follow-burst tripwire", () => {
    it("flags the actor after threshold follows and silently rate-limits further follows", async () => {
      // Need >5 distinct targets so the attacker can hit the threshold.
      // Each register uses a fresh IP so we don't trip the signup limit
      // while building the fixture.
      async function register(label: string, ip: string): Promise<AuthSessionBody> {
        const res = await app.inject({
          method: "POST",
          url: "/api/v1/auth/register",
          remoteAddress: ip,
          payload: {
            email: uniqueEmail(label),
            password: VALID_PASSWORD,
            display_name: label,
          },
        });
        expect(res.statusCode, `register ${label}`).toBe(201);
        return res.json<AuthSessionBody>();
      }

      const attacker = await register("attacker", "198.51.100.1");
      const targets: AuthSessionBody[] = [];
      for (let i = 1; i <= 6; i++) {
        // Each target on its own IP — TEST-NET-2 block, plenty of room.
        targets.push(await register(`tgt${String(i)}`, `198.51.100.${String(10 + i)}`));
      }

      // Five follows from attacker → first five targets. The 5th tips the
      // count to the threshold and flips `flagged_for_review` to TRUE.
      for (let i = 0; i < 5; i++) {
        const res = await app.inject({
          method: "POST",
          url: `/api/v1/users/${targets[i]!.user.id}/follow`,
          headers: { authorization: `Bearer ${attacker.access_token}` },
        });
        expect(res.statusCode).toBe(204);
      }

      // Flag should now be true.
      const flagRow = await db.db
        .selectFrom("users")
        .select("flagged_for_review")
        .where("id", "=", attacker.user.id)
        .executeTakeFirstOrThrow();
      expect(flagRow.flagged_for_review).toBe(true);

      // Sixth follow returns 204 (no error surfaced to client) but the
      // edge is NOT persisted — that's the shadow rate-limit.
      const sixthFollow = await app.inject({
        method: "POST",
        url: `/api/v1/users/${targets[5]!.user.id}/follow`,
        headers: { authorization: `Bearer ${attacker.access_token}` },
      });
      expect(sixthFollow.statusCode).toBe(204);

      const edge = await sql<{ c: string }>`
        SELECT count(*)::text AS c FROM follows
         WHERE follower_user_id = ${attacker.user.id}
           AND followed_user_id = ${targets[5]!.user.id}
      `.execute(db.db);
      expect(Number(edge.rows[0]!.c), "6th follow must not persist").toBe(0);

      // Sanity: the attacker still has the original 5 edges; no over-cascade.
      const totalEdges = await sql<{ c: string }>`
        SELECT count(*)::text AS c FROM follows
         WHERE follower_user_id = ${attacker.user.id}
      `.execute(db.db);
      expect(Number(totalEdges.rows[0]!.c)).toBe(5);
    });
  });
});
