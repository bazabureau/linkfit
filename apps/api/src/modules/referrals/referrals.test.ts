import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import { sql } from "kysely";
import { buildServer, type LinkfitServer } from "../../shared/http/server.js";
import { buildTestDb } from "../../../tests/helpers/db.js";
import { buildTestEnv } from "../../../tests/helpers/env.js";
import {
  createTestUser,
  truncateAll,
  type TestUser,
} from "../../../tests/helpers/fixtures.js";
import { type DbHandle } from "../../shared/db/pool.js";
import { ReferralsService } from "./referrals.service.js";

interface MyReferralsBody {
  code: string;
  referred_count: number;
  referred_users: { id: string; display_name: string; referred_at: string }[];
}

interface RedeemBody {
  referrer_user_id: string;
  referrer_display_name: string;
  code_used: string;
}

interface ErrorBody {
  error: { code: string; message: string };
}

/**
 * Helpers that shift the referee's `created_at` so we can test the 7-day
 * redemption window without sleeping in real time.
 */
async function shiftUserCreatedAt(
  db: DbHandle,
  userId: string,
  ageDays: number,
): Promise<void> {
  await sql`
    UPDATE users
       SET created_at = now() - (${ageDays}::int * interval '1 day')
     WHERE id = ${userId}
  `.execute(db.db);
}

describe("referrals routes", () => {
  const env = buildTestEnv();
  let app: LinkfitServer;
  let db: DbHandle;
  let service: ReferralsService;

  beforeAll(async () => {
    db = buildTestDb();
    app = await buildServer({ env, logger: pino({ level: "silent" }), db });
    service = new ReferralsService({ db });
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
  });

  // ── GET /api/v1/me/referrals ─────────────────────────────────────────────

  describe("GET /api/v1/me/referrals", () => {
    it("mints a unique 6-char code on first access", async () => {
      const user = await createTestUser(app);
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/me/referrals",
        headers: { authorization: `Bearer ${user.access_token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<MyReferralsBody>();
      expect(body.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
      expect(body.referred_count).toBe(0);
      expect(body.referred_users).toHaveLength(0);
    });

    it("returns the same code across repeat calls (idempotent mint)", async () => {
      const user = await createTestUser(app);
      const first = await service.codeFor(user.id);
      const second = await service.codeFor(user.id);
      const third = await service.codeFor(user.id);
      expect(first).toBe(second);
      expect(second).toBe(third);
    });

    it("rejects unauthenticated requests with 401", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/me/referrals",
      });
      expect(res.statusCode).toBe(401);
    });

    it("lists referred users after a redemption", async () => {
      const referrer = await createTestUser(app);
      const referee = await createTestUser(app);
      const code = await service.codeFor(referrer.id);

      const redeem = await app.inject({
        method: "POST",
        url: "/api/v1/auth/redeem-referral",
        headers: { authorization: `Bearer ${referee.access_token}` },
        payload: { code },
      });
      expect(redeem.statusCode).toBe(200);

      const list = await app.inject({
        method: "GET",
        url: "/api/v1/me/referrals",
        headers: { authorization: `Bearer ${referrer.access_token}` },
      });
      expect(list.statusCode).toBe(200);
      const body = list.json<MyReferralsBody>();
      expect(body.referred_count).toBe(1);
      expect(body.referred_users[0]!.id).toBe(referee.id);
    });
  });

  // ── POST /api/v1/auth/redeem-referral ────────────────────────────────────

  describe("POST /api/v1/auth/redeem-referral", () => {
    async function redeem(
      actor: TestUser,
      code: string,
    ): Promise<{ statusCode: number; body: RedeemBody | ErrorBody }> {
      const r = await app.inject({
        method: "POST",
        url: "/api/v1/auth/redeem-referral",
        headers: { authorization: `Bearer ${actor.access_token}` },
        payload: { code },
      });
      return { statusCode: r.statusCode, body: r.json() };
    }

    it("records a successful redemption (200) and writes an audit_log row", async () => {
      const referrer = await createTestUser(app);
      const referee = await createTestUser(app);
      const code = await service.codeFor(referrer.id);

      const res = await redeem(referee, code);
      expect(res.statusCode).toBe(200);
      const body = res.body as RedeemBody;
      expect(body.referrer_user_id).toBe(referrer.id);
      expect(body.code_used).toBe(code);

      const audit = await sql<{ count: string }>`
        SELECT COUNT(*)::text AS count
          FROM audit_log
         WHERE action = 'referrals.redeem'
           AND actor_user_id = ${referee.id}
      `.execute(db.db);
      expect(Number(audit.rows[0]!.count)).toBe(1);

      const rows = await sql<{ referee_user_id: string; referrer_user_id: string }>`
        SELECT referee_user_id, referrer_user_id FROM referrals
      `.execute(db.db);
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]!.referee_user_id).toBe(referee.id);
      expect(rows.rows[0]!.referrer_user_id).toBe(referrer.id);
    });

    it("accepts lowercase / whitespace-padded input by normalising server-side", async () => {
      const referrer = await createTestUser(app);
      const referee = await createTestUser(app);
      const code = await service.codeFor(referrer.id);
      const res = await redeem(referee, `  ${code.toLowerCase()}  `);
      expect(res.statusCode).toBe(200);
      expect((res.body as RedeemBody).code_used).toBe(code);
    });

    it("rejects self-referral with 400", async () => {
      const me = await createTestUser(app);
      const code = await service.codeFor(me.id);
      const res = await redeem(me, code);
      expect(res.statusCode).toBe(400);
      expect((res.body as ErrorBody).error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects an unknown code with 404", async () => {
      const referee = await createTestUser(app);
      const res = await redeem(referee, "ABCDEF");
      expect(res.statusCode).toBe(404);
      expect((res.body as ErrorBody).error.code).toBe("NOT_FOUND");
    });

    it("rejects malformed codes (wrong length / forbidden char) with 400", async () => {
      const referee = await createTestUser(app);
      // Contains '0' which is in the forbidden ambiguity set.
      const r = await redeem(referee, "ABCDE0");
      expect(r.statusCode).toBe(400);
      const r2 = await redeem(referee, "ABC");
      expect(r2.statusCode).toBe(400);
    });

    it("blocks a second redemption with 409 (each user can redeem at most once)", async () => {
      const referrerA = await createTestUser(app);
      const referrerB = await createTestUser(app);
      const referee = await createTestUser(app);
      const codeA = await service.codeFor(referrerA.id);
      const codeB = await service.codeFor(referrerB.id);

      const first = await redeem(referee, codeA);
      expect(first.statusCode).toBe(200);
      const second = await redeem(referee, codeB);
      expect(second.statusCode).toBe(409);
    });

    it("rejects redemptions past the 7-day window with 422", async () => {
      const referrer = await createTestUser(app);
      const referee = await createTestUser(app);
      const code = await service.codeFor(referrer.id);
      await shiftUserCreatedAt(db, referee.id, 8);

      const res = await redeem(referee, code);
      expect(res.statusCode).toBe(422);
      expect((res.body as ErrorBody).error.code).toBe("PRECONDITION_FAILED");
    });

    it("rejects unauthenticated callers with 401", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/redeem-referral",
        payload: { code: "ABCDEF" },
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
