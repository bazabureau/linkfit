import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import { sql } from "kysely";
import { buildServer, type LinkfitServer } from "../../shared/http/server.js";
import { buildTestDb } from "../../../tests/helpers/db.js";
import { buildTestEnv } from "../../../tests/helpers/env.js";
import {
  createTestUser,
  promoteToAdmin,
  truncateAll,
} from "../../../tests/helpers/fixtures.js";
import { type DbHandle } from "../../shared/db/pool.js";
import { DigestService, WEEKLY_DIGEST_KIND } from "./digest.service.js";
import { DigestScheduler } from "./digest.scheduler.js";
import { digestRepository } from "./digest.repository.js";
import {
  type DigestMailTransport,
  type DigestOutgoingEmail,
} from "./digest.transport.js";

/**
 * In-memory mail transport for the test suite. Mirrors the production
 * `LoggingTransport` API but lets us inspect the outbox synchronously.
 */
class CaptureTransport implements DigestMailTransport {
  private readonly _outbox: DigestOutgoingEmail[] = [];
  public get outbox(): readonly DigestOutgoingEmail[] {
    return this._outbox;
  }
  public send(message: DigestOutgoingEmail): Promise<void> {
    this._outbox.push(message);
    return Promise.resolve();
  }
  public clear(): void {
    this._outbox.length = 0;
  }
}

