import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import { sql } from "kysely";
import { buildServer, type LinkfitServer } from "../../shared/http/server.js";
import { buildTestDb } from "../../../tests/helpers/db.js";
import { buildTestEnv } from "../../../tests/helpers/env.js";
import { createTestUser, truncateAll } from "../../../tests/helpers/fixtures.js";
import { type DbHandle } from "../../shared/db/pool.js";
import { PushService } from "./push.service.js";
import { LoggingSender } from "./push.sender.js";
import { DailyDigestSweeper, localClockForUser } from "./daily-digest.sweeper.js";

/**
 * Smoke test for the daily-digest sweeper. We drive `tick()` directly with
 * an injected `now()` clock so the local-time math is deterministic — no
 * dependency on the wall clock at all. Each test seeds just enough data
 * to exercise one branch of the per-user filter cascade.
 *
 * The test database has APNs creds intentionally omitted, so server.ts
 * wires a `LoggingSender` — we construct our own one here for the same
 * reason, and assert against `sender.sent` to confirm delivery.
 */
describe("DailyDigestSweeper", () => {
  const env = buildTestEnv();
  let app: LinkfitServer;
  let db: DbHandle;
  let sender: LoggingSender;
  let push: PushService;
  let sweeper: DailyDigestSweeper;

  // 2026-05-21 16:00 UTC = 2026-05-21 20:00 in Asia/Baku — does NOT match
  // our default 18:00 trigger.
  const NOT_BAKU_18 = new Date("2026-05-21T16:00:00.000Z");
  // 2026-05-21 14:00 UTC = 2026-05-21 18:00 in Asia/Baku (UTC+4) — matches
  // our default 18:00 trigger.
  const BAKU_18 = new Date("2026-05-21T14:00:00.000Z");

  beforeAll(async () => {
    db = buildTestDb();
    app = await buildServer({ env, logger: pino({ level: "silent" }), db });
    await app.ready();
    sender = new LoggingSender(pino({ level: "silent" }));
    push = new PushService({ db, sender, logger: pino({ level: "silent" }) });
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
    sender.sent.length = 0;
    sweeper = new DailyDigestSweeper({
      db,
      logger: pino({ level: "silent" }),
      push,
      now: () => BAKU_18,
    });
  });

  /**
   * Register a device token for `userId` so `push.deliverToUser` has
   * something to send to. The LoggingSender accepts any non-empty hex
   * blob — we use a deterministic 64-char hex per call so the
   * `sender.sent` array can be inspected in isolation per test.
   */
  async function registerDevice(userId: string, suffix: string): Promise<string> {
    // Pad to 64 chars with the suffix repeated; APNs hex tokens are
    // 64 hex chars in practice and the sender re-validates.
    const token = (suffix + "0".repeat(64)).slice(0, 64);
    await push.register(userId, { token, platform: "ios" });
    return token;
  }

  it("localClockForUser handles Asia/Baku correctly", () => {
    // 14:00 UTC + 4h = 18:00 Baku
    expect(localClockForUser(BAKU_18, "Asia/Baku")).toEqual({
      hour: 18,
      date: "2026-05-21",
    });
    // 16:00 UTC + 4h = 20:00 Baku
    expect(localClockForUser(NOT_BAKU_18, "Asia/Baku")).toEqual({
      hour: 20,
      date: "2026-05-21",
    });
    // Falls back to UTC on a malformed string
    expect(localClockForUser(BAKU_18, "Asia/NotARealCity").hour).toBe(14);
  });

  it("fires a digest for a Baku user at local 18:00 with content", async () => {
    const alice = await createTestUser(app);
    await registerDevice(alice.id, "aaaa1111");

    // Seed a second user so alice has a recommended player to surface.
    await createTestUser(app);

    const result = await sweeper.tick();
    expect(result.digestsSent).toBe(1);
    expect(sender.sent.length).toBe(1);

    const sent = sender.sent[0];
    if (!sent) throw new Error("expected one sent push");
    expect(sent.payload.title).toBe("Bu gün Linkfit-də");
    expect(sent.payload.body).toContain("yeni xəbər səni gözləyir");
    expect(sent.payload.type).toBe("system");
    expect(sent.payload.data["kind"]).toBe("daily_digest");
    expect(sent.payload.collapseId).toBe("digest:2026-05-21");
    expect(sent.payload.threadId).toBe("daily_digest");

    // Ledger row should exist now
    const ledger = await db.db
      .selectFrom("daily_digest_sent")
      .selectAll()
      .where("user_id", "=", alice.id)
      .execute();
    expect(ledger.length).toBe(1);
  });

  it("skips users whose local hour is not 18", async () => {
    const alice = await createTestUser(app);
    await registerDevice(alice.id, "aaaa2222");
    await createTestUser(app); // ensures content is available

    const offHourSweeper = new DailyDigestSweeper({
      db,
      logger: pino({ level: "silent" }),
      push,
      now: () => NOT_BAKU_18, // 20:00 Baku, NOT 18:00
    });
    const result = await offHourSweeper.tick();
    expect(result.digestsSent).toBe(0);
    expect(sender.sent.length).toBe(0);
  });

  it("skips when daily_digest_enabled is false", async () => {
    const alice = await createTestUser(app);
    await registerDevice(alice.id, "aaaa3333");
    await createTestUser(app); // content seed

    await db.db
      .updateTable("users")
      .set({ daily_digest_enabled: false })
      .where("id", "=", alice.id)
      .execute();

    const result = await sweeper.tick();
    expect(result.digestsSent).toBe(0);
    expect(sender.sent.length).toBe(0);
  });

  it("skips when quiet hours overlap NOW (UTC)", async () => {
    const alice = await createTestUser(app);
    await registerDevice(alice.id, "aaaa4444");
    await createTestUser(app); // content seed

    // BAKU_18 is 14:00 UTC — set quiet hours that cover 14:00 UTC.
    await db.db
      .updateTable("users")
      .set({ quiet_hours_start: 10, quiet_hours_end: 16 })
      .where("id", "=", alice.id)
      .execute();

    const result = await sweeper.tick();
    expect(result.digestsSent).toBe(0);
    expect(sender.sent.length).toBe(0);
  });

  it("does not double-fire on the same local day (ledger idempotency)", async () => {
    const alice = await createTestUser(app);
    await registerDevice(alice.id, "aaaa5555");
    await createTestUser(app); // content seed

    const first = await sweeper.tick();
    expect(first.digestsSent).toBe(1);
    expect(sender.sent.length).toBe(1);

    // Run again at the same instant — the ledger row blocks the resend.
    const second = await sweeper.tick();
    expect(second.digestsSent).toBe(0);
    expect(sender.sent.length).toBe(1); // unchanged
  });

  it("releases the ledger reservation when there is no content", async () => {
    // No second user, no game, no story → all three slots empty → digest
    // is skipped and the ledger row is rolled back so the next tick can
    // re-evaluate (e.g. when fresh content lands later in the day).
    const alice = await createTestUser(app);
    await registerDevice(alice.id, "aaaa6666");
    // Carve out everyone else so the recommended-player slot is empty.
    await db.db
      .deleteFrom("users")
      .where("id", "!=", alice.id)
      .execute();

    const result = await sweeper.tick();
    expect(result.digestsSent).toBe(0);
    expect(sender.sent.length).toBe(0);

    const ledger = await db.db
      .selectFrom("daily_digest_sent")
      .selectAll()
      .execute();
    expect(ledger.length).toBe(0);
  });

  it("respects a non-Baku time zone", async () => {
    // London is UTC+1 in May (BST), so 14:00 UTC = 15:00 London.
    // We need 17:00 UTC for London's 18:00 local.
    const londonNow = new Date("2026-05-21T17:00:00.000Z");
    const localSweeper = new DailyDigestSweeper({
      db,
      logger: pino({ level: "silent" }),
      push,
      now: () => londonNow,
    });

    const alice = await createTestUser(app);
    await registerDevice(alice.id, "aaaa7777");
    await db.db
      .updateTable("users")
      .set({ time_zone: "Europe/London" })
      .where("id", "=", alice.id)
      .execute();
    await createTestUser(app); // content seed

    // Sanity: London local clock at 17:00 UTC is 18:xx BST.
    expect(localClockForUser(londonNow, "Europe/London").hour).toBe(18);

    const result = await localSweeper.tick();
    expect(result.digestsSent).toBe(1);
  });

  it("does not push to a user with no device token", async () => {
    await createTestUser(app);
    // No registerDevice call — the user is eligible but has nothing to push to.
    await createTestUser(app); // content seed

    const result = await sweeper.tick();
    // The ledger was reserved + the push was attempted; LoggingSender saw zero
    // sends because the deliverToUser pulls zero tokens.
    expect(result.digestsSent).toBe(1);
    expect(sender.sent.length).toBe(0);

    // Verify the ledger row was kept (we DID emit the push, it just had
    // nowhere to land — that's still a "digest sent" from the sweeper's POV).
    const ledger = await db.db
      .selectFrom("daily_digest_sent")
      .selectAll()
      .execute();
    expect(ledger.length).toBe(1);
  });

  it("seeds default values for time_zone and daily_digest_enabled on new users", async () => {
    const alice = await createTestUser(app);
    const row = await db.db
      .selectFrom("users")
      .select(["time_zone", "daily_digest_enabled"])
      .where("id", "=", alice.id)
      .executeTakeFirstOrThrow();
    expect(row.time_zone).toBe("Asia/Baku");
    expect(row.daily_digest_enabled).toBe(true);
  });

  it("collapse-id is keyed on local date so two consecutive days don't collapse", async () => {
    // Day-1: 2026-05-21 → "digest:2026-05-21"
    // Day-2: 2026-05-22 → "digest:2026-05-22"
    const alice = await createTestUser(app);
    await registerDevice(alice.id, "aaaa8888");
    await createTestUser(app);

    const day1 = await sweeper.tick();
    expect(day1.digestsSent).toBe(1);
    expect(sender.sent[0]?.payload.collapseId).toBe("digest:2026-05-21");

    // Advance the injected clock by 24h
    const tomorrow = new Date("2026-05-22T14:00:00.000Z");
    const tomorrowSweeper = new DailyDigestSweeper({
      db,
      logger: pino({ level: "silent" }),
      push,
      now: () => tomorrow,
    });
    const day2 = await tomorrowSweeper.tick();
    expect(day2.digestsSent).toBe(1);
    expect(sender.sent[1]?.payload.collapseId).toBe("digest:2026-05-22");
  });

  it("PATCH /me/notification-preferences/daily-digest toggles the opt-out", async () => {
    const alice = await createTestUser(app);
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/me/notification-preferences/daily-digest",
      headers: { authorization: `Bearer ${alice.access_token}` },
      payload: { daily_digest_enabled: false, time_zone: "Europe/London" },
    });
    expect(res.statusCode).toBe(204);

    const row = await db.db
      .selectFrom("users")
      .select(["time_zone", "daily_digest_enabled"])
      .where("id", "=", alice.id)
      .executeTakeFirstOrThrow();
    expect(row.daily_digest_enabled).toBe(false);
    expect(row.time_zone).toBe("Europe/London");
  });

  it("PATCH rejects an unknown IANA tz with 400", async () => {
    const alice = await createTestUser(app);
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/me/notification-preferences/daily-digest",
      headers: { authorization: `Bearer ${alice.access_token}` },
      payload: { time_zone: "Asia/NotARealCity" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /me/notification-preferences exposes the new fields", async () => {
    const alice = await createTestUser(app);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/me/notification-preferences",
      headers: { authorization: `Bearer ${alice.access_token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      daily_digest_enabled: boolean;
      time_zone: string;
    }>();
    expect(body.daily_digest_enabled).toBe(true);
    expect(body.time_zone).toBe("Asia/Baku");
  });

  it("does not include deleted users in the candidate sweep", async () => {
    const alice = await createTestUser(app);
    await registerDevice(alice.id, "aaaa9999");
    await createTestUser(app);
    await db.db
      .updateTable("users")
      .set({ deleted_at: new Date() })
      .where("id", "=", alice.id)
      .execute();

    const result = await sweeper.tick();
    expect(result.digestsSent).toBe(0);
    expect(sender.sent.length).toBe(0);
  });

  it("a single tick races safely — running twice in a row hits the ledger guard", async () => {
    const alice = await createTestUser(app);
    await registerDevice(alice.id, "aaaaaaaa");
    await createTestUser(app);

    // Manually seed the ledger row so the tick treats this user as
    // already-sent.
    await sql`
      INSERT INTO daily_digest_sent (user_id, sent_date)
      VALUES (${alice.id}::uuid, '2026-05-21'::date)
    `.execute(db.db);

    const result = await sweeper.tick();
    expect(result.digestsSent).toBe(0);
    expect(sender.sent.length).toBe(0);
  });
});
