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

interface PublicProfileBody {
  id: string;
  display_name: string;
  stats: {
    sport_slug: string;
    elo_rating: number;
    games_played: number;
    games_won: number;
    reliability_score: number;
  }[];
}

async function getPadelSportId(db: DbHandle): Promise<string> {
  const r = await sql<{ id: string }>`SELECT id FROM sports WHERE slug='padel'`.execute(db.db);
  return r.rows[0]!.id;
}

async function rewindGameStart(db: DbHandle, gameId: string): Promise<void> {
  await sql`UPDATE games SET starts_at = now() - interval '2 hours' WHERE id = ${gameId}`.execute(
    db.db,
  );
}

describe("ratings & profile routes", () => {
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

  async function setupFinishedPadelGame(): Promise<{
    host: TestUser;
    others: TestUser[];
    gameId: string;
  }> {
    const host = await createTestUser(app);
    const u2 = await createTestUser(app);
    const u3 = await createTestUser(app);
    const u4 = await createTestUser(app);

    const create = await app.inject({
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
    const { id } = create.json<{ id: string }>();
    for (const u of [u2, u3, u4]) {
      const r = await app.inject({
        method: "POST",
        url: `/api/v1/games/${id}/join`,
        headers: { authorization: `Bearer ${u.access_token}` },
      });
      expect(r.statusCode).toBe(200);
    }
    await rewindGameStart(db, id);
    return { host, others: [u2, u3, u4], gameId: id };
  }

  describe("POST /games/:id/ratings", () => {
    it("records ratings, moves ELO for rated users, regens reliability", async () => {
      const { host, others, gameId } = await setupFinishedPadelGame();

      // Host reports outcomes from each rated user's perspective:
      // others[0] won (ELO up), others[1] won (ELO up), others[2] lost (ELO down).
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/games/${gameId}/ratings`,
        headers: { authorization: `Bearer ${host.access_token}` },
        payload: {
          ratings: [
            { rated_user_id: others[0]!.id, outcome: "win",  behavior_ok: true },
            { rated_user_id: others[1]!.id, outcome: "win",  behavior_ok: true },
            { rated_user_id: others[2]!.id, outcome: "loss", behavior_ok: true },
          ],
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ recorded: number; skipped_duplicates: number }>()).toEqual({
        recorded: 3,
        skipped_duplicates: 0,
      });

      const winnerProfile = await app.inject({
        method: "GET",
        url: `/api/v1/users/${others[0]!.id}/profile`,
      });
      const winnerStats = winnerProfile.json<PublicProfileBody>().stats[0]!;
      expect(winnerStats.sport_slug).toBe("padel");
      expect(winnerStats.elo_rating).toBeGreaterThan(1200);
      expect(winnerStats.games_played).toBe(1);
      expect(winnerStats.games_won).toBe(1);
      expect(winnerStats.reliability_score).toBe(100);

      const loserProfile = await app.inject({
        method: "GET",
        url: `/api/v1/users/${others[2]!.id}/profile`,
      });
      const loserStats = loserProfile.json<PublicProfileBody>().stats[0]!;
      expect(loserStats.elo_rating).toBeLessThan(1200);
      expect(loserStats.games_won).toBe(0);
    });

    it("is idempotent — re-submitting the same ratings does not double-apply", async () => {
      const { host, others, gameId } = await setupFinishedPadelGame();
      const body = {
        ratings: others.map((u) => ({
          rated_user_id: u.id,
          outcome: "draw" as const,
          behavior_ok: true,
        })),
      };
      const first = await app.inject({
        method: "POST",
        url: `/api/v1/games/${gameId}/ratings`,
        headers: { authorization: `Bearer ${host.access_token}` },
        payload: body,
      });
      expect(first.statusCode).toBe(200);
      expect(first.json<{ recorded: number }>().recorded).toBe(3);

      const second = await app.inject({
        method: "POST",
        url: `/api/v1/games/${gameId}/ratings`,
        headers: { authorization: `Bearer ${host.access_token}` },
        payload: body,
      });
      expect(second.statusCode).toBe(200);
      expect(second.json<{ recorded: number; skipped_duplicates: number }>()).toEqual({
        recorded: 0,
        skipped_duplicates: 3,
      });

      // Stats unchanged on the second submission.
      const profile = await app.inject({
        method: "GET",
        url: `/api/v1/users/${others[0]!.id}/profile`,
      });
      const stats = profile.json<PublicProfileBody>().stats[0]!;
      expect(stats.games_played).toBe(1);
    });

    it("forbids non-participants from rating", async () => {
      const { gameId } = await setupFinishedPadelGame();
      const stranger = await createTestUser(app);
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/games/${gameId}/ratings`,
        headers: { authorization: `Bearer ${stranger.access_token}` },
        payload: {
          ratings: [
            { rated_user_id: stranger.id, outcome: "win", behavior_ok: true },
          ],
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it("rejects self-rating", async () => {
      const { host, gameId } = await setupFinishedPadelGame();
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/games/${gameId}/ratings`,
        headers: { authorization: `Bearer ${host.access_token}` },
        payload: {
          ratings: [{ rated_user_id: host.id, outcome: "win", behavior_ok: true }],
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it("rejects rating before the game starts", async () => {
      const host = await createTestUser(app);
      const create = await app.inject({
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
      const { id } = create.json<{ id: string }>();
      const target = await createTestUser(app);
      await app.inject({
        method: "POST",
        url: `/api/v1/games/${id}/join`,
        headers: { authorization: `Bearer ${target.access_token}` },
      });

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/games/${id}/ratings`,
        headers: { authorization: `Bearer ${host.access_token}` },
        payload: {
          ratings: [{ rated_user_id: target.id, outcome: "win", behavior_ok: true }],
        },
      });
      expect(res.statusCode).toBe(422);
    });
  });

  describe("GET /users/:id/profile", () => {
    it("returns a user with empty stats when no ratings have been submitted", async () => {
      const u = await createTestUser(app);
      const res = await app.inject({ method: "GET", url: `/api/v1/users/${u.id}/profile` });
      expect(res.statusCode).toBe(200);
      const body = res.json<PublicProfileBody>();
      expect(body.id).toBe(u.id);
      expect(body.stats).toEqual([]);
    });

    it("returns 404 for unknown user id", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/users/00000000-0000-0000-0000-000000000000/profile",
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
