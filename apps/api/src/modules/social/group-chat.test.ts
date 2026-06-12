import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import { sql } from "kysely";
import { buildServer, type LinkfitServer } from "../../shared/http/server.js";
import { buildTestDb } from "../../../tests/helpers/db.js";
import { buildTestEnv } from "../../../tests/helpers/env.js";
import { createTestUser, truncateAll, type TestUser } from "../../../tests/helpers/fixtures.js";
import { type DbHandle } from "../../shared/db/pool.js";

/**
 * Group chat route tests. Covers the headline contract:
 *  - idempotent group creation for games and tournaments
 *  - participant listing visible to members only
 *  - host-only (or captain-only) add/remove
 *  - end-to-end "user joins a >2-participant game → group conv exists" flow
 *
 * The 1:1 DM path is *intentionally* not touched here — see messages.upload.test.ts.
 */

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

interface CreateGroupResponse {
  conversation_id: string;
  kind: "group";
  title: string;
  game_id: string | null;
  tournament_id: string | null;
  participants_count: number;
  created: boolean;
}

interface ParticipantsResponse {
  conversation_id: string;
  kind: "group";
  title: string;
  owner_user_id: string | null;
  items: {
    user_id: string;
    display_name: string;
    photo_url: string | null;
    is_owner: boolean;
    joined_at: string | null;
  }[];
}

async function getPadelSportId(db: DbHandle): Promise<string> {
  const row = await sql<{ id: string }>`SELECT id FROM sports WHERE slug = 'padel'`.execute(db.db);
  return row.rows[0]!.id;
}

async function createGame(
  app: LinkfitServer,
  host: TestUser,
  sportId: string,
  capacity = 4,
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/games",
    headers: { authorization: `Bearer ${host.access_token}` },
    payload: {
      sport_id: sportId,
      lat: 40.4093,
      lng: 49.8671,
      starts_at: new Date(Date.now() + ONE_HOUR_MS).toISOString(),
      duration_minutes: 90,
      capacity,
    },
  });
  if (res.statusCode !== 201) {
    throw new Error(`createGame failed: ${String(res.statusCode)} ${res.body}`);
  }
  return res.json<{ id: string }>().id;
}

