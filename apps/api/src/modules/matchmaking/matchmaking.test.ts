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
import {
  type RecommendedGamesResponse,
  type RecommendedPlayersResponse,
} from "./matchmaking.schema.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Helpers — keep tests terse + readable. Each helper is a single
 * deterministic operation (create game, set ELO, follow user). Tests
 * compose them into scenarios then assert exact ordering / scores.
 */

async function getPadelSportId(db: DbHandle): Promise<string> {
  const r = await sql<{ id: string }>`SELECT id FROM sports WHERE slug='padel'`.execute(
    db.db,
  );
  return r.rows[0]!.id;
}

async function setUserHome(
  db: DbHandle,
  userId: string,
  lat: number,
  lng: number,
): Promise<void> {
  await db.db
    .updateTable("users")
    .set({ home_lat: lat.toString(), home_lng: lng.toString() })
    .where("id", "=", userId)
    .execute();
}

async function setUserElo(
  db: DbHandle,
  userId: string,
  sportId: string,
  elo: number,
  reliability = 100,
): Promise<void> {
  await sql`
    INSERT INTO player_sport_stats (user_id, sport_id, elo_rating, reliability_score)
    VALUES (${userId}, ${sportId}, ${elo}, ${reliability})
    ON CONFLICT (user_id, sport_id) DO UPDATE
       SET elo_rating = EXCLUDED.elo_rating,
           reliability_score = EXCLUDED.reliability_score
  `.execute(db.db);
}

async function createGameAs(
  app: LinkfitServer,
  host: TestUser,
  sportId: string,
  opts: {
    lat?: number;
    lng?: number;
    startsAt?: Date;
    skillMinElo?: number;
    skillMaxElo?: number;
    capacity?: number;
  } = {},
): Promise<string> {
  const payload: Record<string, unknown> = {
    sport_id: sportId,
    lat: opts.lat ?? 40.4093,
    lng: opts.lng ?? 49.8671,
    starts_at: (opts.startsAt ?? new Date(Date.now() + ONE_HOUR_MS)).toISOString(),
    duration_minutes: 90,
    capacity: opts.capacity ?? 4,
  };
  if (opts.skillMinElo !== undefined) payload.skill_min_elo = opts.skillMinElo;
  if (opts.skillMaxElo !== undefined) payload.skill_max_elo = opts.skillMaxElo;

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/games",
    headers: { authorization: `Bearer ${host.access_token}` },
    payload,
  });
  if (res.statusCode !== 201) {
    throw new Error(`createGame failed: ${String(res.statusCode)} ${res.body}`);
  }
  return res.json<{ id: string }>().id;
}

async function joinGame(
  app: LinkfitServer,
  user: TestUser,
  gameId: string,
): Promise<void> {
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/games/${gameId}/join`,
    headers: { authorization: `Bearer ${user.access_token}` },
  });
  if (res.statusCode !== 200) {
    throw new Error(`join failed: ${String(res.statusCode)} ${res.body}`);
  }
}

async function followUser(
  app: LinkfitServer,
  follower: TestUser,
  targetId: string,
): Promise<void> {
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/users/${targetId}/follow`,
    headers: { authorization: `Bearer ${follower.access_token}` },
  });
  if (res.statusCode !== 204 && res.statusCode !== 200) {
    throw new Error(`follow failed: ${String(res.statusCode)} ${res.body}`);
  }
}

async function fetchGames(
  app: LinkfitServer,
  user: TestUser,
  limit = 10,
): Promise<RecommendedGamesResponse> {
  const res = await app.inject({
    method: "GET",
    url: `/api/v1/me/matchmaking/games?limit=${String(limit)}`,
    headers: { authorization: `Bearer ${user.access_token}` },
  });
  if (res.statusCode !== 200) {
    throw new Error(`fetchGames failed: ${String(res.statusCode)} ${res.body}`);
  }
  return res.json<RecommendedGamesResponse>();
}

