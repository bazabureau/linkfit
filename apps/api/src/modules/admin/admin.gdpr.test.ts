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

interface DeletionView {
  user_id: string;
  requested_at: string;
  hard_delete_at: string;
  days_remaining: number;
  user: { email: string | null; display_name: string | null } | null;
}

interface ExportView {
  id: string;
  user_id: string;
  status: string;
  is_downloadable: boolean;
}

/**
 * The admin GDPR routes are privacy-sensitive — these tests verify the
 * NUANCED redaction policy (see `admin.gdpr.service.ts`):
 *   - Deletions >48h away: admin sees `user: null` (UUID only)
 *   - Deletions ≤48h away: admin sees email + display_name
 *
 * Meta-audit rows must land in `audit_log` for every read so an external
 * reviewer can answer "which admin read the deletion list at <time>?".
 */
describe("admin GDPR routes", () => {
  const env = buildTestEnv();
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

  async function setupAdmin(): Promise<string> {
    const admin = await createTestUser(app, { display_name: "AdminOps" });
    await promoteToAdmin(db, admin.id, "admin");
    return admin.access_token;
  }

  // ── List deletions (nuanced redaction) ────────────────────────────

  it("redacts user fields when deletion is more than 48h away", async () => {
    const adminToken = await setupAdmin();
    const alice = await createTestUser(app, { display_name: "Alice" });

    // Far-future deletion: 30 days out.
    await db.db
      .insertInto("account_deletion_requests")
      .values({
        user_id: alice.id,
        hard_delete_at: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        status: "scheduled",
      })
      .execute();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/data-rights/deletions",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ items: DeletionView[] }>();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.user_id).toBe(alice.id);
    // Outside support window — user fields redacted.
    expect(body.items[0]?.user).toBeNull();
    expect(body.items[0]?.days_remaining).toBeGreaterThan(28);
  });

  it("exposes identifying fields when deletion is within 48h", async () => {
    const adminToken = await setupAdmin();
    const bob = await createTestUser(app, { display_name: "Bob" });

    // Within window: 24h until hard delete.
    await db.db
      .insertInto("account_deletion_requests")
      .values({
        user_id: bob.id,
        hard_delete_at: new Date(Date.now() + 24 * 3600 * 1000),
        status: "scheduled",
      })
      .execute();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/data-rights/deletions",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ items: DeletionView[] }>();
    expect(body.items[0]?.user?.display_name).toBe("Bob");
    expect(body.items[0]?.user?.email).toBe(bob.email);
  });

  it("denies access to non-admin callers", async () => {
    const regular = await createTestUser(app);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/data-rights/deletions",
      headers: { authorization: `Bearer ${regular.access_token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("writes a meta-audit row per list call", async () => {
    const adminToken = await setupAdmin();
    await app.inject({
      method: "GET",
      url: "/api/v1/admin/data-rights/deletions",
      headers: { authorization: `Bearer ${adminToken}` },
    });

    const auditRows = await sql<{ action: string; metadata: Record<string, unknown> }>`
      SELECT action, metadata FROM audit_log
       WHERE action = 'admin.gdpr.list_deletions'
    `.execute(db.db);
    expect(auditRows.rows).toHaveLength(1);
    expect(auditRows.rows[0]?.metadata).toMatchObject({ result_count: 0 });
  });

  // ── Force-cancel deletion ────────────────────────────────────────

  it("admin can force-cancel a scheduled deletion", async () => {
    const adminToken = await setupAdmin();
    const carol = await createTestUser(app);

    // Schedule via the user-facing endpoint so deleted_at + anonymization
    // happen exactly like in production.
    await app.inject({
      method: "DELETE",
      url: "/api/v1/me",
      headers: { authorization: `Bearer ${carol.access_token}` },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/data-rights/deletions/${carol.id}/cancel`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(204);

    const after = await db.db
      .selectFrom("account_deletion_requests")
      .select("status")
      .where("user_id", "=", carol.id)
      .executeTakeFirstOrThrow();
    expect(after.status).toBe("cancelled");

    const user = await db.db
      .selectFrom("users")
      .select("deleted_at")
      .where("id", "=", carol.id)
      .executeTakeFirstOrThrow();
    expect(user.deleted_at).toBeNull();
  });

  it("returns 404 when there's no scheduled deletion to cancel", async () => {
    const adminToken = await setupAdmin();
    const dave = await createTestUser(app);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/data-rights/deletions/${dave.id}/cancel`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("writes an action-specific audit row on force-cancel", async () => {
    const adminToken = await setupAdmin();
    const eve = await createTestUser(app);
    await app.inject({
      method: "DELETE",
      url: "/api/v1/me",
      headers: { authorization: `Bearer ${eve.access_token}` },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/admin/data-rights/deletions/${eve.id}/cancel`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    const rows = await sql<{ action: string; entity_id: string | null }>`
      SELECT action, entity_id FROM audit_log
       WHERE action = 'admin.gdpr.force_cancel_deletion'
    `.execute(db.db);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.entity_id).toBe(eve.id);
  });

  // ── List exports ─────────────────────────────────────────────────

  it("lists data exports with is_downloadable derived from row state", async () => {
    const adminToken = await setupAdmin();
    const frank = await createTestUser(app);

    await app.inject({
      method: "POST",
      url: "/api/v1/me/data-export",
      headers: { authorization: `Bearer ${frank.access_token}` },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/data-rights/exports",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ items: ExportView[] }>();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.user_id).toBe(frank.id);
    expect(body.items[0]?.status).toBe("ready");
    expect(body.items[0]?.is_downloadable).toBe(true);
  });
});
