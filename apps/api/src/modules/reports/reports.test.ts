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
  type TestUser,
} from "../../../tests/helpers/fixtures.js";
import { type DbHandle } from "../../shared/db/pool.js";

const ONE_HOUR_MS = 60 * 60 * 1000;

async function getPadelSportId(db: DbHandle): Promise<string> {
  const row = await sql<{ id: string }>`SELECT id FROM sports WHERE slug = 'padel'`.execute(
    db.db,
  );
  return row.rows[0]!.id;
}

interface ReportPayload {
  id: string;
  status: string;
  reason: string;
  target_kind: string;
  target_id: string;
  notes: string | null;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
}

describe("reports module", () => {
  const env = buildTestEnv();
  let app: LinkfitServer;
  let db: DbHandle;
  let padelId: string;

  beforeAll(async () => {
    db = buildTestDb();
    app = await buildServer({ env, logger: pino({ level: "silent" }), db });
    padelId = await getPadelSportId(db);
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
    padelId = await getPadelSportId(db);
  });

  async function makeAdmin(): Promise<TestUser> {
    const u = await createTestUser(app, { display_name: "Admin" });
    await promoteToAdmin(db, u.id, "admin");
    return u;
  }

  async function createGame(host: TestUser): Promise<{ id: string }> {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/games",
      headers: { authorization: `Bearer ${host.access_token}` },
      payload: {
        sport_id: padelId,
        lat: 40.4093,
        lng: 49.8671,
        starts_at: new Date(Date.now() + ONE_HOUR_MS).toISOString(),
        duration_minutes: 90,
        capacity: 4,
      },
    });
    if (res.statusCode !== 201) {
      throw new Error(`createGame failed: ${String(res.statusCode)} ${res.body}`);
    }
    return res.json<{ id: string }>();
  }

  async function createReport(
    reporter: TestUser,
    payload: { target_kind: "user" | "game" | "message"; target_id: string; reason: string; notes?: string },
  ): Promise<{ statusCode: number; body: ReportPayload | { error: { code: string } } }> {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      headers: { authorization: `Bearer ${reporter.access_token}` },
      payload,
    });
    return { statusCode: res.statusCode, body: res.json() };
  }

  // ────────────────────────────────────────────────────────────────────────

  it("creates a user-targeted report and exposes it in the admin queue", async () => {
    const admin = await makeAdmin();
    const reporter = await createTestUser(app);
    const target = await createTestUser(app);

    const create = await createReport(reporter, {
      target_kind: "user",
      target_id: target.id,
      reason: "harassment",
      notes: "Repeated abuse in DMs",
    });
    expect(create.statusCode).toBe(201);
    const created = create.body as ReportPayload;
    expect(created.status).toBe("pending");
    expect(created.reason).toBe("harassment");
    expect(created.notes).toBe("Repeated abuse in DMs");

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/admin/reports?status=pending&limit=20",
      headers: { authorization: `Bearer ${admin.access_token}` },
    });
    expect(list.statusCode).toBe(200);
    const listBody = list.json<{ items: ReportPayload[]; total: number }>();
    expect(listBody.total).toBe(1);
    expect(listBody.items[0]!.id).toBe(created.id);
  });

  it("rejects an invalid reason and reports a missing target with 404", async () => {
    const reporter = await createTestUser(app);

    // Invalid reason -> 400 (zod validation).
    const badReason = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      headers: { authorization: `Bearer ${reporter.access_token}` },
      payload: {
        target_kind: "user",
        target_id: reporter.id,
        reason: "not_a_real_reason",
      },
    });
    expect(badReason.statusCode).toBe(400);

    // Valid reason but non-existent target -> 404.
    const ghostId = "00000000-0000-0000-0000-000000000000";
    const noTarget = await createReport(reporter, {
      target_kind: "user",
      target_id: ghostId,
      reason: "spam",
    });
    expect(noTarget.statusCode).toBe(404);
  });

  it("enforces a 5/hour-per-user rate limit on report creation", async () => {
    const reporter = await createTestUser(app);
    const targets = await Promise.all(
      Array.from({ length: 6 }, () => createTestUser(app)),
    );

    // First five must succeed.
    for (let i = 0; i < 5; i += 1) {
      const r = await createReport(reporter, {
        target_kind: "user",
        target_id: targets[i]!.id,
        reason: "spam",
      });
      expect(r.statusCode, `attempt ${String(i + 1)}`).toBe(201);
    }
    // Sixth in the same hour gets 429.
    const sixth = await createReport(reporter, {
      target_kind: "user",
      target_id: targets[5]!.id,
      reason: "spam",
    });
    expect(sixth.statusCode).toBe(429);
  });

  it("auto-flags a target after 3+ harassment reports of one entity", async () => {
    const target = await createTestUser(app);
    const reporters = await Promise.all(
      Array.from({ length: 3 }, () => createTestUser(app)),
    );

    for (const r of reporters) {
      const res = await createReport(r, {
        target_kind: "user",
        target_id: target.id,
        reason: "harassment",
      });
      expect(res.statusCode).toBe(201);
    }

    const flagged = await sql<{ entity_id: string; action: string }>`
      SELECT entity_id, action FROM audit_log
       WHERE action = 'report.auto_flagged'
         AND entity = 'user'
         AND entity_id = ${target.id}
    `.execute(db.db);
    expect(flagged.rows.length).toBe(1);

    // A fourth report does NOT emit a duplicate auto_flagged row.
    const fourth = await createTestUser(app);
    const r4 = await createReport(fourth, {
      target_kind: "user",
      target_id: target.id,
      reason: "harassment",
    });
    expect(r4.statusCode).toBe(201);

    const flaggedAgain = await sql<{ c: string }>`
      SELECT count(*)::text AS c FROM audit_log
       WHERE action = 'report.auto_flagged'
         AND entity = 'user'
         AND entity_id = ${target.id}
    `.execute(db.db);
    expect(Number(flaggedAgain.rows[0]!.c)).toBe(1);
  });

  it("admin PATCH transitions a report to reviewed and writes an audit row", async () => {
    const admin = await makeAdmin();
    const reporter = await createTestUser(app);
    const target = await createTestUser(app);

    const create = await createReport(reporter, {
      target_kind: "user",
      target_id: target.id,
      reason: "no_show",
    });
    expect(create.statusCode).toBe(201);
    const reportId = (create.body as ReportPayload).id;

    const review = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/reports/${reportId}`,
      headers: { authorization: `Bearer ${admin.access_token}` },
      payload: { status: "reviewed", notes: "Player was warned." },
    });
    expect(review.statusCode).toBe(200);
    const reviewed = review.json<ReportPayload>();
    expect(reviewed.status).toBe("reviewed");
    expect(reviewed.notes).toBe("Player was warned.");
    expect(reviewed.reviewed_by_user_id).toBe(admin.id);
    expect(reviewed.reviewed_at).not.toBeNull();

    // Audit row exists.
    const audit = await sql<{ action: string; entity_id: string }>`
      SELECT action, entity_id FROM audit_log
       WHERE action = 'admin.reports.review'
         AND entity_id = ${reportId}
    `.execute(db.db);
    expect(audit.rows.length).toBe(1);

    // Re-reviewing the same row is a 409.
    const second = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/reports/${reportId}`,
      headers: { authorization: `Bearer ${admin.access_token}` },
      payload: { status: "dismissed" },
    });
    expect(second.statusCode).toBe(409);
  });

  it("requires admin role on every /admin/reports endpoint", async () => {
    const regular = await createTestUser(app);
    const headers = { authorization: `Bearer ${regular.access_token}` };
    const someUuid = "00000000-0000-0000-0000-000000000000";

    const listRes = await app.inject({
      method: "GET",
      url: "/api/v1/admin/reports",
      headers,
    });
    expect(listRes.statusCode).toBe(403);

    const patchRes = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/reports/${someUuid}`,
      headers,
      payload: { status: "reviewed" },
    });
    expect(patchRes.statusCode).toBe(403);

    // Unauthenticated POST /api/v1/reports -> 401.
    const noAuth = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      payload: { target_kind: "user", target_id: someUuid, reason: "spam" },
    });
    expect(noAuth.statusCode).toBe(401);
  });

  it("supports reporting a game target", async () => {
    const host = await createTestUser(app);
    const reporter = await createTestUser(app);
    const game = await createGame(host);

    const res = await createReport(reporter, {
      target_kind: "game",
      target_id: game.id,
      reason: "inappropriate_content",
    });
    expect(res.statusCode).toBe(201);
    const out = res.body as ReportPayload;
    expect(out.target_kind).toBe("game");
    expect(out.target_id).toBe(game.id);
  });

  it("filters the admin queue by status and respects limit/offset", async () => {
    const admin = await makeAdmin();
    const target = await createTestUser(app);

    // Five distinct reporters create one report each → five pending rows.
    const reporters = await Promise.all(
      Array.from({ length: 5 }, () => createTestUser(app)),
    );
    for (const r of reporters) {
      const res = await createReport(r, {
        target_kind: "user",
        target_id: target.id,
        reason: "fake_profile",
      });
      expect(res.statusCode).toBe(201);
    }

    const firstPage = await app.inject({
      method: "GET",
      url: "/api/v1/admin/reports?status=pending&limit=2&offset=0",
      headers: { authorization: `Bearer ${admin.access_token}` },
    });
    expect(firstPage.statusCode).toBe(200);
    const fp = firstPage.json<{ items: ReportPayload[]; total: number }>();
    expect(fp.total).toBe(5);
    expect(fp.items.length).toBe(2);

    const secondPage = await app.inject({
      method: "GET",
      url: "/api/v1/admin/reports?status=pending&limit=2&offset=2",
      headers: { authorization: `Bearer ${admin.access_token}` },
    });
    const sp = secondPage.json<{ items: ReportPayload[]; total: number }>();
    expect(sp.items.length).toBe(2);
    expect(sp.items[0]!.id).not.toBe(fp.items[0]!.id);

    // Filter by reviewed → zero rows so far.
    const reviewed = await app.inject({
      method: "GET",
      url: "/api/v1/admin/reports?status=reviewed",
      headers: { authorization: `Bearer ${admin.access_token}` },
    });
    expect(reviewed.json<{ total: number }>().total).toBe(0);
  });
});
