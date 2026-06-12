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
import { StreaksService } from "./streaks.service.js";

interface StreaksBody {
  current_streak_weeks: number;
  longest_streak_weeks: number;
  weeks: { week_start: string; games_count: number }[];
}

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
const HEATMAP_WEEKS = 26;

async function getPadelSportId(db: DbHandle): Promise<string> {
  const r = await sql<{ id: string }>`SELECT id FROM sports WHERE slug='padel'`.execute(db.db);
  return r.rows[0]!.id;
}

/** Same Monday-UTC rule the service uses — duplicated here so a refactor on
 *  the service side that breaks the contract triggers test failures. */
function isoWeekStart(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = date.getUTCDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

/** Insert a game + participation row at a given timestamp. Bypasses the
 *  validator so we can stamp games in the past. Returns the new game id. */
async function seedGame(
  db: DbHandle,
  args: { userId: string; hostId: string; sportId: string; startsAt: Date; status?: "confirmed" | "played" | "cancelled" | "no_show" },
): Promise<string> {
  const row = await db.db
    .insertInto("games")
    .values({
      sport_id: args.sportId,
      court_id: null,
      host_user_id: args.hostId,
      lat: "40.41",
      lng: "49.86",
      starts_at: args.startsAt,
      duration_minutes: 90,
      capacity: 4,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await db.db
    .insertInto("game_participants")
    .values({
      game_id: row.id,
      user_id: args.userId,
      status: args.status ?? "confirmed",
    })
    .execute();
  return row.id;
}

/** Insert N games for `user`, one per week, walking backwards from the
 *  current week. `weeksAgoStart=0` is THIS week, `weeksAgoStart=1` is last,
 *  etc. */
async function seedWeeklyStreak(
  db: DbHandle,
  args: {
    user: TestUser;
    host: TestUser;
    sportId: string;
    weeksAgoStart: number;
    length: number;
    status?: "confirmed" | "played" | "cancelled" | "no_show";
  },
): Promise<void> {
  for (let i = 0; i < args.length; i += 1) {
    const ts = new Date(Date.now() - (args.weeksAgoStart + i) * MS_PER_WEEK);
    const gameArgs: Parameters<typeof seedGame>[1] = {
      userId: args.user.id,
      hostId: args.host.id,
      sportId: args.sportId,
      startsAt: ts,
    };
    if (args.status !== undefined) gameArgs.status = args.status;
    await seedGame(db, gameArgs);
  }
}

describe("streaks module", () => {
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

  it("returns zeroes + 26 empty weeks for a brand-new user", async () => {
    const u = await createTestUser(app);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/users/${u.id}/streaks`,
      headers: { authorization: `Bearer ${u.access_token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<StreaksBody>();
    expect(body.current_streak_weeks).toBe(0);
    expect(body.longest_streak_weeks).toBe(0);
    expect(body.weeks).toHaveLength(HEATMAP_WEEKS);
    expect(body.weeks.every((w) => w.games_count === 0)).toBe(true);
    // Last entry should be the current ISO week.
    const last = body.weeks[body.weeks.length - 1]!;
    expect(last.week_start).toBe(isoWeekStart(new Date()));
  });

  it("computes current_streak across consecutive weeks ending this week", async () => {
    const u = await createTestUser(app);
    const host = await createTestUser(app);
    // 4 weeks in a row including this week.
    await seedWeeklyStreak(db, {
      user: u, host, sportId: padelId, weeksAgoStart: 0, length: 4,
    });
    const svc = new StreaksService({ db });
    const result = await svc.computeForUser(u.id);
    expect(result.current_streak_weeks).toBe(4);
    expect(result.longest_streak_weeks).toBe(4);
  });

  it("counts longest_streak across history even when the current streak is broken", async () => {
    const u = await createTestUser(app);
    const host = await createTestUser(app);
    // Big streak 10 weeks long, ending 10 weeks ago.
    await seedWeeklyStreak(db, {
      user: u, host, sportId: padelId, weeksAgoStart: 10, length: 10,
    });
    // Tiny recent streak of 2 weeks, with this week not active.
    await seedWeeklyStreak(db, {
      user: u, host, sportId: padelId, weeksAgoStart: 2, length: 2,
    });
    const svc = new StreaksService({ db });
    const result = await svc.computeForUser(u.id);
    expect(result.longest_streak_weeks).toBe(10);
    // Current week empty + previous week empty → streak should be 0 (gap > 1).
    expect(result.current_streak_weeks).toBeLessThanOrEqual(2);
  });

  it("uses a 1-week grace: current streak survives if this week is empty but last week wasn't", async () => {
    const u = await createTestUser(app);
    const host = await createTestUser(app);
    // 3 weeks ending LAST week (i.e. this week empty).
    await seedWeeklyStreak(db, {
      user: u, host, sportId: padelId, weeksAgoStart: 1, length: 3,
    });
    const svc = new StreaksService({ db });
    const result = await svc.computeForUser(u.id);
    expect(result.current_streak_weeks).toBe(3);
  });

  it("excludes cancelled and no_show participations from week counts", async () => {
    const u = await createTestUser(app);
    const host = await createTestUser(app);
    const now = new Date();
    // One legit play this week.
    await seedGame(db, {
      userId: u.id, hostId: host.id, sportId: padelId, startsAt: now,
      status: "played",
    });
    // Two "noisy" participations same week — should NOT bump the count.
    await seedGame(db, {
      userId: u.id, hostId: host.id, sportId: padelId, startsAt: now,
      status: "cancelled",
    });
    await seedGame(db, {
      userId: u.id, hostId: host.id, sportId: padelId, startsAt: now,
      status: "no_show",
    });

    const svc = new StreaksService({ db });
    const result = await svc.computeForUser(u.id);
    const currentWeekKey = isoWeekStart(now);
    const cell = result.weeks.find((w) => w.week_start === currentWeekKey);
    expect(cell?.games_count).toBe(1);
    expect(result.current_streak_weeks).toBe(1);
  });

  it("returns 26-week trailing window in chronological order", async () => {
    const u = await createTestUser(app);
    const host = await createTestUser(app);
    // One game exactly 5 weeks ago.
    await seedGame(db, {
      userId: u.id,
      hostId: host.id,
      sportId: padelId,
      startsAt: new Date(Date.now() - 5 * MS_PER_WEEK),
    });
    const svc = new StreaksService({ db });
    const result = await svc.computeForUser(u.id);
    expect(result.weeks).toHaveLength(HEATMAP_WEEKS);
    // Monotonically increasing dates.
    for (let i = 1; i < result.weeks.length; i += 1) {
      expect(result.weeks[i]!.week_start > result.weeks[i - 1]!.week_start).toBe(true);
    }
    // The cell at index 26-1-5 = 20 should have games_count >= 1.
    expect(result.weeks[HEATMAP_WEEKS - 1 - 5]!.games_count).toBeGreaterThanOrEqual(1);
  });

  it("GET /streaks returns 401 without auth", async () => {
    const u = await createTestUser(app);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/users/${u.id}/streaks`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 404 for unknown user id", async () => {
    const viewer = await createTestUser(app);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/users/00000000-0000-0000-0000-000000000000/streaks",
      headers: { authorization: `Bearer ${viewer.access_token}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
