import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import { sql } from "kysely";
import { buildServer, type LinkfitServer } from "../../shared/http/server.js";
import { buildTestDb } from "../../../tests/helpers/db.js";
import { buildTestEnv } from "../../../tests/helpers/env.js";
import { createTestUser, truncateAll, type TestUser } from "../../../tests/helpers/fixtures.js";
import { type DbHandle } from "../../shared/db/pool.js";
import { TournamentsService } from "./tournaments.service.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

type Status =
  | "announced"
  | "registration_open"
  | "registration_closed"
  | "in_progress"
  | "completed"
  | "cancelled";

interface TournamentListBody {
  items: { id: string; name: string; status: Status; sport_slug: string; entries_count: number }[];
}

interface EntryBody {
  id: string;
  tournament_id: string;
  captain_user_id: string;
  captain_display_name: string;
  squad_name: string;
  player_ids: string[];
  player_names: string[];
  status: "pending" | "confirmed" | "withdrawn" | "disqualified";
}

type DetailBody = TournamentListBody["items"][number] & {
  entries: EntryBody[];
  my_entry: EntryBody | null;
  can_register: boolean;
  registration_blocked_reason: string | null;
  max_squads: number;
  squad_size: number;
};

async function getPadelSportId(db: DbHandle): Promise<string> {
  const row = await sql<{ id: string }>`SELECT id FROM sports WHERE slug = 'padel'`.execute(
    db.db,
  );
  return row.rows[0]!.id;
}

async function getFootballSportId(db: DbHandle): Promise<string | null> {
  const row = await sql<{ id: string }>`SELECT id FROM sports WHERE slug = 'football_5'`.execute(
    db.db,
  );
  return row.rows[0]?.id ?? null;
}

async function createTournament(
  db: DbHandle,
  overrides: Partial<{
    name: string;
    sport_id: string;
    status: Status;
    max_squads: number;
    squad_size: number;
    starts_at: Date;
    ends_at: Date;
    registration_deadline: Date | null;
    entry_fee_minor: number;
  }> = {},
): Promise<string> {
  const padelId = overrides.sport_id ?? (await getPadelSportId(db));
  const starts = overrides.starts_at ?? new Date(Date.now() + 7 * ONE_DAY_MS);
  const ends = overrides.ends_at ?? new Date(starts.getTime() + 6 * ONE_HOUR_MS);
  const row = await sql<{ id: string }>`
    INSERT INTO tournaments
      (name, sport_id, starts_at, ends_at, registration_deadline,
       max_squads, squad_size, entry_fee_minor, currency, status)
    VALUES
      (${overrides.name ?? "Baku Open"},
       ${padelId},
       ${starts.toISOString()},
       ${ends.toISOString()},
       ${overrides.registration_deadline === null
         ? null
         : (overrides.registration_deadline ?? new Date(starts.getTime() - ONE_HOUR_MS)).toISOString()},
       ${overrides.max_squads ?? 8},
       ${overrides.squad_size ?? 4},
       ${overrides.entry_fee_minor ?? 0},
       'AZN',
       ${overrides.status ?? "registration_open"})
    RETURNING id
  `.execute(db.db);
  return row.rows[0]!.id;
}