async function fetchPlayers(
  app: LinkfitServer,
  user: TestUser,
  limit = 10,
): Promise<RecommendedPlayersResponse> {
  const res = await app.inject({
    method: "GET",
    url: `/api/v1/me/matchmaking/players?limit=${String(limit)}`,
    headers: { authorization: `Bearer ${user.access_token}` },
  });
  if (res.statusCode !== 200) {
    throw new Error(`fetchPlayers failed: ${String(res.statusCode)} ${res.body}`);
  }
  return res.json<RecommendedPlayersResponse>();
}

describe("GET /api/v1/me/matchmaking/games", () => {
  const env = buildTestEnv();
  let app: LinkfitServer;
  let db: DbHandle;
  let padelId: string;

  beforeAll(async () => {
    db = buildTestDb();
    app = await buildServer({ env, logger: pino({ level: "silent" }), db });
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
    padelId = await getPadelSportId(db);
  });

  it("requires auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/me/matchmaking/games",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns an empty list when no open games exist", async () => {
    const me = await createTestUser(app);
    const body = await fetchGames(app, me);
    expect(body.items).toEqual([]);
  });

  it("excludes games the viewer hosts or already joined", async () => {
    const me = await createTestUser(app);
    const other = await createTestUser(app);
    const myGame = await createGameAs(app, me, padelId);
    const otherGame = await createGameAs(app, other, padelId);
    await joinGame(app, me, otherGame);

    const body = await fetchGames(app, me);
    const ids = body.items.map((g) => g.id);
    expect(ids).not.toContain(myGame);
    expect(ids).not.toContain(otherGame);
    expect(body.items.length).toBe(0);
  });

  it("hard-filters games whose skill window excludes the viewer's ELO", async () => {
    const me = await createTestUser(app);
    const host = await createTestUser(app);
    // Viewer ELO = 1500; game requires 1700..2000.
    await setUserElo(db, me.id, padelId, 1500);
    const tooHard = await createGameAs(app, host, padelId, {
      skillMinElo: 1700,
      skillMaxElo: 2000,
    });
    const inRange = await createGameAs(app, host, padelId, {
      skillMinElo: 1300,
      skillMaxElo: 1700,
    });

    const body = await fetchGames(app, me);
    const ids = body.items.map((g) => g.id);
    expect(ids).toContain(inRange);
    expect(ids).not.toContain(tooHard);
  });

  it("ranks closer-ELO games higher than wildly mismatched ones", async () => {
    const me = await createTestUser(app);
    await setUserElo(db, me.id, padelId, 1500);

    // Host A is ELO 1520 — close to viewer.
    const hostA = await createTestUser(app);
    await setUserElo(db, hostA.id, padelId, 1520);
    const gameA = await createGameAs(app, hostA, padelId);

    // Host B is ELO 2000 — 500 points off, hits ELO saturation.
    const hostB = await createTestUser(app);
    await setUserElo(db, hostB.id, padelId, 2000);
    const gameB = await createGameAs(app, hostB, padelId);

    const body = await fetchGames(app, me);
    expect(body.items.length).toBe(2);
    expect(body.items[0]!.id).toBe(gameA);
    expect(body.items[1]!.id).toBe(gameB);
    expect(body.items[0]!.score).toBeGreaterThan(body.items[1]!.score);
    expect(body.items[0]!.reasons).toContain("Similar ELO");
  });

  it("boosts games where a followed friend is attending", async () => {
    const me = await createTestUser(app);
    await setUserElo(db, me.id, padelId, 1500);

    const hostA = await createTestUser(app);
    const hostB = await createTestUser(app);
    await setUserElo(db, hostA.id, padelId, 1500);
    await setUserElo(db, hostB.id, padelId, 1500);

    await createGameAs(app, hostA, padelId);
    const gameWithFriend = await createGameAs(app, hostB, padelId);

    // A third user joins gameWithFriend; viewer follows that user.
    const friend = await createTestUser(app);
    await setUserElo(db, friend.id, padelId, 1500);
    await joinGame(app, friend, gameWithFriend);
    await followUser(app, me, friend.id);

    const body = await fetchGames(app, me);
    expect(body.items.length).toBe(2);
    expect(body.items[0]!.id).toBe(gameWithFriend);
    expect(body.items[0]!.reasons).toContain("1 friend going");
    expect(body.items[0]!.score).toBeGreaterThan(body.items[1]!.score);
  });

  it("prefers nearer venues when the viewer has a home location", async () => {
    const me = await createTestUser(app);
    await setUserElo(db, me.id, padelId, 1500);
    await setUserHome(db, me.id, 40.4093, 49.8671);

    const hostA = await createTestUser(app);
    const hostB = await createTestUser(app);
    await setUserElo(db, hostA.id, padelId, 1500);
    await setUserElo(db, hostB.id, padelId, 1500);

    // Game A: same coords as viewer (~0 km).
    const gameNear = await createGameAs(app, hostA, padelId, {
      lat: 40.4094,
      lng: 49.8672,
    });
    // Game B: roughly 30 km away in latitude.
    await createGameAs(app, hostB, padelId, {
      lat: 40.68,
      lng: 49.8671,
    });

    const body = await fetchGames(app, me);
    expect(body.items.length).toBe(2);
    expect(body.items[0]!.id).toBe(gameNear);
    expect(body.items[0]!.distance_km).toBeLessThan(1);
    expect(body.items[1]!.distance_km).toBeGreaterThan(20);
  });

  it("respects the limit query param", async () => {
    const me = await createTestUser(app);
    await setUserElo(db, me.id, padelId, 1500);
    for (let i = 0; i < 4; i += 1) {
      const host = await createTestUser(app);
      await setUserElo(db, host.id, padelId, 1500);
      await createGameAs(app, host, padelId, {
        startsAt: new Date(Date.now() + ONE_HOUR_MS * (i + 1)),
      });
    }

    const body = await fetchGames(app, me, 2);
    expect(body.items.length).toBe(2);
  });
});

