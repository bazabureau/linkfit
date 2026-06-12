import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import { sql } from "kysely";
import { buildServer, type LinkfitServer } from "../../shared/http/server.js";
import { buildTestDb } from "../../../tests/helpers/db.js";
import { buildTestEnv } from "../../../tests/helpers/env.js";
import { createTestUser, truncateAll, type TestUser } from "../../../tests/helpers/fixtures.js";
import { type DbHandle } from "../../shared/db/pool.js";

async function getPadelSportId(db: DbHandle): Promise<string> {
  const row = await sql<{ id: string }>`SELECT id FROM sports WHERE slug = 'padel'`.execute(db.db);
  return row.rows[0]!.id;
}

interface SeriesGameBody {
  id: string;
  occurrence_number: number;
  starts_at: string;
  status: "open" | "full" | "cancelled" | "completed";
  participants_count: number;
}

interface SeriesDetailBody {
  id: string;
  host_user_id: string;
  occurrences: number;
  status: "active" | "cancelled";
  day_of_week: number;
  time_of_day: string;
  games: SeriesGameBody[];
}

describe("game-series routes", () => {
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

  async function createSeries(
    host: TestUser,
    overrides: Record<string, unknown> = {},
  ): Promise<SeriesDetailBody> {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/game-series",
      headers: { authorization: `Bearer ${host.access_token}` },
      payload: {
        sport_id: padelId,
        lat: 40.4093,
        lng: 49.8671,
        day_of_week: 2, // Tuesday
        time_of_day: "19:00",
        duration_minutes: 90,
        capacity: 4,
        occurrences: 8,
        ...overrides,
      },
    });
    if (res.statusCode !== 201) {
      throw new Error(`createSeries failed: ${String(res.statusCode)} ${res.body}`);
    }
    return res.json<SeriesDetailBody>();
  }

  // ─────────────────────── POST /game-series ───────────────────────

  describe("POST /api/v1/game-series", () => {
    it("creates a series and materializes N future games", async () => {
      const host = await createTestUser(app);
      const series = await createSeries(host, { occurrences: 8 });
      expect(series.host_user_id).toBe(host.id);
      expect(series.occurrences).toBe(8);
      expect(series.status).toBe("active");
      expect(series.games.length).toBe(8);
      // occurrence numbers are 1..8 in order.
      for (let i = 0; i < 8; i += 1) {
        expect(series.games[i]!.occurrence_number).toBe(i + 1);
      }
      // host is auto-confirmed for every instance.
      for (const g of series.games) {
        expect(g.participants_count).toBe(1);
      }
      // Spacing: each game starts exactly 7 days after the previous one.
      for (let i = 1; i < series.games.length; i += 1) {
        const prev = new Date(series.games[i - 1]!.starts_at).getTime();
        const curr = new Date(series.games[i]!.starts_at).getTime();
        expect(curr - prev).toBe(7 * 24 * 60 * 60 * 1000);
      }
    });

    it("rejects an unknown sport_id with 400", async () => {
      const host = await createTestUser(app);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/game-series",
        headers: { authorization: `Bearer ${host.access_token}` },
        payload: {
          sport_id: "00000000-0000-0000-0000-000000000000",
          lat: 40.4, lng: 49.8,
          day_of_week: 2, time_of_day: "19:00",
          duration_minutes: 90, capacity: 4, occurrences: 4,
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it("rejects capacity outside the sport's min/max", async () => {
      const host = await createTestUser(app);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/game-series",
        headers: { authorization: `Bearer ${host.access_token}` },
        payload: {
          sport_id: padelId, lat: 40.4, lng: 49.8,
          day_of_week: 2, time_of_day: "19:00",
          duration_minutes: 90, capacity: 40, occurrences: 4,
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it("requires authentication", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/game-series",
        payload: {
          sport_id: padelId, lat: 40.4, lng: 49.8,
          day_of_week: 2, time_of_day: "19:00",
          duration_minutes: 90, capacity: 4, occurrences: 4,
        },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // ─────────────────────── GET /game-series/:id ───────────────────────

  describe("GET /api/v1/game-series/:id", () => {
    it("returns the series with all materialized games", async () => {
      const host = await createTestUser(app);
      const created = await createSeries(host, { occurrences: 3 });
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/game-series/${created.id}`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<SeriesDetailBody>();
      expect(body.id).toBe(created.id);
      expect(body.games.length).toBe(3);
    });

    it("returns 404 for unknown series id", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/game-series/00000000-0000-0000-0000-000000000000",
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ─────────────────────── POST /game-series/:id/cancel ───────────────────────

  describe("POST /api/v1/game-series/:id/cancel", () => {
    it("cancels games from the given occurrence onward, leaving earlier ones intact", async () => {
      const host = await createTestUser(app);
      const series = await createSeries(host, { occurrences: 6 });
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/game-series/${series.id}/cancel`,
        headers: { authorization: `Bearer ${host.access_token}` },
        payload: { from_occurrence: 4 },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ cancelled_count: number }>().cancelled_count).toBe(3);

      const detail = await app.inject({
        method: "GET",
        url: `/api/v1/game-series/${series.id}`,
      });
      const body = detail.json<SeriesDetailBody>();
      // Occurrences 1-3 still 'open', 4-6 now 'cancelled'.
      expect(body.games.find((g) => g.occurrence_number === 1)!.status).toBe("open");
      expect(body.games.find((g) => g.occurrence_number === 3)!.status).toBe("open");
      expect(body.games.find((g) => g.occurrence_number === 4)!.status).toBe("cancelled");
      expect(body.games.find((g) => g.occurrence_number === 6)!.status).toBe("cancelled");
      // The series row itself stays active because occurrence 1 was preserved.
      expect(body.status).toBe("active");
    });

    it("flips the series to 'cancelled' when from_occurrence=1", async () => {
      const host = await createTestUser(app);
      const series = await createSeries(host, { occurrences: 4 });
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/game-series/${series.id}/cancel`,
        headers: { authorization: `Bearer ${host.access_token}` },
        payload: { from_occurrence: 1 },
      });
      expect(res.statusCode).toBe(200);
      const detail = await app.inject({ method: "GET", url: `/api/v1/game-series/${series.id}` });
      const body = detail.json<SeriesDetailBody>();
      expect(body.status).toBe("cancelled");
      for (const g of body.games) {
        expect(g.status).toBe("cancelled");
      }
    });

    it("rejects cancel from a non-host with 403", async () => {
      const host = await createTestUser(app);
      const stranger = await createTestUser(app);
      const series = await createSeries(host);
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/game-series/${series.id}/cancel`,
        headers: { authorization: `Bearer ${stranger.access_token}` },
        payload: { from_occurrence: 1 },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // ─────────────────────── games table linkage ───────────────────────

  it("tags every materialized game with series_id and a unique occurrence_number", async () => {
    const host = await createTestUser(app);
    const series = await createSeries(host, { occurrences: 5 });
    const rows = await sql<{ series_id: string | null; occurrence_number: number | null }>`
      SELECT series_id, occurrence_number
        FROM games
       WHERE series_id = ${series.id}::uuid
       ORDER BY occurrence_number ASC
    `.execute(db.db);
    expect(rows.rows.length).toBe(5);
    rows.rows.forEach((r, i) => {
      expect(r.series_id).toBe(series.id);
      expect(r.occurrence_number).toBe(i + 1);
    });
  });
});
