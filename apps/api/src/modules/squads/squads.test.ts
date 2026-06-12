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

const ONE_HOUR_MS = 60 * 60 * 1000;

interface SquadMemberBody {
  user_id: string;
  display_name: string;
  role: "owner" | "member";
  status: "pending" | "active";
}

interface SquadDetailBody {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  photo_url: string | null;
  max_size: number;
  member_count: number;
  members: SquadMemberBody[];
}

interface SquadGameItemBody {
  id: string;
  sport_slug: string;
  starts_at: string;
  squad_members_attending: number;
}

async function getPadelSportId(db: DbHandle): Promise<string> {
  const row = await db.db
    .selectFrom("sports")
    .select("id")
    .where("slug", "=", "padel")
    .executeTakeFirstOrThrow();
  return row.id;
}

describe("squads routes", () => {
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

  async function createSquad(
    owner: TestUser,
    overrides: Record<string, unknown> = {},
  ): Promise<SquadDetailBody> {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/squads",
      headers: { authorization: `Bearer ${owner.access_token}` },
      payload: {
        name: "The Padel Padawans",
        max_size: 8,
        ...overrides,
      },
    });
    if (res.statusCode !== 201) {
      throw new Error(`createSquad failed: ${String(res.statusCode)} ${res.body}`);
    }
    return res.json<SquadDetailBody>();
  }

  // ─────────────────────── POST /squads ───────────────────────

  describe("POST /api/v1/squads", () => {
    it("creates a squad with the creator as owner+active", async () => {
      const owner = await createTestUser(app);
      const squad = await createSquad(owner);
      expect(squad.owner_id).toBe(owner.id);
      expect(squad.member_count).toBe(1);
      expect(squad.members).toHaveLength(1);
      expect(squad.members[0]!.user_id).toBe(owner.id);
      expect(squad.members[0]!.role).toBe("owner");
      expect(squad.members[0]!.status).toBe("active");
      expect(squad.name).toBe("The Padel Padawans");
      expect(squad.max_size).toBe(8);
    });

    it("rejects names shorter than 2 chars", async () => {
      const owner = await createTestUser(app);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/squads",
        headers: { authorization: `Bearer ${owner.access_token}` },
        payload: { name: "A", max_size: 4 },
      });
      expect(res.statusCode).toBe(400);
    });

    it("rejects max_size out of bounds", async () => {
      const owner = await createTestUser(app);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/squads",
        headers: { authorization: `Bearer ${owner.access_token}` },
        payload: { name: "Too big", max_size: 99 },
      });
      expect(res.statusCode).toBe(400);
    });

    it("requires authentication", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/squads",
        payload: { name: "Anon", max_size: 4 },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // ─────────────────────── invite / accept ───────────────────────

  describe("invite + accept flow", () => {
    it("invites a member (pending), accepts (active)", async () => {
      const owner = await createTestUser(app);
      const invitee = await createTestUser(app);
      const squad = await createSquad(owner);

      const invite = await app.inject({
        method: "POST",
        url: `/api/v1/squads/${squad.id}/invite`,
        headers: { authorization: `Bearer ${owner.access_token}` },
        payload: { user_id: invitee.id },
      });
      expect(invite.statusCode).toBe(204);

      // Detail should now show invitee as pending.
      const afterInvite = await app.inject({
        method: "GET",
        url: `/api/v1/squads/${squad.id}`,
        headers: { authorization: `Bearer ${owner.access_token}` },
      });
      const detail = afterInvite.json<SquadDetailBody>();
      const inviteeRow = detail.members.find((m) => m.user_id === invitee.id);
      expect(inviteeRow).toBeDefined();
      expect(inviteeRow!.status).toBe("pending");
      // member_count counts active members only.
      expect(detail.member_count).toBe(1);

      const accept = await app.inject({
        method: "POST",
        url: `/api/v1/squads/${squad.id}/accept`,
        headers: { authorization: `Bearer ${invitee.access_token}` },
      });
      expect(accept.statusCode).toBe(204);

      const afterAccept = await app.inject({
        method: "GET",
        url: `/api/v1/squads/${squad.id}`,
        headers: { authorization: `Bearer ${invitee.access_token}` },
      });
      const detailAfter = afterAccept.json<SquadDetailBody>();
      const inviteeAfter = detailAfter.members.find((m) => m.user_id === invitee.id);
      expect(inviteeAfter!.status).toBe("active");
      expect(detailAfter.member_count).toBe(2);
    });

    it("only active members can invite", async () => {
      const owner = await createTestUser(app);
      const stranger = await createTestUser(app);
      const target = await createTestUser(app);
      const squad = await createSquad(owner);
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/squads/${squad.id}/invite`,
        headers: { authorization: `Bearer ${stranger.access_token}` },
        payload: { user_id: target.id },
      });
      expect(res.statusCode).toBe(403);
    });

    it("rejects inviting yourself", async () => {
      const owner = await createTestUser(app);
      const squad = await createSquad(owner);
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/squads/${squad.id}/invite`,
        headers: { authorization: `Bearer ${owner.access_token}` },
        payload: { user_id: owner.id },
      });
      expect(res.statusCode).toBe(400);
    });

    it("rejects double-invite of the same user (409)", async () => {
      const owner = await createTestUser(app);
      const invitee = await createTestUser(app);
      const squad = await createSquad(owner);
      const first = await app.inject({
        method: "POST",
        url: `/api/v1/squads/${squad.id}/invite`,
        headers: { authorization: `Bearer ${owner.access_token}` },
        payload: { user_id: invitee.id },
      });
      expect(first.statusCode).toBe(204);
      const second = await app.inject({
        method: "POST",
        url: `/api/v1/squads/${squad.id}/invite`,
        headers: { authorization: `Bearer ${owner.access_token}` },
        payload: { user_id: invitee.id },
      });
      expect(second.statusCode).toBe(409);
    });

    it("blocks an invite when there's a mutual block (404)", async () => {
      const owner = await createTestUser(app);
      const blocked = await createTestUser(app);
      const squad = await createSquad(owner);

      // Owner blocks the prospective invitee.
      await sql`
        INSERT INTO user_blocks (blocker_user_id, blocked_user_id)
        VALUES (${owner.id}, ${blocked.id})
      `.execute(db.db);

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/squads/${squad.id}/invite`,
        headers: { authorization: `Bearer ${owner.access_token}` },
        payload: { user_id: blocked.id },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ─────────────────────── GET /squads/me ───────────────────────

  describe("GET /api/v1/squads/me", () => {
    it("lists squads where the caller is active, excludes pending invites", async () => {
      const owner = await createTestUser(app);
      const invitee = await createTestUser(app);
      const squadA = await createSquad(owner, { name: "Active Squad" });
      const squadB = await createSquad(owner, { name: "Pending Squad" });

      // Invite invitee to both; accept only the first.
      for (const sq of [squadA, squadB]) {
        await app.inject({
          method: "POST",
          url: `/api/v1/squads/${sq.id}/invite`,
          headers: { authorization: `Bearer ${owner.access_token}` },
          payload: { user_id: invitee.id },
        });
      }
      await app.inject({
        method: "POST",
        url: `/api/v1/squads/${squadA.id}/accept`,
        headers: { authorization: `Bearer ${invitee.access_token}` },
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/squads/me",
        headers: { authorization: `Bearer ${invitee.access_token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ squads: { id: string; name: string }[] }>();
      // Only the accepted squad shows up — the pending one is hidden until accept.
      expect(body.squads.map((s) => s.name)).toEqual(["Active Squad"]);
    });
  });

  // ─────────────────────── leave / delete ───────────────────────

  describe("POST /squads/:id/leave", () => {
    it("transfers ownership to the oldest active member when owner leaves", async () => {
      const owner = await createTestUser(app);
      const earlyJoiner = await createTestUser(app);
      const lateJoiner = await createTestUser(app);
      const squad = await createSquad(owner);

      // Invite + accept earlyJoiner first.
      await app.inject({
        method: "POST",
        url: `/api/v1/squads/${squad.id}/invite`,
        headers: { authorization: `Bearer ${owner.access_token}` },
        payload: { user_id: earlyJoiner.id },
      });
      await app.inject({
        method: "POST",
        url: `/api/v1/squads/${squad.id}/accept`,
        headers: { authorization: `Bearer ${earlyJoiner.access_token}` },
      });

      // Then lateJoiner — must have a strictly later joined_at than earlyJoiner.
      // We force a small gap by sleeping a few ms; if the test is flaky we
      // can backfill joined_at via SQL instead.
      await new Promise((r) => setTimeout(r, 10));
      await app.inject({
        method: "POST",
        url: `/api/v1/squads/${squad.id}/invite`,
        headers: { authorization: `Bearer ${owner.access_token}` },
        payload: { user_id: lateJoiner.id },
      });
      await app.inject({
        method: "POST",
        url: `/api/v1/squads/${squad.id}/accept`,
        headers: { authorization: `Bearer ${lateJoiner.access_token}` },
      });

      // Owner leaves — ownership should go to earlyJoiner.
      const leave = await app.inject({
        method: "POST",
        url: `/api/v1/squads/${squad.id}/leave`,
        headers: { authorization: `Bearer ${owner.access_token}` },
      });
      expect(leave.statusCode).toBe(204);

      const detail = await app.inject({
        method: "GET",
        url: `/api/v1/squads/${squad.id}`,
        headers: { authorization: `Bearer ${earlyJoiner.access_token}` },
      });
      const body = detail.json<SquadDetailBody>();
      expect(body.owner_id).toBe(earlyJoiner.id);
      // Original owner is gone.
      expect(body.members.find((m) => m.user_id === owner.id)).toBeUndefined();
    });

    it("rejects owner-leave when no other active members exist (422)", async () => {
      const owner = await createTestUser(app);
      const squad = await createSquad(owner);
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/squads/${squad.id}/leave`,
        headers: { authorization: `Bearer ${owner.access_token}` },
      });
      expect(res.statusCode).toBe(422);
    });
  });

  describe("DELETE /squads/:id", () => {
    it("owner can delete; non-owner cannot", async () => {
      const owner = await createTestUser(app);
      const stranger = await createTestUser(app);
      const squad = await createSquad(owner);

      const strangerDel = await app.inject({
        method: "DELETE",
        url: `/api/v1/squads/${squad.id}`,
        headers: { authorization: `Bearer ${stranger.access_token}` },
      });
      expect(strangerDel.statusCode).toBe(403);

      const ownerDel = await app.inject({
        method: "DELETE",
        url: `/api/v1/squads/${squad.id}`,
        headers: { authorization: `Bearer ${owner.access_token}` },
      });
      expect(ownerDel.statusCode).toBe(204);

      const after = await app.inject({
        method: "GET",
        url: `/api/v1/squads/${squad.id}`,
        headers: { authorization: `Bearer ${owner.access_token}` },
      });
      expect(after.statusCode).toBe(404);
    });
  });

  // ─────────────────────── /squads/:id/games ───────────────────────

  describe("GET /squads/:id/games", () => {
    /**
     * Helper: create a future game hosted by the given user. We bypass the
     * /games route here so the test stays focused on the squads-side
     * aggregation. The host is auto-added as a confirmed participant by
     * the games service when going through the API, but for these tests
     * we'll insert game_participants directly for full control.
     */
    async function makeGame(
      hostUserId: string,
      startsInMinutes: number,
    ): Promise<string> {
      const startsAt = new Date(Date.now() + startsInMinutes * 60_000);
      const row = await sql<{ id: string }>`
        INSERT INTO games (sport_id, host_user_id, lat, lng, starts_at, duration_minutes, capacity)
        VALUES (${padelId}, ${hostUserId}, 40.4093, 49.8671, ${startsAt}, 90, 4)
        RETURNING id
      `.execute(db.db);
      return row.rows[0]!.id;
    }

    async function joinGame(gameId: string, userId: string): Promise<void> {
      await sql`
        INSERT INTO game_participants (game_id, user_id, status)
        VALUES (${gameId}, ${userId}, 'confirmed')
        ON CONFLICT (game_id, user_id) DO NOTHING
      `.execute(db.db);
    }

    it("returns upcoming games where 2+ squad members are confirmed", async () => {
      // Set up a squad of three actives + one pending.
      const owner = await createTestUser(app);
      const m1 = await createTestUser(app);
      const m2 = await createTestUser(app);
      const pending = await createTestUser(app);
      const outsider = await createTestUser(app);
      const squad = await createSquad(owner);

      for (const u of [m1, m2]) {
        await app.inject({
          method: "POST",
          url: `/api/v1/squads/${squad.id}/invite`,
          headers: { authorization: `Bearer ${owner.access_token}` },
          payload: { user_id: u.id },
        });
        await app.inject({
          method: "POST",
          url: `/api/v1/squads/${squad.id}/accept`,
          headers: { authorization: `Bearer ${u.access_token}` },
        });
      }
      // Invite-only, never accept — should not count.
      await app.inject({
        method: "POST",
        url: `/api/v1/squads/${squad.id}/invite`,
        headers: { authorization: `Bearer ${owner.access_token}` },
        payload: { user_id: pending.id },
      });

      // Game A: owner + m1 → 2 squad members → SHOULD appear.
      const gameA = await makeGame(owner.id, 60);
      await joinGame(gameA, owner.id);
      await joinGame(gameA, m1.id);
      await joinGame(gameA, outsider.id);

      // Game B: only owner from the squad → 1 squad member → should NOT appear.
      const gameB = await makeGame(owner.id, 120);
      await joinGame(gameB, owner.id);
      await joinGame(gameB, outsider.id);

      // Game C: owner + m1 + m2 → 3 squad members → SHOULD appear.
      const gameC = await makeGame(m1.id, 180);
      await joinGame(gameC, owner.id);
      await joinGame(gameC, m1.id);
      await joinGame(gameC, m2.id);

      // Game D: pending member (not active) + m1 → 1 active member only.
      const gameD = await makeGame(m1.id, 240);
      await joinGame(gameD, pending.id);
      await joinGame(gameD, m1.id);
      // Wait, m1 is active so this has 1 active squad member (m1). pending
      // doesn't count. Should NOT appear.

      const res = await app.inject({
        method: "GET",
        url: `/api/v1/squads/${squad.id}/games`,
        headers: { authorization: `Bearer ${owner.access_token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ games: SquadGameItemBody[] }>();
      const ids = body.games.map((g) => g.id).sort();
      expect(ids).toEqual([gameA, gameC].sort());

      // The COUNT is over squad members, not all participants.
      const a = body.games.find((g) => g.id === gameA)!;
      expect(a.squad_members_attending).toBe(2);
      const c = body.games.find((g) => g.id === gameC)!;
      expect(c.squad_members_attending).toBe(3);
    });

    it("rejects non-members (403)", async () => {
      const owner = await createTestUser(app);
      const stranger = await createTestUser(app);
      const squad = await createSquad(owner);
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/squads/${squad.id}/games`,
        headers: { authorization: `Bearer ${stranger.access_token}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it("`since` filter hides games before the cutoff", async () => {
      const owner = await createTestUser(app);
      const m1 = await createTestUser(app);
      const squad = await createSquad(owner);
      await app.inject({
        method: "POST",
        url: `/api/v1/squads/${squad.id}/invite`,
        headers: { authorization: `Bearer ${owner.access_token}` },
        payload: { user_id: m1.id },
      });
      await app.inject({
        method: "POST",
        url: `/api/v1/squads/${squad.id}/accept`,
        headers: { authorization: `Bearer ${m1.access_token}` },
      });

      const soon = await makeGame(owner.id, 30); // +30 min
      await joinGame(soon, owner.id);
      await joinGame(soon, m1.id);
      const later = await makeGame(owner.id, 240); // +4 hr
      await joinGame(later, owner.id);
      await joinGame(later, m1.id);

      // Slide the cutoff forward to +1h — only `later` should remain.
      const cutoff = new Date(Date.now() + 60 * ONE_HOUR_MS / 60).toISOString();
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/squads/${squad.id}/games?since=${cutoff}`,
        headers: { authorization: `Bearer ${owner.access_token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ games: SquadGameItemBody[] }>();
      expect(body.games.map((g) => g.id)).toEqual([later]);
    });
  });

  // ─────────────────────── PATCH ───────────────────────

  describe("PATCH /squads/:id", () => {
    it("owner can update name+description; non-owner cannot", async () => {
      const owner = await createTestUser(app);
      const stranger = await createTestUser(app);
      const squad = await createSquad(owner);

      const strangerPatch = await app.inject({
        method: "PATCH",
        url: `/api/v1/squads/${squad.id}`,
        headers: { authorization: `Bearer ${stranger.access_token}` },
        payload: { name: "Hacked" },
      });
      expect(strangerPatch.statusCode).toBe(403);

      const ownerPatch = await app.inject({
        method: "PATCH",
        url: `/api/v1/squads/${squad.id}`,
        headers: { authorization: `Bearer ${owner.access_token}` },
        payload: { name: "Renamed Squad", description: "Best in Baku" },
      });
      expect(ownerPatch.statusCode).toBe(200);
      const body = ownerPatch.json<SquadDetailBody>();
      expect(body.name).toBe("Renamed Squad");
      expect(body.description).toBe("Best in Baku");
    });
  });
});