describe("tournaments routes", () => {
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

  // ─── List ──────────────────────────────────────────────────────────

  describe("GET /api/v1/tournaments", () => {
    it("returns active tournaments and is filterable by status", async () => {
      const padelId = await getPadelSportId(db);

      const t1 = await createTournament(db, {
        name: "Open Cup",
        status: "registration_open",
        sport_id: padelId,
      });
      const t2 = await createTournament(db, {
        name: "Live Cup",
        status: "in_progress",
        sport_id: padelId,
      });
      await createTournament(db, {
        name: "Done Cup",
        status: "completed",
        sport_id: padelId,
      });

      // No filter — all six listed (default LIMIT 50).
      const all = await app.inject({ method: "GET", url: "/api/v1/tournaments" });
      expect(all.statusCode).toBe(200);
      const allBody = all.json<TournamentListBody>();
      expect(allBody.items.length).toBe(3);

      // Filter by status.
      const live = await app.inject({
        method: "GET",
        url: "/api/v1/tournaments?status=in_progress",
      });
      expect(live.statusCode).toBe(200);
      const liveBody = live.json<TournamentListBody>();
      expect(liveBody.items.map((i) => i.id)).toEqual([t2]);

      // Bucket filter.
      const upcoming = await app.inject({
        method: "GET",
        url: "/api/v1/tournaments?bucket=upcoming",
      });
      const upcomingBody = upcoming.json<TournamentListBody>();
      expect(upcomingBody.items.map((i) => i.id)).toEqual([t1]);

      const past = await app.inject({
        method: "GET",
        url: "/api/v1/tournaments?bucket=past",
      });
      const pastBody = past.json<TournamentListBody>();
      expect(pastBody.items.map((i) => i.name)).toContain("Done Cup");
    });

    it("filters by sport slug", async () => {
      const padelId = await getPadelSportId(db);
      const footballId = await getFootballSportId(db);
      const padelT = await createTournament(db, { name: "Padel A", sport_id: padelId });
      if (footballId) {
        await createTournament(db, { name: "Football A", sport_id: footballId });
      }

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/tournaments?sport=padel",
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<TournamentListBody>();
      // All returned items are padel; padelT is among them.
      expect(body.items.every((i) => i.sport_slug === "padel")).toBe(true);
      expect(body.items.map((i) => i.id)).toContain(padelT);
    });
  });

  // ─── Detail ───────────────────────────────────────────────────────

  describe("GET /api/v1/tournaments/:id", () => {
    it("returns 404 for unknown id", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/tournaments/00000000-0000-0000-0000-000000000000",
      });
      expect(res.statusCode).toBe(404);
    });

    it("reports can_register=true for open tournaments and surfaces my_entry once registered", async () => {
      const captain = await createTestUser(app, { display_name: "Cap" });
      const tid = await createTournament(db, { status: "registration_open", max_squads: 4 });

      const beforeRes = await app.inject({
        method: "GET",
        url: `/api/v1/tournaments/${tid}`,
        headers: { authorization: `Bearer ${captain.access_token}` },
      });
      const before = beforeRes.json<DetailBody>();
      expect(before.can_register).toBe(true);
      expect(before.my_entry).toBe(null);
      expect(before.entries).toHaveLength(0);

      const reg = await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${tid}/entries`,
        headers: { authorization: `Bearer ${captain.access_token}` },
        payload: { squad_name: "Lima Tigers", player_ids: [] },
      });
      expect(reg.statusCode).toBe(201);

      const afterRes = await app.inject({
        method: "GET",
        url: `/api/v1/tournaments/${tid}`,
        headers: { authorization: `Bearer ${captain.access_token}` },
      });
      const after = afterRes.json<DetailBody>();
      expect(after.can_register).toBe(false);
      expect(after.registration_blocked_reason).toBe("already_registered");
      expect(after.my_entry).not.toBeNull();
      expect(after.my_entry?.captain_user_id).toBe(captain.id);
      expect(after.entries).toHaveLength(1);
    });
  });

  // ─── Register ─────────────────────────────────────────────────────

  describe("POST /api/v1/tournaments/:id/entries", () => {
    it("rejects unauthenticated registration with 401", async () => {
      const tid = await createTournament(db);
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${tid}/entries`,
        payload: { squad_name: "Anon Squad", player_ids: [] },
      });
      expect(res.statusCode).toBe(401);
    });

    it("registers a squad including invited players", async () => {
      const captain = await createTestUser(app, { display_name: "Captain" });
      const p1 = await createTestUser(app, { display_name: "Player One" });
      const p2 = await createTestUser(app, { display_name: "Player Two" });
      const tid = await createTournament(db, { squad_size: 4 });

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${tid}/entries`,
        headers: { authorization: `Bearer ${captain.access_token}` },
        payload: { squad_name: "Aces", player_ids: [p1.id, p2.id] },
      });
      expect(res.statusCode).toBe(201);
      const entry = res.json<EntryBody>();
      expect(entry.captain_user_id).toBe(captain.id);
      expect(entry.player_ids).toEqual(expect.arrayContaining([p1.id, p2.id]));
      expect(entry.player_names).toEqual(expect.arrayContaining(["Player One", "Player Two"]));
      expect(entry.squad_name).toBe("Aces");
    });

    it("rejects oversized squads", async () => {
      const captain = await createTestUser(app);
      const p1 = await createTestUser(app);
      const p2 = await createTestUser(app);
      const p3 = await createTestUser(app);
      const p4 = await createTestUser(app);
      const tid = await createTournament(db, { squad_size: 3 });

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${tid}/entries`,
        headers: { authorization: `Bearer ${captain.access_token}` },
        payload: { squad_name: "Big squad", player_ids: [p1.id, p2.id, p3.id, p4.id] },
      });
      expect(res.statusCode).toBe(400);
    });

    it("enforces capacity — rejects registration when the tournament is full", async () => {
      const tid = await createTournament(db, { max_squads: 2 });
      const c1 = await createTestUser(app);
      const c2 = await createTestUser(app);
      const c3 = await createTestUser(app);

      const r1 = await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${tid}/entries`,
        headers: { authorization: `Bearer ${c1.access_token}` },
        payload: { squad_name: "Alpha", player_ids: [] },
      });
      expect(r1.statusCode).toBe(201);

      const r2 = await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${tid}/entries`,
        headers: { authorization: `Bearer ${c2.access_token}` },
        payload: { squad_name: "Bravo", player_ids: [] },
      });
      expect(r2.statusCode).toBe(201);

      const r3 = await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${tid}/entries`,
        headers: { authorization: `Bearer ${c3.access_token}` },
        payload: { squad_name: "Charlie", player_ids: [] },
      });
      expect(r3.statusCode).toBe(409);

      // Detail should now say the tournament is full.
      const detail = await app.inject({
        method: "GET",
        url: `/api/v1/tournaments/${tid}`,
        headers: { authorization: `Bearer ${c3.access_token}` },
      });
      const body = detail.json<DetailBody>();
      expect(body.can_register).toBe(false);
      expect(body.registration_blocked_reason).toBe("full");
    });

    it("rejects double-registration by the same captain (409)", async () => {
      const captain = await createTestUser(app);
      const tid = await createTournament(db);

      const r1 = await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${tid}/entries`,
        headers: { authorization: `Bearer ${captain.access_token}` },
        payload: { squad_name: "First", player_ids: [] },
      });
      expect(r1.statusCode).toBe(201);

      const r2 = await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${tid}/entries`,
        headers: { authorization: `Bearer ${captain.access_token}` },
        payload: { squad_name: "Second", player_ids: [] },
      });
      expect(r2.statusCode).toBe(409);
    });

    it("rejects registration once status is registration_closed", async () => {
      const captain = await createTestUser(app);
      const tid = await createTournament(db, { status: "registration_closed" });

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${tid}/entries`,
        headers: { authorization: `Bearer ${captain.access_token}` },
        payload: { squad_name: "Late", player_ids: [] },
      });
      expect(res.statusCode).toBe(409);
    });

    it("rejects registration once status is completed/cancelled", async () => {
      const captain = await createTestUser(app);
      const tidCompleted = await createTournament(db, { status: "completed" });
      const tidCancelled = await createTournament(db, { status: "cancelled" });

      const r1 = await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${tidCompleted}/entries`,
        headers: { authorization: `Bearer ${captain.access_token}` },
        payload: { squad_name: "Squad Done", player_ids: [] },
      });
      expect(r1.statusCode).toBe(409);

      const r2 = await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${tidCancelled}/entries`,
        headers: { authorization: `Bearer ${captain.access_token}` },
        payload: { squad_name: "Squad Done", player_ids: [] },
      });
      expect(r2.statusCode).toBe(409);
    });
  });

  // ─── Withdraw ────────────────────────────────────────────────────

  describe("DELETE /api/v1/tournaments/:id/entries/:entryId", () => {
    async function registerSquad(
      tid: string,
      captain: TestUser,
      squadName: string,
    ): Promise<string> {
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/tournaments/${tid}/entries`,
        headers: { authorization: `Bearer ${captain.access_token}` },
        payload: { squad_name: squadName, player_ids: [] },
      });
      if (res.statusCode !== 201) {
        throw new Error(`register failed: ${String(res.statusCode)} ${res.body}`);
      }
      return res.json<EntryBody>().id;
    }

    it("captain can withdraw their own squad", async () => {
      const captain = await createTestUser(app);
      const tid = await createTournament(db);
      const entryId = await registerSquad(tid, captain, "ToGo");

      const res = await app.inject({
        method: "DELETE",
        url: `/api/v1/tournaments/${tid}/entries/${entryId}`,
        headers: { authorization: `Bearer ${captain.access_token}` },
      });
      expect(res.statusCode).toBe(204);

      // The entries list should no longer include this squad.
      const detail = await app.inject({
        method: "GET",
        url: `/api/v1/tournaments/${tid}`,
        headers: { authorization: `Bearer ${captain.access_token}` },
      });
      const body = detail.json<DetailBody>();
      expect(body.entries).toHaveLength(0);
      expect(body.my_entry).toBe(null);
      // After withdrawal the captain can re-register.
      expect(body.can_register).toBe(true);
    });

    it("non-captain gets 403", async () => {
      const captain = await createTestUser(app);
      const intruder = await createTestUser(app);
      const tid = await createTournament(db);
      const entryId = await registerSquad(tid, captain, "Mine");

      const res = await app.inject({
        method: "DELETE",
        url: `/api/v1/tournaments/${tid}/entries/${entryId}`,
        headers: { authorization: `Bearer ${intruder.access_token}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 404 for an entry that doesn't belong to the tournament", async () => {
      const captain = await createTestUser(app);
      const tid = await createTournament(db);
      const otherTid = await createTournament(db, { name: "Other" });
      const entryId = await registerSquad(tid, captain, "Bound");

      const res = await app.inject({
        method: "DELETE",
        url: `/api/v1/tournaments/${otherTid}/entries/${entryId}`,
        headers: { authorization: `Bearer ${captain.access_token}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it("rejects withdraw once the tournament is in_progress", async () => {
      const captain = await createTestUser(app);
      const tid = await createTournament(db, { status: "registration_open" });
      const entryId = await registerSquad(tid, captain, "Running");

      // Flip to in_progress directly.
      await sql`UPDATE tournaments SET status = 'in_progress' WHERE id = ${tid}`.execute(db.db);

      const res = await app.inject({
        method: "DELETE",
        url: `/api/v1/tournaments/${tid}/entries/${entryId}`,
        headers: { authorization: `Bearer ${captain.access_token}` },
      });
      expect(res.statusCode).toBe(409);
    });
  });

  // ─── Pure unit: status-from-time helper ───────────────────────────

  describe("TournamentsService.computeStatusForTime", () => {
    it("returns in_progress while now is between starts_at and ends_at", () => {
      const s = new Date("2026-01-01T10:00:00Z");
      const e = new Date("2026-01-01T18:00:00Z");
      const now = new Date("2026-01-01T12:00:00Z");
      expect(TournamentsService.computeStatusForTime(s, e, now, "registration_closed")).toBe(
        "in_progress",
      );
    });

    it("returns completed once now passes ends_at", () => {
      const s = new Date("2026-01-01T10:00:00Z");
      const e = new Date("2026-01-01T18:00:00Z");
      const now = new Date("2026-01-02T00:00:00Z");
      expect(TournamentsService.computeStatusForTime(s, e, now, "in_progress")).toBe("completed");
    });

    it("preserves cancelled regardless of time", () => {
      const s = new Date("2026-01-01T10:00:00Z");
      const e = new Date("2026-01-01T18:00:00Z");
      const now = new Date("2026-01-02T00:00:00Z");
      expect(TournamentsService.computeStatusForTime(s, e, now, "cancelled")).toBe("cancelled");
    });
  });
});