describe("GET /api/v1/me/matchmaking/players", () => {
  const env = buildTestEnv();
  let app: LinkfitServer;
  let db: DbHandle;
  let padelId: string;

  beforeAll(async () => {
    db = buildTestDb();
    app = await buildServer({ env, logger: pino({ level: "silent" }), db });
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
    padelId = await getPadelSportId(db);
  });

  it("requires auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/me/matchmaking/players",
    });
    expect(res.statusCode).toBe(401);
  });

  it("excludes the viewer and users they already follow", async () => {
    const me = await createTestUser(app);
    const followed = await createTestUser(app);
    const stranger = await createTestUser(app);
    await followUser(app, me, followed.id);

    const body = await fetchPlayers(app, me);
    const ids = body.items.map((p) => p.user_id);
    expect(ids).not.toContain(me.id);
    expect(ids).not.toContain(followed.id);
    expect(ids).toContain(stranger.id);
  });

  it("ranks ELO-similar players above wildly mismatched ones", async () => {
    const me = await createTestUser(app);
    await setUserElo(db, me.id, padelId, 1500);
    // Force a "primary sport" stat row for the viewer by playing a game.
    // We bypass the games path and just seed stats directly.

    const close = await createTestUser(app);
    await setUserElo(db, close.id, padelId, 1520);
    const far = await createTestUser(app);
    await setUserElo(db, far.id, padelId, 2100);

    const body = await fetchPlayers(app, me);
    const ids = body.items.map((p) => p.user_id);
    const closeIdx = ids.indexOf(close.id);
    const farIdx = ids.indexOf(far.id);
    expect(closeIdx).toBeGreaterThanOrEqual(0);
    expect(farIdx).toBeGreaterThanOrEqual(0);
    expect(closeIdx).toBeLessThan(farIdx);
  });

  it("includes a mutual_followers reason when applicable", async () => {
    const me = await createTestUser(app);
    await setUserElo(db, me.id, padelId, 1500);

    const candidate = await createTestUser(app);
    await setUserElo(db, candidate.id, padelId, 1500);

    // Viewer + candidate both follow the same third user → mutual = 1.
    const mutual = await createTestUser(app);
    await followUser(app, me, mutual.id);
    await followUser(app, candidate, mutual.id);

    const body = await fetchPlayers(app, me);
    const row = body.items.find((p) => p.user_id === candidate.id);
    expect(row).toBeDefined();
    expect(row!.mutual_followers_count).toBe(1);
    expect(row!.reasons).toContain("1 mutual follower");
  });

  it("respects the limit query param", async () => {
    const me = await createTestUser(app);
    for (let i = 0; i < 3; i += 1) {
      await createTestUser(app);
    }
    const body = await fetchPlayers(app, me, 2);
    expect(body.items.length).toBe(2);
  });

  it("never references the viewer's home_lat/lng when it is unset", async () => {
    // Viewer has no home_lat/lng — distance signal must collapse to 0 and
    // results must still come back (no nulls, no crashes).
    const me = await createTestUser(app);
    const candidate = await createTestUser(app);
    await setUserHome(db, candidate.id, 40.41, 49.87);

    const body = await fetchPlayers(app, me);
    const row = body.items.find((p) => p.user_id === candidate.id);
    expect(row).toBeDefined();
    expect(row!.distance_km).toBeNull();
    expect(row!.score).toBeGreaterThanOrEqual(0);
    expect(row!.score).toBeLessThanOrEqual(1);
  });

  // Pinned scoring test — locks the exact formula so refactors that change
  // weights without updating the test will fail. If you intentionally
  // change weights, update both this expectation and the comment in
  // matchmaking.service.ts.
  it("produces a deterministic score for an isolated candidate", async () => {
    const me = await createTestUser(app);
    const candidate = await createTestUser(app);
    // Same ELO (delta 0 → eloScore 1), no mutual, no distance signal,
    // default reliability 100 → reliabilityScore 1.
    // raw = (0.4+0.1)*1 + 0.25*0 + 0.2*0 + 0.05*1 = 0.55
    await setUserElo(db, candidate.id, padelId, 1200);

    const body = await fetchPlayers(app, me);
    const row = body.items.find((p) => p.user_id === candidate.id);
    expect(row).toBeDefined();
    expect(row!.score).toBeCloseTo(0.55, 2);
  });

  // Sanity test — empty DB shouldn't crash and the response shape stays
  // valid. Belt-and-braces against accidental SQL changes.
  it("returns an empty list when only the viewer exists", async () => {
    const me = await createTestUser(app);
    const body = await fetchPlayers(app, me);
    expect(body.items).toEqual([]);
  });

  // A future starts_at far enough out shouldn't dominate ranking — this
  // guards against accidentally adding `starts_at ASC` as the primary
  // sort key in the service (we sort by score first).
  it(
    "soon-to-start games do not outrank a high-ELO match",
    { timeout: 30_000 },
    async () => {
      const me = await createTestUser(app);
      await setUserElo(db, me.id, padelId, 1500);

      // Game A: starts soon, host ELO 2000 (far from viewer).
      const hostA = await createTestUser(app);
      await setUserElo(db, hostA.id, padelId, 2000);
      const gameSoonFar = await createGameAs(app, hostA, padelId, {
        startsAt: new Date(Date.now() + ONE_HOUR_MS),
      });

      // Game B: starts in 7 days, host ELO 1500 (similar to viewer).
      const hostB = await createTestUser(app);
      await setUserElo(db, hostB.id, padelId, 1500);
      const gameLaterClose = await createGameAs(app, hostB, padelId, {
        startsAt: new Date(Date.now() + 7 * ONE_DAY_MS),
      });

      const body = await fetchGames(app, me);
      expect(body.items.length).toBe(2);
      // Closer ELO wins despite being further out on the calendar.
      expect(body.items[0]!.id).toBe(gameLaterClose);
      expect(body.items[1]!.id).toBe(gameSoonFar);
    },
  );
});
