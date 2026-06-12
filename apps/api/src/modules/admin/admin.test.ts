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

describe("admin routes", () => {
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

  async function createGame(host: TestUser, overrides: Record<string, unknown> = {}): Promise<{ id: string }> {
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
        ...overrides,
      },
    });
    if (res.statusCode !== 201) {
      throw new Error(`createGame failed: ${String(res.statusCode)} ${res.body}`);
    }
    return res.json<{ id: string }>();
  }

  it("returns 403 to a non-admin on every admin endpoint", async () => {
    const regular = await createTestUser(app);
    const headers = { authorization: `Bearer ${regular.access_token}` };

    const probes: { method: "GET" | "POST" | "PATCH" | "DELETE"; url: string; payload?: object }[] = [
      { method: "GET", url: "/api/v1/admin/stats" },
      { method: "GET", url: "/api/v1/admin/users" },
      { method: "POST", url: `/api/v1/admin/users/${regular.id}/role`, payload: { role: null } },
      { method: "POST", url: `/api/v1/admin/users/${regular.id}/soft-delete` },
      { method: "POST", url: `/api/v1/admin/users/${regular.id}/restore` },
      { method: "GET", url: "/api/v1/admin/games" },
      { method: "POST", url: `/api/v1/admin/games/${regular.id}/cancel` },
      {
        method: "POST",
        url: "/api/v1/admin/venues",
        payload: { name: "x", address: "y", lat: 0, lng: 0, is_partner: false },
      },
      {
        method: "PATCH",
        url: `/api/v1/admin/venues/${regular.id}`,
        payload: { name: "y" },
      },
      { method: "DELETE", url: `/api/v1/admin/venues/${regular.id}` },
      { method: "GET", url: "/api/v1/admin/tournaments" },
      {
        method: "POST",
        url: "/api/v1/admin/tournaments",
        payload: {
          name: "t",
          sport_id: padelId,
          starts_at: new Date(Date.now() + ONE_HOUR_MS).toISOString(),
          ends_at: new Date(Date.now() + 2 * ONE_HOUR_MS).toISOString(),
          max_squads: 4,
          squad_size: 2,
          entry_fee_minor: 0,
          currency: "AZN",
        },
      },
      { method: "PATCH", url: `/api/v1/admin/tournaments/${regular.id}`, payload: { name: "x" } },
      { method: "DELETE", url: `/api/v1/admin/tournaments/${regular.id}` },
      { method: "GET", url: `/api/v1/admin/tournaments/${regular.id}/entries` },
      {
        method: "DELETE",
        url: `/api/v1/admin/tournaments/${regular.id}/entries/${regular.id}`,
      },
      { method: "GET", url: "/api/v1/admin/audit" },
    ];

    for (const p of probes) {
      const baseOpts = { method: p.method, url: p.url, headers };
      const res = p.payload === undefined
        ? await app.inject(baseOpts)
        : await app.inject({ ...baseOpts, payload: p.payload });
      expect(res.statusCode, `${p.method} ${p.url}`).toBe(403);
    }
  });

  it("admin can list users with search by email or display name", async () => {
    const admin = await makeAdmin();
    await createTestUser(app, { display_name: "Alpha", email: `alpha-${Date.now()}@ex.com` });
    await createTestUser(app, { display_name: "Bravo", email: `bravo-${Date.now()}@ex.com` });

    const all = await app.inject({
      method: "GET",
      url: "/api/v1/admin/users",
      headers: { authorization: `Bearer ${admin.access_token}` },
    });
    expect(all.statusCode).toBe(200);
    const allBody = all.json<{ items: { display_name: string }[]; total: number }>();
    expect(allBody.total).toBeGreaterThanOrEqual(3);

    const search = await app.inject({
      method: "GET",
      url: "/api/v1/admin/users?q=Alpha",
      headers: { authorization: `Bearer ${admin.access_token}` },
    });
    expect(search.statusCode).toBe(200);
    const searchBody = search.json<{ items: { display_name: string }[]; total: number }>();
    expect(searchBody.items.some((i) => i.display_name === "Alpha")).toBe(true);
    expect(searchBody.items.every((i) => i.display_name !== "Bravo")).toBe(true);
  });

  it("soft-delete revokes all refresh tokens for the user", async () => {
    const admin = await makeAdmin();
    const victim = await createTestUser(app);

    // Sanity: victim's refresh token currently works.
    const okRefresh = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refresh_token: victim.refresh_token },
    });
    expect(okRefresh.statusCode).toBe(200);

    // Use the FRESH refresh token returned above for the post-soft-delete check.
    const fresh = okRefresh.json<{ refresh_token: string }>().refresh_token;

    const del = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${victim.id}/soft-delete`,
      headers: { authorization: `Bearer ${admin.access_token}` },
    });
    expect(del.statusCode).toBe(204);

    // All refresh tokens for that user must be revoked.
    const revokedCount = await sql<{ c: string }>`
      SELECT count(*)::text AS c
        FROM refresh_tokens
       WHERE user_id = ${victim.id} AND revoked_at IS NULL
    `.execute(db.db);
    expect(Number(revokedCount.rows[0]!.c)).toBe(0);

    // And refresh against the latest token fails.
    const stale = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refresh_token: fresh },
    });
    expect(stale.statusCode).toBe(401);
  });

  it("force-cancels a game and notifies confirmed participants", async () => {
    const admin = await makeAdmin();
    const host = await createTestUser(app);
    const joiner = await createTestUser(app);
    const game = await createGame(host);

    const joinRes = await app.inject({
      method: "POST",
      url: `/api/v1/games/${game.id}/join`,
      headers: { authorization: `Bearer ${joiner.access_token}` },
    });
    expect(joinRes.statusCode).toBe(200);

    const cancelRes = await app.inject({
      method: "POST",
      url: `/api/v1/admin/games/${game.id}/cancel`,
      headers: { authorization: `Bearer ${admin.access_token}` },
    });
    expect(cancelRes.statusCode).toBe(204);

    const statusRow = await sql<{ status: string }>`
      SELECT status::text AS status FROM games WHERE id = ${game.id}
    `.execute(db.db);
    expect(statusRow.rows[0]!.status).toBe("cancelled");

    // Both host and joiner should have a game_cancelled notification.
    const notifs = await sql<{ user_id: string }>`
      SELECT user_id FROM notifications
       WHERE type = 'game_cancelled'
         AND (payload->>'game_id') = ${game.id}
    `.execute(db.db);
    const notifiedIds = new Set(notifs.rows.map((r) => r.user_id));
    expect(notifiedIds.has(host.id)).toBe(true);
    expect(notifiedIds.has(joiner.id)).toBe(true);
  });

  it("blocks venue deletion with 409 when future games reference its courts", async () => {
    const admin = await makeAdmin();
    const host = await createTestUser(app);

    // Create venue + court directly via admin endpoint, then schedule a game on it.
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/admin/venues",
      headers: { authorization: `Bearer ${admin.access_token}` },
      payload: {
        name: "Blocking Venue",
        address: "addr",
        lat: 40.4,
        lng: 49.8,
        is_partner: true,
      },
    });
    expect(created.statusCode).toBe(201);
    const venueId = created.json<{ id: string }>().id;

    const court = await db.db
      .insertInto("courts")
      .values({
        venue_id: venueId,
        sport_id: padelId,
        name: "Court 1",
        hourly_price_minor: 5000,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    await createGame(host, { court_id: court.id });

    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/venues/${venueId}`,
      headers: { authorization: `Bearer ${admin.access_token}` },
    });
    expect(del.statusCode).toBe(409);
  });

  it("supports tournament create + update + soft-cancel happy path", async () => {
    const admin = await makeAdmin();
    const headers = { authorization: `Bearer ${admin.access_token}` };
    const startsAt = new Date(Date.now() + 24 * ONE_HOUR_MS).toISOString();
    const endsAt = new Date(Date.now() + 48 * ONE_HOUR_MS).toISOString();

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/admin/tournaments",
      headers,
      payload: {
        name: "Spring Cup",
        sport_id: padelId,
        starts_at: startsAt,
        ends_at: endsAt,
        max_squads: 8,
        squad_size: 2,
        entry_fee_minor: 0,
        currency: "AZN",
      },
    });
    expect(created.statusCode).toBe(201);
    const tournament = created.json<{ id: string; name: string; status: string }>();
    expect(tournament.status).toBe("announced");

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/tournaments/${tournament.id}`,
      headers,
      payload: { name: "Spring Cup 2026", status: "registration_open" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json<{ name: string; status: string }>().name).toBe("Spring Cup 2026");

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/tournaments/${tournament.id}`,
      headers,
    });
    expect(deleted.statusCode).toBe(204);

    // Soft-cancel: tournament row still exists with status=cancelled.
    const row = await sql<{ status: string }>`
      SELECT status::text AS status FROM tournaments WHERE id = ${tournament.id}
    `.execute(db.db);
    expect(row.rows[0]?.status).toBe("cancelled");

    // Audit log captured the cancel action.
    const audit = await sql<{ action: string }>`
      SELECT action FROM audit_log
       WHERE entity = 'tournament' AND entity_id = ${tournament.id}
       ORDER BY created_at DESC LIMIT 1
    `.execute(db.db);
    expect(audit.rows[0]?.action).toBe("admin.tournaments.cancel");

    // Second DELETE is idempotent (204, no extra audit row).
    const deletedAgain = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/tournaments/${tournament.id}`,
      headers,
    });
    expect(deletedAgain.statusCode).toBe(204);
  });

  it("rejects tournament create when ends_at <= starts_at (400)", async () => {
    const admin = await makeAdmin();
    const headers = { authorization: `Bearer ${admin.access_token}` };
    const startsAt = new Date(Date.now() + 48 * ONE_HOUR_MS).toISOString();
    const endsAt = new Date(Date.now() + 24 * ONE_HOUR_MS).toISOString(); // before starts

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/tournaments",
      headers,
      payload: {
        name: "Bad Dates Cup",
        sport_id: padelId,
        starts_at: startsAt,
        ends_at: endsAt,
        max_squads: 4,
        squad_size: 2,
        entry_fee_minor: 0,
        currency: "AZN",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects tournament create when registration_deadline is after starts_at (400)", async () => {
    const admin = await makeAdmin();
    const headers = { authorization: `Bearer ${admin.access_token}` };
    const startsAt = new Date(Date.now() + 24 * ONE_HOUR_MS).toISOString();
    const endsAt = new Date(Date.now() + 48 * ONE_HOUR_MS).toISOString();
    const deadline = new Date(Date.now() + 36 * ONE_HOUR_MS).toISOString(); // after start

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/tournaments",
      headers,
      payload: {
        name: "Late Deadline Cup",
        sport_id: padelId,
        starts_at: startsAt,
        ends_at: endsAt,
        registration_deadline: deadline,
        max_squads: 4,
        squad_size: 2,
        entry_fee_minor: 0,
        currency: "AZN",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("lists tournaments with status + sport filters and search", async () => {
    const admin = await makeAdmin();
    const headers = { authorization: `Bearer ${admin.access_token}` };
    const startsAt = new Date(Date.now() + 24 * ONE_HOUR_MS).toISOString();
    const endsAt = new Date(Date.now() + 48 * ONE_HOUR_MS).toISOString();

    // Two tournaments: one announced, one registration_open.
    const a = await app.inject({
      method: "POST",
      url: "/api/v1/admin/tournaments",
      headers,
      payload: {
        name: "Alpha Padel Open",
        sport_id: padelId,
        starts_at: startsAt,
        ends_at: endsAt,
        max_squads: 4,
        squad_size: 2,
        entry_fee_minor: 1000,
        currency: "AZN",
      },
    });
    expect(a.statusCode).toBe(201);

    const b = await app.inject({
      method: "POST",
      url: "/api/v1/admin/tournaments",
      headers,
      payload: {
        name: "Bravo Padel League",
        sport_id: padelId,
        starts_at: startsAt,
        ends_at: endsAt,
        max_squads: 4,
        squad_size: 2,
        entry_fee_minor: 0,
        currency: "AZN",
        status: "registration_open",
      },
    });
    expect(b.statusCode).toBe(201);

    // List, no filter — both present, ordered newest first.
    const all = await app.inject({
      method: "GET",
      url: "/api/v1/admin/tournaments",
      headers,
    });
    expect(all.statusCode).toBe(200);
    const allBody = all.json<{
      items: { name: string; status: string; entries_count: number }[];
      next_cursor: string | null;
    }>();
    expect(allBody.items.length).toBeGreaterThanOrEqual(2);
    expect(allBody.items.every((i) => typeof i.entries_count === "number")).toBe(true);

    // Status filter.
    const open = await app.inject({
      method: "GET",
      url: "/api/v1/admin/tournaments?status=registration_open",
      headers,
    });
    const openBody = open.json<{ items: { status: string }[] }>();
    expect(openBody.items.every((i) => i.status === "registration_open")).toBe(true);

    // Sport filter.
    const padel = await app.inject({
      method: "GET",
      url: "/api/v1/admin/tournaments?sport=padel",
      headers,
    });
    expect(padel.statusCode).toBe(200);

    // Search filter.
    const search = await app.inject({
      method: "GET",
      url: "/api/v1/admin/tournaments?q=Alpha",
      headers,
    });
    const searchBody = search.json<{ items: { name: string }[] }>();
    expect(searchBody.items.some((i) => i.name === "Alpha Padel Open")).toBe(true);
    expect(searchBody.items.every((i) => i.name !== "Bravo Padel League")).toBe(true);
  });

  it("blocks PATCH that flips status away from completed (409) and cancel on completed (409)", async () => {
    const admin = await makeAdmin();
    const headers = { authorization: `Bearer ${admin.access_token}` };
    const startsAt = new Date(Date.now() + 24 * ONE_HOUR_MS).toISOString();
    const endsAt = new Date(Date.now() + 48 * ONE_HOUR_MS).toISOString();

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/admin/tournaments",
      headers,
      payload: {
        name: "Locked Cup",
        sport_id: padelId,
        starts_at: startsAt,
        ends_at: endsAt,
        max_squads: 4,
        squad_size: 2,
        entry_fee_minor: 0,
        currency: "AZN",
      },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json<{ id: string }>().id;

    // Move to completed.
    const complete = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/tournaments/${id}`,
      headers,
      payload: { status: "completed" },
    });
    expect(complete.statusCode).toBe(200);

    // Try to reopen → 409.
    const reopen = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/tournaments/${id}`,
      headers,
      payload: { status: "registration_open" },
    });
    expect(reopen.statusCode).toBe(409);

    // Cannot cancel a completed tournament.
    const cancel = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/tournaments/${id}`,
      headers,
    });
    expect(cancel.statusCode).toBe(409);
  });

  it("parses entry_fee_minor correctly (zero, large, persists integer)", async () => {
    const admin = await makeAdmin();
    const headers = { authorization: `Bearer ${admin.access_token}` };
    const startsAt = new Date(Date.now() + 24 * ONE_HOUR_MS).toISOString();
    const endsAt = new Date(Date.now() + 48 * ONE_HOUR_MS).toISOString();

    const free = await app.inject({
      method: "POST",
      url: "/api/v1/admin/tournaments",
      headers,
      payload: {
        name: "Free Entry",
        sport_id: padelId,
        starts_at: startsAt,
        ends_at: endsAt,
        max_squads: 4,
        squad_size: 2,
        entry_fee_minor: 0,
        currency: "AZN",
      },
    });
    expect(free.statusCode).toBe(201);
    expect(free.json<{ entry_fee_minor: number }>().entry_fee_minor).toBe(0);

    const paid = await app.inject({
      method: "POST",
      url: "/api/v1/admin/tournaments",
      headers,
      payload: {
        name: "Premium Entry",
        sport_id: padelId,
        starts_at: startsAt,
        ends_at: endsAt,
        max_squads: 4,
        squad_size: 2,
        entry_fee_minor: 12345,
        currency: "USD",
      },
    });
    expect(paid.statusCode).toBe(201);
    const paidBody = paid.json<{ entry_fee_minor: number; currency: string }>();
    expect(paidBody.entry_fee_minor).toBe(12345);
    expect(paidBody.currency).toBe("USD");

    // Negative fee → 400.
    const neg = await app.inject({
      method: "POST",
      url: "/api/v1/admin/tournaments",
      headers,
      payload: {
        name: "Negative Fee",
        sport_id: padelId,
        starts_at: startsAt,
        ends_at: endsAt,
        max_squads: 4,
        squad_size: 2,
        entry_fee_minor: -1,
        currency: "AZN",
      },
    });
    expect(neg.statusCode).toBe(400);
  });

  it("lists entries and admin can remove a registered squad", async () => {
    const admin = await makeAdmin();
    const headers = { authorization: `Bearer ${admin.access_token}` };
    const captain = await createTestUser(app);
    const startsAt = new Date(Date.now() + 24 * ONE_HOUR_MS).toISOString();
    const endsAt = new Date(Date.now() + 48 * ONE_HOUR_MS).toISOString();

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/admin/tournaments",
      headers,
      payload: {
        name: "Squads Cup",
        sport_id: padelId,
        starts_at: startsAt,
        ends_at: endsAt,
        max_squads: 4,
        squad_size: 2,
        entry_fee_minor: 0,
        currency: "AZN",
        status: "registration_open",
      },
    });
    expect(created.statusCode).toBe(201);
    const tId = created.json<{ id: string }>().id;

    // Captain registers a squad (captain only — squad_size=2 minus captain = 0 invitees).
    const reg = await app.inject({
      method: "POST",
      url: `/api/v1/tournaments/${tId}/entries`,
      headers: { authorization: `Bearer ${captain.access_token}` },
      payload: { squad_name: "Captain Squad", player_ids: [] },
    });
    expect(reg.statusCode).toBe(201);
    const entryId = reg.json<{ id: string }>().id;

    // Admin lists entries.
    const list = await app.inject({
      method: "GET",
      url: `/api/v1/admin/tournaments/${tId}/entries`,
      headers,
    });
    expect(list.statusCode).toBe(200);
    const listBody = list.json<{
      items: { id: string; squad_name: string; captain_display_name: string }[];
    }>();
    expect(listBody.items.length).toBe(1);
    expect(listBody.items[0]?.squad_name).toBe("Captain Squad");

    // Admin removes the squad.
    const remove = await app.inject({
      method: "DELETE",
      url: `/api/v1/admin/tournaments/${tId}/entries/${entryId}`,
      headers,
    });
    expect(remove.statusCode).toBe(204);

    // Row flipped to withdrawn; audit row written.
    const row = await sql<{ status: string }>`
      SELECT status::text AS status FROM tournament_entries WHERE id = ${entryId}
    `.execute(db.db);
    expect(row.rows[0]?.status).toBe("withdrawn");

    const audit = await sql<{ action: string }>`
      SELECT action FROM audit_log
       WHERE entity = 'tournament_entry' AND entity_id = ${entryId}
    `.execute(db.db);
    expect(audit.rows.some((r) => r.action === "admin.tournaments.remove_entry")).toBe(true);

    // List entries on an unknown tournament → 404.
    const missing = await app.inject({
      method: "GET",
      url: `/api/v1/admin/tournaments/${captain.id}/entries`,
      headers,
    });
    expect(missing.statusCode).toBe(404);
  });

  // Reports lifecycle moved to modules/reports/reports.test.ts.

  it("audit log returns rows after admin actions", async () => {
    const admin = await makeAdmin();
    const headers = { authorization: `Bearer ${admin.access_token}` };

    // Trigger an audit-emitting action.
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/venues",
      headers,
      payload: {
        name: "Audit Test Venue",
        address: "addr",
        lat: 40.41,
        lng: 49.86,
        is_partner: false,
      },
    });
    expect(create.statusCode).toBe(201);

    const audit = await app.inject({
      method: "GET",
      url: "/api/v1/admin/audit?limit=20",
      headers,
    });
    expect(audit.statusCode).toBe(200);
    const body = audit.json<{ items: { action: string; actor_user_id: string | null }[] }>();
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.some((r) => r.action === "admin.venues.create")).toBe(true);
  });

  it("returns stats with correct shape for an admin", async () => {
    const admin = await makeAdmin();
    const headers = { authorization: `Bearer ${admin.access_token}` };

    const res = await app.inject({ method: "GET", url: "/api/v1/admin/stats", headers });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      total_users: number;
      users_last_7_days: number;
      games_this_week: number;
      games_completed_all_time: number;
      top_venues: { venue_id: string; venue_name: string; game_count: number }[];
      pending_reports: number;
    }>();
    expect(body.total_users).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.top_venues)).toBe(true);
    expect(body.pending_reports).toBeGreaterThanOrEqual(0);
  });

  // ─────────────── new: admin games surface ───────────────

  describe("admin games endpoints", () => {
    it("filters games by status (only matching rows come back)", async () => {
      const admin = await makeAdmin();
      const host = await createTestUser(app);
      const open = await createGame(host);
      const toCancel = await createGame(host, {
        starts_at: new Date(Date.now() + 2 * ONE_HOUR_MS).toISOString(),
      });
      // Cancel one to create variety.
      const cancelRes = await app.inject({
        method: "POST",
        url: `/api/v1/admin/games/${toCancel.id}/cancel`,
        headers: { authorization: `Bearer ${admin.access_token}` },
        payload: {},
      });
      expect(cancelRes.statusCode).toBe(204);

      const onlyOpen = await app.inject({
        method: "GET",
        url: "/api/v1/admin/games?status=open",
        headers: { authorization: `Bearer ${admin.access_token}` },
      });
      expect(onlyOpen.statusCode).toBe(200);
      const body = onlyOpen.json<{
        items: { id: string; status: string }[];
        total: number;
        next_cursor: string | null;
      }>();
      expect(body.items.every((g) => g.status === "open")).toBe(true);
      expect(body.items.some((g) => g.id === open.id)).toBe(true);
      expect(body.items.some((g) => g.id === toCancel.id)).toBe(false);
    });

    it("supports searching by host display name", async () => {
      const admin = await makeAdmin();
      const needle = await createTestUser(app, { display_name: "NeedleHost" });
      const hay = await createTestUser(app, { display_name: "Other" });
      const target = await createGame(needle);
      await createGame(hay);

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/games?q=NeedleHost",
        headers: { authorization: `Bearer ${admin.access_token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{
        items: { id: string; host_display_name: string }[];
      }>();
      expect(body.items.some((g) => g.id === target.id)).toBe(true);
      expect(body.items.every((g) => g.host_display_name === "NeedleHost")).toBe(true);
    });

    it("force-cancel records audit log row and accepts a reason", async () => {
      const admin = await makeAdmin();
      const host = await createTestUser(app);
      const game = await createGame(host);

      const cancelRes = await app.inject({
        method: "POST",
        url: `/api/v1/admin/games/${game.id}/cancel`,
        headers: { authorization: `Bearer ${admin.access_token}` },
        payload: { reason: "Venue unavailable" },
      });
      expect(cancelRes.statusCode).toBe(204);

      const auditRows = await sql<{ action: string; metadata: Record<string, unknown> }>`
        SELECT action, metadata
          FROM audit_log
         WHERE entity = 'game' AND entity_id = ${game.id}
         ORDER BY created_at DESC
      `.execute(db.db);
      expect(auditRows.rows.length).toBeGreaterThan(0);
      const cancelAudit = auditRows.rows.find((r) => r.action === "admin.games.cancel");
      expect(cancelAudit).toBeDefined();
      expect((cancelAudit!.metadata as { reason?: string }).reason).toBe("Venue unavailable");
    });

    it("detail endpoint returns participants + audit timeline", async () => {
      const admin = await makeAdmin();
      const host = await createTestUser(app);
      const joiner = await createTestUser(app, { display_name: "JoinerOne" });
      const game = await createGame(host);

      const join = await app.inject({
        method: "POST",
        url: `/api/v1/games/${game.id}/join`,
        headers: { authorization: `Bearer ${joiner.access_token}` },
      });
      expect(join.statusCode).toBe(200);

      // Trigger an audit-emitting admin action so the timeline isn't empty.
      const cancelRes = await app.inject({
        method: "POST",
        url: `/api/v1/admin/games/${game.id}/cancel`,
        headers: { authorization: `Bearer ${admin.access_token}` },
        payload: {},
      });
      expect(cancelRes.statusCode).toBe(204);

      const detail = await app.inject({
        method: "GET",
        url: `/api/v1/admin/games/${game.id}`,
        headers: { authorization: `Bearer ${admin.access_token}` },
      });
      expect(detail.statusCode).toBe(200);
      const body = detail.json<{
        id: string;
        status: string;
        participants: { user_id: string; display_name: string; status: string }[];
        status_changes: { action: string }[];
      }>();
      expect(body.id).toBe(game.id);
      expect(body.status).toBe("cancelled");
      const joinerRow = body.participants.find((p) => p.user_id === joiner.id);
      expect(joinerRow).toBeDefined();
      expect(joinerRow!.display_name).toBe("JoinerOne");
      expect(body.status_changes.some((s) => s.action === "admin.games.cancel")).toBe(true);
    });

    it("PATCH updates capacity and writes admin.games.update audit row", async () => {
      const admin = await makeAdmin();
      const host = await createTestUser(app);
      const game = await createGame(host, { capacity: 4 });

      const patch = await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/games/${game.id}`,
        headers: { authorization: `Bearer ${admin.access_token}` },
        payload: { capacity: 6, notes: "Bumped by mod" },
      });
      expect(patch.statusCode).toBe(200);
      const body = patch.json<{ capacity: number; notes: string | null }>();
      expect(body.capacity).toBe(6);
      expect(body.notes).toBe("Bumped by mod");

      const audit = await sql<{ action: string }>`
        SELECT action FROM audit_log
         WHERE entity = 'game' AND entity_id = ${game.id}
           AND action = 'admin.games.update'
      `.execute(db.db);
      expect(audit.rows.length).toBe(1);
    });

    it("DELETE soft-deletes only when game is cancelled or completed", async () => {
      const admin = await makeAdmin();
      const host = await createTestUser(app);
      const open = await createGame(host);

      // Open game cannot be soft-deleted yet.
      const refused = await app.inject({
        method: "DELETE",
        url: `/api/v1/admin/games/${open.id}`,
        headers: { authorization: `Bearer ${admin.access_token}` },
      });
      expect(refused.statusCode).toBe(409);

      // Cancel then delete.
      const cancelRes = await app.inject({
        method: "POST",
        url: `/api/v1/admin/games/${open.id}/cancel`,
        headers: { authorization: `Bearer ${admin.access_token}` },
        payload: {},
      });
      expect(cancelRes.statusCode).toBe(204);

      const del = await app.inject({
        method: "DELETE",
        url: `/api/v1/admin/games/${open.id}`,
        headers: { authorization: `Bearer ${admin.access_token}` },
      });
      expect(del.statusCode).toBe(204);

      // The row must still be in the DB but with deleted_at set.
      const row = await sql<{ deleted_at: Date | null }>`
        SELECT deleted_at FROM games WHERE id = ${open.id}
      `.execute(db.db);
      expect(row.rows[0]!.deleted_at).not.toBeNull();

      // Default list should hide it (deleted_at IS NULL is the default).
      const list = await app.inject({
        method: "GET",
        url: "/api/v1/admin/games",
        headers: { authorization: `Bearer ${admin.access_token}` },
      });
      expect(list.statusCode).toBe(200);
      const body = list.json<{ items: { id: string }[] }>();
      expect(body.items.some((g) => g.id === open.id)).toBe(false);
    });

    it("admin and moderator can both access the games surface", async () => {
      // Both roles get through `buildAdminGuard`, but the explicit assertion
      // here is the regression: if a future refactor narrows access to admin
      // only, the moderator request must start failing.
      const mod = await createTestUser(app, { display_name: "Mod" });
      await promoteToAdmin(db, mod.id, "moderator");
      const adm = await createTestUser(app, { display_name: "Admin2" });
      await promoteToAdmin(db, adm.id, "admin");

      const modRes = await app.inject({
        method: "GET",
        url: "/api/v1/admin/games",
        headers: { authorization: `Bearer ${mod.access_token}` },
      });
      const admRes = await app.inject({
        method: "GET",
        url: "/api/v1/admin/games",
        headers: { authorization: `Bearer ${adm.access_token}` },
      });
      expect(modRes.statusCode).toBe(200);
      expect(admRes.statusCode).toBe(200);
    });

    it("rejects games list for an authenticated non-staff user with 403", async () => {
      const plebe = await createTestUser(app);
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/admin/games?status=open",
        headers: { authorization: `Bearer ${plebe.access_token}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });
});