describe("digest agent", () => {
  const env = buildTestEnv();
  let app: LinkfitServer;
  let db: DbHandle;
  let transport: CaptureTransport;
  let service: DigestService;

  beforeAll(async () => {
    db = buildTestDb();
    transport = new CaptureTransport();
    app = await buildServer({
      env,
      logger: pino({ level: "silent" }),
      db,
      mailTransport: transport,
    });
    await app.ready();
    service = new DigestService({
      db,
      logger: pino({ level: "silent" }),
      transport,
    });
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
    // truncateAll doesn't touch email_digest_log because it isn't in the
    // shared truncate list (the helper is module-scoped to the older
    // tables). We clear it here so each test starts from a clean log.
    await sql`TRUNCATE TABLE email_digest_log`.execute(db.db);
    transport.clear();
  });

  // 1. Recipient filter — only opted-in + verified accounts are picked.
  it("only enrolls users who opted in AND have a verified email", async () => {
    const optedAndVerified = await createTestUser(app, { display_name: "Alpha" });
    const optedNotVerified = await createTestUser(app, { display_name: "Beta" });
    const verifiedNotOpted = await createTestUser(app, { display_name: "Gamma" });
    const neither = await createTestUser(app, { display_name: "Delta" });

    await digestRepository.markVerified(db, optedAndVerified.id);
    await digestRepository.setWeeklyDigestPref(db, optedAndVerified.id, true);

    // Opted in but never verified.
    await digestRepository.setWeeklyDigestPref(db, optedNotVerified.id, true);

    // Verified but never opted.
    await digestRepository.markVerified(db, verifiedNotOpted.id);

    // `neither` left as default.
    expect(neither.id).toBeTruthy(); // keep test fixture alive for clarity

    const recipients = await service.weeklyDigestRecipients();
    const ids = recipients.map((r) => r.user_id);
    expect(ids).toContain(optedAndVerified.id);
    expect(ids).not.toContain(optedNotVerified.id);
    expect(ids).not.toContain(verifiedNotOpted.id);
    expect(ids).not.toContain(neither.id);
  });

  // 2. Email verification gate is strict — confirms the same negative.
  it("excludes users without email_verified_at even when opted in", async () => {
    const u = await createTestUser(app, { display_name: "Echo" });
    await digestRepository.setWeeklyDigestPref(db, u.id, true);
    // Intentionally NOT calling markVerified.

    const result = await service.runWeeklyDigest();
    expect(result.attempted).toBe(0);
    expect(result.sent).toBe(0);
    expect(transport.outbox).toHaveLength(0);
  });

  // 3. HTML rendering — key strings present + escaping works.
  it("renders the weekly HTML with all the section headings and brand markers", async () => {
    const u = await createTestUser(app, { display_name: "Zoe <O'Brien>" });
    await digestRepository.markVerified(db, u.id);
    await digestRepository.setWeeklyDigestPref(db, u.id, true);

    // Drive enough content into the DB that every section renders.
    // (a) New follower:
    const follower = await createTestUser(app, { display_name: "Friend1" });
    await sql`
      INSERT INTO follows (follower_user_id, followed_user_id, created_at)
      VALUES (${follower.id}::uuid, ${u.id}::uuid, now() - interval '1 day')
    `.execute(db.db);

    // (b) Friend activity from someone u follows:
    const friend = await createTestUser(app, { display_name: "Cooper" });
    await sql`
      INSERT INTO follows (follower_user_id, followed_user_id, created_at)
      VALUES (${u.id}::uuid, ${friend.id}::uuid, now() - interval '2 days')
    `.execute(db.db);
    await sql`
      INSERT INTO feed_events (actor_user_id, type, payload, visibility, created_at)
      VALUES (${friend.id}::uuid, 'won_match'::feed_event_type, '{}'::jsonb, 'followers'::feed_visibility, now() - interval '1 hour')
    `.execute(db.db);

    // (c) Badge unlocked:
    await sql`
      INSERT INTO achievements (slug, name, description, icon_name, criteria)
      VALUES ('first_game', 'First Game', 'Play your first game', 'trophy.fill', '{}'::jsonb)
      ON CONFLICT (slug) DO NOTHING
    `.execute(db.db);
    await sql`
      INSERT INTO user_achievements (user_id, achievement_slug, unlocked_at)
      VALUES (${u.id}::uuid, 'first_game', now() - interval '2 days')
    `.execute(db.db);

    const result = await service.runWeeklyDigest();
    expect(result.sent).toBe(1);
    expect(transport.outbox).toHaveLength(1);
    const msg = transport.outbox[0];
    expect(msg).toBeDefined();
    if (!msg) return;

    // Brand markers + lime accent hex string somewhere in the HTML.
    expect(msg.html).toContain("LINKFIT");
    expect(msg.html).toContain("#c1ff72");
    // Dark charcoal header hex too.
    expect(msg.html).toContain("#101418");

    // Section headings.
    expect(msg.html).toContain("Players who followed you");
    expect(msg.html).toContain("Friend activity");
    expect(msg.html).toContain("Badges unlocked");

    // HTML escaping — display name had angle brackets and a quote.
    expect(msg.html).toContain("Zoe &lt;O&#39;Brien&gt;");
    expect(msg.html).not.toContain("Zoe <O'Brien>"); // raw must not leak

    // Content strings.
    expect(msg.html).toContain("Friend1");
    expect(msg.html).toContain("First Game");

    // Plain-text fallback is non-empty and has the team signature.
    expect(msg.text).toContain("— The Linkfit team");
    expect(msg.text).toContain("Friend1");

    // Subject is the expected shape.
    expect(msg.subject).toMatch(/^Your Linkfit week — \d+ upcoming/);
  });

  // 4. Idempotency — same-day re-run does not double-send.
  it("does not re-send to the same user within the same UTC day", async () => {
    const u = await createTestUser(app, { display_name: "Iris" });
    await digestRepository.markVerified(db, u.id);
    await digestRepository.setWeeklyDigestPref(db, u.id, true);
    // Give the user some content so the first run actually sends.
    const follower = await createTestUser(app, { display_name: "Casey" });
    await sql`
      INSERT INTO follows (follower_user_id, followed_user_id, created_at)
      VALUES (${follower.id}::uuid, ${u.id}::uuid, now() - interval '1 hour')
    `.execute(db.db);

    const first = await service.runWeeklyDigest();
    expect(first.sent).toBe(1);
    expect(transport.outbox).toHaveLength(1);

    const second = await service.runWeeklyDigest();
    expect(second.sent).toBe(0);
    expect(second.skipped_already_sent).toBe(1);
    // Outbox unchanged — no second SMTP delivery happened.
    expect(transport.outbox).toHaveLength(1);

    // Single log row — composite PK on (user, kind, date) held.
    const logRows = await digestRepository.logCount(
      db,
      u.id,
      WEEKLY_DIGEST_KIND,
    );
    expect(logRows).toBe(1);
  });

  // 5. Empty digests are suppressed — no transport.send happens, but the
  //    log row is written so the next attempt within the same day skips.
  it("does not send when the user has nothing to digest this week", async () => {
    const u = await createTestUser(app, { display_name: "Empty" });
    await digestRepository.markVerified(db, u.id);
    await digestRepository.setWeeklyDigestPref(db, u.id, true);

    const result = await service.runWeeklyDigest();
    expect(result.attempted).toBe(1);
    expect(result.sent).toBe(0);
    expect(result.skipped_empty).toBe(1);
    expect(transport.outbox).toHaveLength(0);
  });

  // 6. Admin route — admin can trigger; non-admin gets 403; unauth gets 401.
  it("admin route triggers a run and rejects non-admin / unauth callers", async () => {
    const admin = await createTestUser(app, { display_name: "Admin" });
    const peasant = await createTestUser(app, { display_name: "Peasant" });
    await promoteToAdmin(db, admin.id, "admin");

    // Unauthenticated → 401.
    const unauth = await app.inject({
      method: "POST",
      url: "/api/v1/admin/digest/run-weekly",
    });
    expect(unauth.statusCode).toBe(401);

    // Non-admin → 403.
    const forbidden = await app.inject({
      method: "POST",
      url: "/api/v1/admin/digest/run-weekly",
      headers: { authorization: `Bearer ${peasant.access_token}` },
    });
    expect(forbidden.statusCode).toBe(403);

    // Admin → 200 with counters.
    const ok = await app.inject({
      method: "POST",
      url: "/api/v1/admin/digest/run-weekly",
      headers: { authorization: `Bearer ${admin.access_token}` },
    });
    expect(ok.statusCode).toBe(200);
    const body = ok.json<{
      attempted: number;
      sent: number;
      skipped_empty: number;
      skipped_already_sent: number;
      failed: number;
    }>();
    expect(body.attempted).toBe(0);
    expect(body.sent).toBe(0);
  });

  // 7. Scheduler — Monday 09:00 UTC window detection + fires on tick.
  it("scheduler fires only inside the Monday 09:00 UTC window", async () => {
    expect(
      DigestScheduler.isMondayNineUtc(new Date("2026-05-18T09:30:00Z")),
    ).toBe(true); // 2026-05-18 is a Monday
    expect(
      DigestScheduler.isMondayNineUtc(new Date("2026-05-19T09:00:00Z")),
    ).toBe(false); // Tuesday
    expect(
      DigestScheduler.isMondayNineUtc(new Date("2026-05-18T08:59:59Z")),
    ).toBe(false); // 08:xx
    expect(
      DigestScheduler.isMondayNineUtc(new Date("2026-05-18T10:00:00Z")),
    ).toBe(false); // 10:xx

    // Drive the scheduler with a frozen Monday-09:15 clock + a recipient
    // who'd otherwise be picked up. The second `runOnce()` call should be
    // suppressed by the in-process minute guard.
    const u = await createTestUser(app, { display_name: "Schedled" });
    await digestRepository.markVerified(db, u.id);
    await digestRepository.setWeeklyDigestPref(db, u.id, true);
    const follower = await createTestUser(app, { display_name: "Pal" });
    await sql`
      INSERT INTO follows (follower_user_id, followed_user_id, created_at)
      VALUES (${follower.id}::uuid, ${u.id}::uuid, now() - interval '1 hour')
    `.execute(db.db);

    let nowVal = new Date("2026-05-18T09:15:00Z");
    const scheduler = new DigestScheduler({
      service,
      logger: pino({ level: "silent" }),
      now: () => nowVal,
    });

    await scheduler.runOnce();
    expect(transport.outbox).toHaveLength(1);

    // Same minute — should not re-fire.
    await scheduler.runOnce();
    expect(transport.outbox).toHaveLength(1);

    // Move outside the window — still doesn't fire.
    nowVal = new Date("2026-05-19T09:15:00Z");
    await scheduler.runOnce();
    expect(transport.outbox).toHaveLength(1);

    scheduler.stop();
  });
});
