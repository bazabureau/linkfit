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
import { AchievementsService } from "./achievements.service.js";

const ONE_HOUR_MS = 60 * 60 * 1000;

interface AchievementBody {
  slug: string;
  name: string;
  description: string;
  icon_name: string;
  unlocked: boolean;
  unlocked_at: string | null;
  progress: { current: number; target: number; unit: string } | null;
}
interface AchievementsResponseBody {
  items: AchievementBody[];
  unlocked_count: number;
  total_count: number;
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

/** Re-seed the achievements catalog after a TRUNCATE. We don't truncate the
 * catalog itself in `truncateAll`, but a fresh test DB may have nothing in
 * `achievements` if the seed migration wasn't replayed. Calling this from
 * `beforeEach` keeps the suite hermetic. */
async function ensureCatalog(db: DbHandle): Promise<void> {
  await sql`
    INSERT INTO achievements (slug, name, description, icon_name, criteria) VALUES
      ('first_game','First Game','Played first game.','figure.tennis',
       '{"type":"games_played","value":1,"sport":"padel"}'::jsonb),
      ('ten_games','Ten in the Books','10 games.','number.square',
       '{"type":"games_played","value":10,"sport":"padel"}'::jsonb),
      ('elo_1500','Sharp Edge','Reached 1500 ELO.','bolt',
       '{"type":"elo_min","value":1500,"sport":"padel"}'::jsonb),
      ('elo_2000','Elite Tier','Reached 2000 ELO.','crown',
       '{"type":"elo_min","value":2000,"sport":"padel"}'::jsonb),
      ('win_streak_5','Hot Streak','5 wins in a row.','flame',
       '{"type":"win_streak","value":5,"sport":"padel"}'::jsonb),
      ('reliable_player','Reliable','90%+ over 20 games.','shield.checkered',
       '{"type":"reliability_min","value":90,"min_games":20,"sport":"padel"}'::jsonb),
      ('rating_giver','Fair Judge','25 ratings given.','star.bubble',
       '{"type":"ratings_given","value":25}'::jsonb),
      ('tournament_finalist','Finalist','Played a final.','trophy',
       '{"type":"tournament_finalist"}'::jsonb),
      ('no_show_free_month','Always Shows','30 days clean.','checkmark.seal',
       '{"type":"no_show_free_month"}'::jsonb)
    ON CONFLICT (slug) DO NOTHING
  `.execute(db.db);
}

async function setupFinishedPadelGame(
  app: LinkfitServer,
  db: DbHandle,
  padelId: string,
): Promise<{ host: TestUser; others: TestUser[]; gameId: string }> {
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

describe("achievements module", () => {
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
    await sql`DELETE FROM user_achievements`.execute(db.db);
    await sql`DELETE FROM achievements`.execute(db.db);
    await ensureCatalog(db);
    padelId = await getPadelSportId(db);
  });

  it("GET /users/:id/achievements returns full catalog locked for a new user", async () => {
    const u = await createTestUser(app);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/users/${u.id}/achievements`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<AchievementsResponseBody>();
    expect(body.unlocked_count).toBe(0);
    expect(body.total_count).toBeGreaterThanOrEqual(9);
    for (const item of body.items) {
      expect(item.unlocked).toBe(false);
      expect(item.unlocked_at).toBeNull();
    }
    // Some locked items expose progress.
    const first = body.items.find((i) => i.slug === "first_game");
    expect(first?.progress).toEqual({ current: 0, target: 1, unit: "games" });
  });

  it("unlocks `first_game` after a completed-and-rated padel game", async () => {
    const { host, others, gameId } = await setupFinishedPadelGame(app, db, padelId);
    // Host submits ratings — this triggers achievements evaluation post-commit.
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/games/${gameId}/ratings`,
      headers: { authorization: `Bearer ${host.access_token}` },
      payload: {
        ratings: [
          { rated_user_id: others[0]!.id, outcome: "win", behavior_ok: true },
          { rated_user_id: others[1]!.id, outcome: "win", behavior_ok: true },
          { rated_user_id: others[2]!.id, outcome: "loss", behavior_ok: true },
        ],
      },
    });
    expect(res.statusCode).toBe(200);

    // Loop until the winner has unlocked first_game (post-commit fire-and-forget).
    // In practice it's instant, but allow a tiny grace window.
    const winnerId = others[0]!.id;
    let body: AchievementsResponseBody | null = null;
    for (let i = 0; i < 10; i++) {
      const r = await app.inject({
        method: "GET",
        url: `/api/v1/users/${winnerId}/achievements`,
      });
      body = r.json<AchievementsResponseBody>();
      if (body.unlocked_count > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(body!.unlocked_count).toBeGreaterThanOrEqual(1);
    const firstGame = body!.items.find((i) => i.slug === "first_game");
    expect(firstGame?.unlocked).toBe(true);
    expect(firstGame?.unlocked_at).not.toBeNull();
  });

  it("evaluateForUser is idempotent — second call adds no new unlocks", async () => {
    const u = await createTestUser(app);
    // Boost the player to satisfy `elo_1500` directly via SQL.
    await sql`
      INSERT INTO player_sport_stats (user_id, sport_id, elo_rating, games_played, games_won, reliability_score)
      VALUES (${u.id}, ${padelId}, 1500, 5, 4, 100)
    `.execute(db.db);

    const svc = new AchievementsService({ db });
    const first = await svc.evaluateForUser(u.id);
    const second = await svc.evaluateForUser(u.id);
    expect(first).toContain("elo_1500");
    expect(first).toContain("first_game"); // games_played >= 1
    expect(second).toHaveLength(0);
  });

  it("elo_min progress shows current ELO toward target while locked", async () => {
    const u = await createTestUser(app);
    await sql`
      INSERT INTO player_sport_stats (user_id, sport_id, elo_rating, games_played, games_won, reliability_score)
      VALUES (${u.id}, ${padelId}, 1450, 3, 2, 100)
    `.execute(db.db);
    const r = await app.inject({
      method: "GET",
      url: `/api/v1/users/${u.id}/achievements`,
    });
    const body = r.json<AchievementsResponseBody>();
    const elo1500 = body.items.find((i) => i.slug === "elo_1500");
    expect(elo1500?.unlocked).toBe(false);
    expect(elo1500?.progress).toEqual({ current: 1450, target: 1500, unit: "elo" });
    const elo2000 = body.items.find((i) => i.slug === "elo_2000");
    expect(elo2000?.progress).toEqual({ current: 1450, target: 2000, unit: "elo" });
  });

  it("reliable_player requires BOTH min_games AND reliability threshold", async () => {
    const lowGames = await createTestUser(app);
    await sql`
      INSERT INTO player_sport_stats (user_id, sport_id, elo_rating, games_played, games_won, reliability_score)
      VALUES (${lowGames.id}, ${padelId}, 1300, 5, 3, 100)
    `.execute(db.db);

    const veteran = await createTestUser(app);
    await sql`
      INSERT INTO player_sport_stats (user_id, sport_id, elo_rating, games_played, games_won, reliability_score)
      VALUES (${veteran.id}, ${padelId}, 1300, 22, 12, 95)
    `.execute(db.db);

    const svc = new AchievementsService({ db });
    const aSlugs = await svc.evaluateForUser(lowGames.id);
    const bSlugs = await svc.evaluateForUser(veteran.id);
    expect(aSlugs).not.toContain("reliable_player");
    expect(bSlugs).toContain("reliable_player");
  });

  it("returns 404 for unknown user id", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/users/00000000-0000-0000-0000-000000000000/achievements",
    });
    expect(r.statusCode).toBe(404);
  });

  it("does not unlock anything for a brand-new user with no stats", async () => {
    const u = await createTestUser(app);
    const svc = new AchievementsService({ db });
    const slugs = await svc.evaluateForUser(u.id);
    expect(slugs).toHaveLength(0);
  });

  it("win_streak unlocks after 5 consecutive wins", async () => {
    const user = await createTestUser(app);
    const host = await createTestUser(app);

    // Insert a stats row so games_played/elo lookups don't fail.
    await sql`
      INSERT INTO player_sport_stats (user_id, sport_id, elo_rating, games_played, games_won, reliability_score)
      VALUES (${user.id}, ${padelId}, 1300, 6, 5, 100)
    `.execute(db.db);

    // Create 6 distinct games — ratings UNIQUE on (game_id, rater, rated).
    const gameIds: string[] = [];
    for (let i = 0; i < 6; i++) {
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/games",
        headers: { authorization: `Bearer ${host.access_token}` },
        payload: {
          sport_id: padelId,
          lat: 40.4093,
          lng: 49.8671,
          starts_at: new Date(Date.now() + (i + 1) * ONE_HOUR_MS).toISOString(),
          duration_minutes: 90,
          capacity: 4,
        },
      });
      gameIds.push(create.json<{ id: string }>().id);
    }

    // 5 newer wins, 1 oldest loss.
    const outcomes = ["loss", "win", "win", "win", "win", "win"];
    for (let i = 0; i < outcomes.length; i++) {
      await sql`
        INSERT INTO ratings (game_id, rater_user_id, rated_user_id, sport_id, outcome, behavior_ok, processed_at, created_at)
        VALUES (${gameIds[i]!}, ${host.id}, ${user.id}, ${padelId}, ${outcomes[i]!}, true,
                now() - interval '${sql.raw(String(outcomes.length - i))} minutes',
                now() - interval '${sql.raw(String(outcomes.length - i))} minutes')
      `.execute(db.db);
    }

    const svc = new AchievementsService({ db });
    const slugs = await svc.evaluateForUser(user.id);
    expect(slugs).toContain("win_streak_5");
  });
});
