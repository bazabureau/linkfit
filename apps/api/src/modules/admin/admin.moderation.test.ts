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

interface EnrichedReport {
  id: string;
  reporter: { user_id: string; display_name: string | null };
  target_kind: string;
  target_id: string;
  target: Record<string, unknown>;
  reason: string;
  status: string;
  notes: string | null;
  reviewed_by_user_id: string | null;
  reviewer_display_name: string | null;
  reviewed_at: string | null;
  created_at: string;
}

interface ListResponse {
  reports: EnrichedReport[];
  total: number;
  next_cursor: string | null;
}

describe("admin moderation routes", () => {
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
    const u = await createTestUser(app, { display_name: "Mod" });
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
    payload: { target_kind: "user" | "game" | "message"; target_id: string; reason: string },
  ): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/reports",
      headers: { authorization: `Bearer ${reporter.access_token}` },
      payload,
    });
    if (res.statusCode !== 201) {
      throw new Error(`createReport failed: ${String(res.statusCode)} ${res.body}`);
    }
    return res.json<{ id: string }>().id;
  }

  // ─── Listing with target context ───────────────────────────────────────

  it("lists enriched reports with reporter and target context joined", async () => {
    const admin = await makeAdmin();
    const reporter = await createTestUser(app, { display_name: "Reporter" });
    const target = await createTestUser(app, { display_name: "Target" });

    await createReport(reporter, {
      target_kind: "user",
      target_id: target.id,
      reason: "harassment",
    });

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/admin/moderation/reports?status=pending&limit=20",
      headers: { authorization: `Bearer ${admin.access_token}` },
    });
    expect(list.statusCode).toBe(200);

    const body = list.json<ListResponse>();
    expect(body.total).toBe(1);
    expect(body.reports.length).toBe(1);

    const row = body.reports[0]!;
    expect(row.target_kind).toBe("user");
    expect(row.target_id).toBe(target.id);
    expect(row.reporter.user_id).toBe(reporter.id);
    expect(row.reporter.display_name).toBe("Reporter");
    expect(row.target.kind).toBe("user");
    expect(row.target.display_name).toBe("Target");
  });

  it("filters by status and uses cursor pagination", async () => {
    const admin = await makeAdmin();
    const target = await createTestUser(app);

    // Five separate reporters → five pending rows.
    const reporters = await Promise.all(
      Array.from({ length: 5 }, () => createTestUser(app)),
    );
    for (const r of reporters) {
      await createReport(r, {
        target_kind: "user",
        target_id: target.id,
        reason: "spam",
      });
    }

    const first = await app.inject({
      method: "GET",
      url: "/api/v1/admin/moderation/reports?status=pending&limit=2",
      headers: { authorization: `Bearer ${admin.access_token}` },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json<ListResponse>();
    expect(firstBody.reports.length).toBe(2);
    expect(firstBody.total).toBe(5);
    expect(firstBody.next_cursor).not.toBeNull();

    const second = await app.inject({
      method: "GET",
      url: `/api/v1/admin/moderation/reports?status=pending&limit=2&cursor=${encodeURIComponent(firstBody.next_cursor!)}`,
      headers: { authorization: `Bearer ${admin.access_token}` },
    });
    const secondBody = second.json<ListResponse>();
    expect(secondBody.reports.length).toBe(2);
    expect(secondBody.reports[0]!.id).not.toBe(firstBody.reports[0]!.id);

    // Status filter respected.
    const reviewed = await app.inject({
      method: "GET",
      url: "/api/v1/admin/moderation/reports?status=reviewed",
      headers: { authorization: `Bearer ${admin.access_token}` },
    });
    expect(reviewed.json<ListResponse>().total).toBe(0);
  });

  // ─── Review action ───────────────────────────────────────────────────

  it("dismiss action stamps the report dismissed and writes audit", async () => {
    const admin = await makeAdmin();
    const reporter = await createTestUser(app);
    const target = await createTestUser(app);
    const reportId = await createReport(reporter, {
      target_kind: "user",
      target_id: target.id,
      reason: "spam",
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/moderation/reports/${reportId}/review`,
      headers: { authorization: `Bearer ${admin.access_token}` },
      payload: { action: "dismiss", notes: "false positive" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<EnrichedReport>();
    expect(body.status).toBe("dismissed");
    expect(body.notes).toBe("false positive");
    expect(body.reviewed_by_user_id).toBe(admin.id);
    expect(body.reviewer_display_name).toBe("Mod");

    const audit = await sql<{ action: string; metadata: Record<string, unknown> }>`
      SELECT action, metadata FROM audit_log
       WHERE action = 'admin.moderation.review'
         AND entity_id = ${reportId}
    `.execute(db.db);
    expect(audit.rows.length).toBe(1);
    expect(audit.rows[0]!.metadata.action).toBe("dismiss");
    expect(audit.rows[0]!.metadata.status).toBe("dismissed");

    // The user target is untouched.
    const userRow = await db.db
      .selectFrom("users")
      .select(["deleted_at"])
      .where("id", "=", target.id)
      .executeTakeFirst();
    expect(userRow?.deleted_at).toBeNull();
  });

  it("deactivate_target on a user report soft-deletes the user + revokes refresh tokens", async () => {
    const admin = await makeAdmin();
    const reporter = await createTestUser(app);
    const target = await createTestUser(app);
    const reportId = await createReport(reporter, {
      target_kind: "user",
      target_id: target.id,
      reason: "harassment",
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/moderation/reports/${reportId}/review`,
      headers: { authorization: `Bearer ${admin.access_token}` },
      payload: { action: "deactivate_target", notes: "Multiple reports" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<EnrichedReport>().status).toBe("reviewed");

    const userRow = await db.db
      .selectFrom("users")
      .select(["deleted_at"])
      .where("id", "=", target.id)
      .executeTakeFirst();
    expect(userRow?.deleted_at).not.toBeNull();
  });

  it("delete_target on a game report cancels and soft-deletes the game", async () => {
    const admin = await makeAdmin();
    const host = await createTestUser(app);
    const reporter = await createTestUser(app);
    const game = await createGame(host);

    const reportId = await createReport(reporter, {
      target_kind: "game",
      target_id: game.id,
      reason: "inappropriate_content",
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/moderation/reports/${reportId}/review`,
      headers: { authorization: `Bearer ${admin.access_token}` },
      payload: { action: "delete_target" },
    });
    expect(res.statusCode).toBe(200);

    const gameRow = await db.db
      .selectFrom("games")
      .select(["status", "deleted_at"])
      .where("id", "=", game.id)
      .executeTakeFirst();
    expect(gameRow?.status).toBe("cancelled");
    expect(gameRow?.deleted_at).not.toBeNull();
  });

  it("reviewing the same report twice returns 409", async () => {
    const admin = await makeAdmin();
    const reporter = await createTestUser(app);
    const target = await createTestUser(app);
    const reportId = await createReport(reporter, {
      target_kind: "user",
      target_id: target.id,
      reason: "spam",
    });

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/admin/moderation/reports/${reportId}/review`,
      headers: { authorization: `Bearer ${admin.access_token}` },
      payload: { action: "warn" },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "POST",
      url: `/api/v1/admin/moderation/reports/${reportId}/review`,
      headers: { authorization: `Bearer ${admin.access_token}` },
      payload: { action: "dismiss" },
    });
    expect(second.statusCode).toBe(409);
  });

  // ─── User detail ──────────────────────────────────────────────────────

  it("returns enriched user detail with reports filed/received counts", async () => {
    const admin = await makeAdmin();
    const subject = await createTestUser(app, { display_name: "Subject" });
    const reporter = await createTestUser(app);
    const otherUser = await createTestUser(app);

    // Subject files one report.
    await createReport(subject, {
      target_kind: "user",
      target_id: otherUser.id,
      reason: "spam",
    });

    // Someone reports the subject.
    await createReport(reporter, {
      target_kind: "user",
      target_id: subject.id,
      reason: "harassment",
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/admin/moderation/users/${subject.id}`,
      headers: { authorization: `Bearer ${admin.access_token}` },
    });
    expect(res.statusCode).toBe(200);

    const body = res.json<{
      id: string;
      display_name: string;
      reports_filed_count: number;
      reports_received_count: number;
      recent_reports_filed: EnrichedReport[];
      recent_reports_received: EnrichedReport[];
    }>();
    expect(body.id).toBe(subject.id);
    expect(body.display_name).toBe("Subject");
    expect(body.reports_filed_count).toBe(1);
    expect(body.reports_received_count).toBe(1);
    expect(body.recent_reports_filed.length).toBe(1);
    expect(body.recent_reports_received.length).toBe(1);
  });

  it("returns 404 for unknown user detail", async () => {
    const admin = await makeAdmin();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/moderation/users/00000000-0000-0000-0000-000000000000",
      headers: { authorization: `Bearer ${admin.access_token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  // ─── Deactivate ───────────────────────────────────────────────────────

  it("deactivates a user with a reason and revokes refresh tokens", async () => {
    const admin = await makeAdmin();
    const target = await createTestUser(app);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/moderation/users/${target.id}/deactivate`,
      headers: { authorization: `Bearer ${admin.access_token}` },
      payload: { reason: "Repeated harassment", duration_days: 7 },
    });
    expect(res.statusCode).toBe(204);

    const userRow = await db.db
      .selectFrom("users")
      .select(["deleted_at"])
      .where("id", "=", target.id)
      .executeTakeFirst();
    expect(userRow?.deleted_at).not.toBeNull();

    const audit = await sql<{ metadata: Record<string, unknown> }>`
      SELECT metadata FROM audit_log
       WHERE action = 'admin.users.deactivate'
         AND entity_id = ${target.id}
    `.execute(db.db);
    expect(audit.rows.length).toBe(1);
    expect(audit.rows[0]!.metadata.reason).toBe("Repeated harassment");
    expect(audit.rows[0]!.metadata.duration_days).toBe(7);
  });

  it("deactivating an already-deactivated user returns 409", async () => {
    const admin = await makeAdmin();
    const target = await createTestUser(app);

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/admin/moderation/users/${target.id}/deactivate`,
      headers: { authorization: `Bearer ${admin.access_token}` },
      payload: { reason: "test" },
    });
    expect(first.statusCode).toBe(204);

    const second = await app.inject({
      method: "POST",
      url: `/api/v1/admin/moderation/users/${target.id}/deactivate`,
      headers: { authorization: `Bearer ${admin.access_token}` },
      payload: { reason: "test again" },
    });
    expect(second.statusCode).toBe(409);
  });

  // ─── Auth ─────────────────────────────────────────────────────────────

  it("requires admin role on every moderation endpoint", async () => {
    const regular = await createTestUser(app);
    const headers = { authorization: `Bearer ${regular.access_token}` };
    const someUuid = "00000000-0000-0000-0000-000000000000";

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/admin/moderation/reports",
      headers,
    });
    expect(list.statusCode).toBe(403);

    const review = await app.inject({
      method: "POST",
      url: `/api/v1/admin/moderation/reports/${someUuid}/review`,
      headers,
      payload: { action: "dismiss" },
    });
    expect(review.statusCode).toBe(403);

    const userDetail = await app.inject({
      method: "GET",
      url: `/api/v1/admin/moderation/users/${someUuid}`,
      headers,
    });
    expect(userDetail.statusCode).toBe(403);

    const deactivate = await app.inject({
      method: "POST",
      url: `/api/v1/admin/moderation/users/${someUuid}/deactivate`,
      headers,
      payload: { reason: "test" },
    });
    expect(deactivate.statusCode).toBe(403);
  });
});