async function joinGame(app: LinkfitServer, user: TestUser, gameId: string): Promise<void> {
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/games/${gameId}/join`,
    headers: { authorization: `Bearer ${user.access_token}` },
  });
  if (res.statusCode !== 200) {
    throw new Error(`joinGame failed: ${String(res.statusCode)} ${res.body}`);
  }
}

async function createTournament(db: DbHandle, sportId: string): Promise<string> {
  const starts = new Date(Date.now() + 7 * ONE_DAY_MS);
  const ends = new Date(starts.getTime() + 6 * ONE_HOUR_MS);
  const row = await sql<{ id: string }>`
    INSERT INTO tournaments
      (name, sport_id, starts_at, ends_at, registration_deadline,
       max_squads, squad_size, entry_fee_minor, currency, status)
    VALUES
      ('Spring Open', ${sportId},
       ${starts.toISOString()}, ${ends.toISOString()},
       ${new Date(starts.getTime() - ONE_HOUR_MS).toISOString()},
       8, 4, 0, 'AZN', 'registration_open')
    RETURNING id
  `.execute(db.db);
  return row.rows[0]!.id;
}

async function registerSquad(
  db: DbHandle,
  tournamentId: string,
  captainId: string,
  squadName: string,
): Promise<void> {
  await sql`
    INSERT INTO tournament_entries
      (tournament_id, captain_user_id, squad_name, player_ids, status)
    VALUES
      (${tournamentId}, ${captainId}, ${squadName}, '{}', 'confirmed')
  `.execute(db.db);
}

describe("group chat routes", () => {
  const env = buildTestEnv();
  let app: LinkfitServer;
  let db: DbHandle;
  let padelId: string;

  beforeAll(async () => {
    db = buildTestDb();
    app = await buildServer({ env, logger: pino({ level: "silent" }), db });
    await app.ready();
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

  // ─── Creation ──────────────────────────────────────────────────────

  it("creates a group conversation for a game and is idempotent on the second call", async () => {
    const host = await createTestUser(app);
    const gameId = await createGame(app, host, padelId, 4);

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/conversations/group",
      headers: { authorization: `Bearer ${host.access_token}` },
      payload: { kind: "game", target_id: gameId },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json<CreateGroupResponse>();
    expect(firstBody.created).toBe(true);
    expect(firstBody.kind).toBe("group");
    expect(firstBody.game_id).toBe(gameId);
    expect(firstBody.participants_count).toBeGreaterThanOrEqual(1);

    // Second call returns the same id with `created=false`.
    const second = await app.inject({
      method: "POST",
      url: "/api/v1/conversations/group",
      headers: { authorization: `Bearer ${host.access_token}` },
      payload: { kind: "game", target_id: gameId },
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json<CreateGroupResponse>();
    expect(secondBody.created).toBe(false);
    expect(secondBody.conversation_id).toBe(firstBody.conversation_id);
  });

  it("forbids opening a game group chat from a non-participant", async () => {
    const host = await createTestUser(app);
    const stranger = await createTestUser(app);
    const gameId = await createGame(app, host, padelId, 4);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/conversations/group",
      headers: { authorization: `Bearer ${stranger.access_token}` },
      payload: { kind: "game", target_id: gameId },
    });
    expect(res.statusCode).toBe(403);
  });

  // ─── Participants list / auth ──────────────────────────────────────

  it("lets a joined player open the group and lists them as a participant", async () => {
    const host = await createTestUser(app, { display_name: "Hank" });
    const alice = await createTestUser(app, { display_name: "Alice" });
    const gameId = await createGame(app, host, padelId, 4);
    await joinGame(app, alice, gameId);

    const open = await app.inject({
      method: "POST",
      url: "/api/v1/conversations/group",
      headers: { authorization: `Bearer ${alice.access_token}` },
      payload: { kind: "game", target_id: gameId },
    });
    expect(open.statusCode).toBe(200);
    const conv = open.json<CreateGroupResponse>().conversation_id;

    const listing = await app.inject({
      method: "GET",
      url: `/api/v1/conversations/${conv}/participants`,
      headers: { authorization: `Bearer ${alice.access_token}` },
    });
    expect(listing.statusCode).toBe(200);
    const body = listing.json<ParticipantsResponse>();
    const ids = body.items.map((p) => p.user_id).sort();
    expect(ids).toContain(alice.id);
    expect(ids).toContain(host.id);
    expect(body.owner_user_id).toBe(host.id);
    const hostRow = body.items.find((p) => p.user_id === host.id);
    expect(hostRow?.is_owner).toBe(true);
  });

  it("returns 403 when a non-participant tries to list the roster", async () => {
    const host = await createTestUser(app);
    const stranger = await createTestUser(app);
    const gameId = await createGame(app, host, padelId, 4);

    const open = await app.inject({
      method: "POST",
      url: "/api/v1/conversations/group",
      headers: { authorization: `Bearer ${host.access_token}` },
      payload: { kind: "game", target_id: gameId },
    });
    const conv = open.json<CreateGroupResponse>().conversation_id;

    const listing = await app.inject({
      method: "GET",
      url: `/api/v1/conversations/${conv}/participants`,
      headers: { authorization: `Bearer ${stranger.access_token}` },
    });
    expect(listing.statusCode).toBe(403);
  });

  // ─── Host adds + removes ───────────────────────────────────────────

  it("lets the host add a participant and rejects non-host attempts", async () => {
    const host = await createTestUser(app);
    const alice = await createTestUser(app);
    const bob = await createTestUser(app);
    const gameId = await createGame(app, host, padelId, 4);

    const open = await app.inject({
      method: "POST",
      url: "/api/v1/conversations/group",
      headers: { authorization: `Bearer ${host.access_token}` },
      payload: { kind: "game", target_id: gameId },
    });
    const conv = open.json<CreateGroupResponse>().conversation_id;

    // Non-host (Alice) cannot add.
    const forbidden = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conv}/participants`,
      headers: { authorization: `Bearer ${alice.access_token}` },
      payload: { user_id: bob.id },
    });
    expect(forbidden.statusCode).toBe(403);

    // Host can.
    const ok = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conv}/participants`,
      headers: { authorization: `Bearer ${host.access_token}` },
      payload: { user_id: bob.id },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ added: boolean }>().added).toBe(true);

    // Idempotent re-add — `added=false`.
    const again = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conv}/participants`,
      headers: { authorization: `Bearer ${host.access_token}` },
      payload: { user_id: bob.id },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json<{ added: boolean }>().added).toBe(false);
  });

  it("lets the host kick a participant via DELETE", async () => {
    const host = await createTestUser(app);
    const alice = await createTestUser(app);
    const gameId = await createGame(app, host, padelId, 4);
    await joinGame(app, alice, gameId);

    const open = await app.inject({
      method: "POST",
      url: "/api/v1/conversations/group",
      headers: { authorization: `Bearer ${alice.access_token}` },
      payload: { kind: "game", target_id: gameId },
    });
    const conv = open.json<CreateGroupResponse>().conversation_id;

    const kicked = await app.inject({
      method: "DELETE",
      url: `/api/v1/conversations/${conv}/participants/${alice.id}`,
      headers: { authorization: `Bearer ${host.access_token}` },
    });
    expect(kicked.statusCode).toBe(204);

    // Alice should no longer be a participant.
    const rows = await sql<{ c: string }>`
      SELECT count(*)::text AS c FROM conversation_participants
       WHERE conversation_id = ${conv} AND user_id = ${alice.id}
    `.execute(db.db);
    expect(Number(rows.rows[0]!.c)).toBe(0);

    // And cannot remove the owner.
    const noKickOwner = await app.inject({
      method: "DELETE",
      url: `/api/v1/conversations/${conv}/participants/${host.id}`,
      headers: { authorization: `Bearer ${host.access_token}` },
    });
    expect(noKickOwner.statusCode).toBe(400);
  });

  // ─── Tournament path ───────────────────────────────────────────────

  it("creates a tournament group chat for the captain and forbids non-captains", async () => {
    const captain = await createTestUser(app);
    const stranger = await createTestUser(app);
    const tournamentId = await createTournament(db, padelId);
    await registerSquad(db, tournamentId, captain.id, "Lions");

    const captainOpen = await app.inject({
      method: "POST",
      url: "/api/v1/conversations/group",
      headers: { authorization: `Bearer ${captain.access_token}` },
      payload: { kind: "tournament", target_id: tournamentId },
    });
    expect(captainOpen.statusCode).toBe(200);
    expect(captainOpen.json<CreateGroupResponse>().tournament_id).toBe(tournamentId);

    const forbidden = await app.inject({
      method: "POST",
      url: "/api/v1/conversations/group",
      headers: { authorization: `Bearer ${stranger.access_token}` },
      payload: { kind: "tournament", target_id: tournamentId },
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it("supports a 3-player game flow with a shared conversation row", async () => {
    // Hosts a 4-cap game, two players join → all three see the same group conv.
    const host = await createTestUser(app);
    const a = await createTestUser(app);
    const b = await createTestUser(app);
    const gameId = await createGame(app, host, padelId, 4);
    await joinGame(app, a, gameId);
    await joinGame(app, b, gameId);

    const openHost = await app.inject({
      method: "POST",
      url: "/api/v1/conversations/group",
      headers: { authorization: `Bearer ${host.access_token}` },
      payload: { kind: "game", target_id: gameId },
    });
    const conv = openHost.json<CreateGroupResponse>().conversation_id;

    for (const u of [a, b]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/conversations/group",
        headers: { authorization: `Bearer ${u.access_token}` },
        payload: { kind: "game", target_id: gameId },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<CreateGroupResponse>().conversation_id).toBe(conv);
    }

    const listing = await app.inject({
      method: "GET",
      url: `/api/v1/conversations/${conv}/participants`,
      headers: { authorization: `Bearer ${host.access_token}` },
    });
    expect(listing.statusCode).toBe(200);
    const ids = listing.json<ParticipantsResponse>().items.map((p) => p.user_id);
    expect(ids).toContain(host.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
    expect(ids).toHaveLength(3);
  });

  it("404s when the target game does not exist", async () => {
    const host = await createTestUser(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/conversations/group",
      headers: { authorization: `Bearer ${host.access_token}` },
      payload: { kind: "game", target_id: "00000000-0000-0000-0000-000000000000" },
    });
    expect(res.statusCode).toBe(404);
  });
});
