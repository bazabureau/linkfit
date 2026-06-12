import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import { sql } from "kysely";
import { buildServer, type LinkfitServer } from "../../shared/http/server.js";
import { buildTestDb } from "../../../tests/helpers/db.js";
import { buildTestEnv } from "../../../tests/helpers/env.js";
import { createTestUser, truncateAll, type TestUser } from "../../../tests/helpers/fixtures.js";
import { type DbHandle } from "../../shared/db/pool.js";

const ONE_HOUR_MS = 60 * 60 * 1000;

interface GameDetailBody {
  id: string;
  capacity: number;
  status: "open" | "full" | "cancelled" | "completed";
  participants_count: number;
  participants: { user_id: string; status: string }[];
  host_user_id: string;
}

async function getPadelSportId(db: DbHandle): Promise<string> {
  const row = await sql<{ id: string }>`SELECT id FROM sports WHERE slug = 'padel'`.execute(
    db.db,
  );
  return row.rows[0]!.id;
}

describe("games routes", () => {
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

  async function createGame(host: TestUser, overrides: Record<string, unknown> = {}): Promise<GameDetailBody> {
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
    return res.json<GameDetailBody>();
  }

  // ─────────────────────── POST /games ───────────────────────

  describe("POST /api/v1/games", () => {
    it("creates a game with the host as the first participant", async () => {
      const host = await createTestUser(app);
      const game = await createGame(host);
      expect(game.host_user_id).toBe(host.id);
      expect(game.participants_count).toBe(1);
      expect(game.participants[0]!.user_id).toBe(host.id);
      expect(game.status).toBe("open");
    });

    it("rejects starts_at in the past", async () => {
      const host = await createTestUser(app);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/games",
        headers: { authorization: `Bearer ${host.access_token}` },
        payload: {
          sport_id: padelId,
          lat: 40.4093,
          lng: 49.8671,
          starts_at: new Date(Date.now() - 60_000).toISOString(),
          duration_minutes: 90,
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it("rejects unknown sport_id", async () => {
      const host = await createTestUser(app);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/games",
        headers: { authorization: `Bearer ${host.access_token}` },
        payload: {
          sport_id: "00000000-0000-0000-0000-000000000000",
          lat: 40.4093,
          lng: 49.8671,
          starts_at: new Date(Date.now() + ONE_HOUR_MS).toISOString(),
          duration_minutes: 90,
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it("requires authentication", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/games",
        payload: {
          sport_id: padelId,
          lat: 40.4093,
          lng: 49.8671,
          starts_at: new Date(Date.now() + ONE_HOUR_MS).toISOString(),
          duration_minutes: 90,
        },
      });
      expect(res.statusCode).toBe(401);
    });

    it("replays the same game when the host retries with the same idempotency_key", async () => {
      const host = await createTestUser(app);
      const key = "5e0a2f1c-9d3b-4a87-b1e4-2c6f8a9d0e51";
      const first = await createGame(host, { idempotency_key: key });
      const second = await createGame(host, { idempotency_key: key });
      expect(second.id).toBe(first.id);
      expect(second.participants_count).toBe(1);

      const count = await sql<{ c: string }>`SELECT count(*)::text AS c FROM games`.execute(
        db.db,
      );
      expect(Number(count.rows[0]!.c)).toBe(1);
    });

    it("different idempotency_keys (or none) still mint distinct games", async () => {
      const host = await createTestUser(app);
      const a = await createGame(host, {
        idempotency_key: "11111111-1111-4111-8111-111111111111",
      });
      const b = await createGame(host, {
        idempotency_key: "22222222-2222-4222-8222-222222222222",
      });
      const c = await createGame(host); // no key — legacy clients
      expect(new Set([a.id, b.id, c.id]).size).toBe(3);
    });

    it("the same idempotency_key used by two different hosts does not collide", async () => {
      const key = "33333333-3333-4333-8333-333333333333";
      const hostA = await createTestUser(app);
      const hostB = await createTestUser(app);
      const a = await createGame(hostA, { idempotency_key: key });
      const b = await createGame(hostB, { idempotency_key: key });
      expect(a.id).not.toBe(b.id);
      expect(a.host_user_id).toBe(hostA.id);
      expect(b.host_user_id).toBe(hostB.id);
    });

    it("rejects a non-uuid idempotency_key", async () => {
      const host = await createTestUser(app);
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
          idempotency_key: "not-a-uuid",
        },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ─────────────────────── GET /games ───────────────────────

  describe("GET /api/v1/games", () => {
    it("returns the open games in chronological order", async () => {
      const host = await createTestUser(app);
      await createGame(host, { starts_at: new Date(Date.now() + 4 * ONE_HOUR_MS).toISOString() });
      await createGame(host, { starts_at: new Date(Date.now() + 2 * ONE_HOUR_MS).toISOString() });
      const res = await app.inject({ method: "GET", url: "/api/v1/games" });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ items: { starts_at: string }[]; next_cursor: string | null }>();
      expect(body.items.length).toBe(2);
      expect(new Date(body.items[0]!.starts_at).getTime()).toBeLessThan(
        new Date(body.items[1]!.starts_at).getTime(),
      );
    });

    it("filters games by geo radius", async () => {
      const host = await createTestUser(app);
      await createGame(host, { lat: 40.4093, lng: 49.8671 }); // Baku
      await createGame(host, { lat: 41.2995, lng: 69.2401 }); // Tashkent
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/games?lat=40.4&lng=49.85&radius_km=20",
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ items: unknown[] }>().items.length).toBe(1);
    });
  });

  // ─────────────────────── join / leave ───────────────────────

  describe("POST /games/:id/join + leave", () => {
    it("joins, then leaves, restoring status to open", async () => {
      const host = await createTestUser(app);
      const player = await createTestUser(app);
      const game = await createGame(host, { capacity: 4 });

      const join = await app.inject({
        method: "POST",
        url: `/api/v1/games/${game.id}/join`,
        headers: { authorization: `Bearer ${player.access_token}` },
      });
      expect(join.statusCode).toBe(200);
      expect(join.json<GameDetailBody>().participants_count).toBe(2);

      const leave = await app.inject({
        method: "POST",
        url: `/api/v1/games/${game.id}/leave`,
        headers: { authorization: `Bearer ${player.access_token}` },
      });
      expect(leave.statusCode).toBe(200);
      expect(leave.json<GameDetailBody>().participants_count).toBe(1);
    });

    it("rejects join on a cancelled game with 422", async () => {
      const host = await createTestUser(app);
      const player = await createTestUser(app);
      const game = await createGame(host);
      await app.inject({
        method: "PATCH",
        url: `/api/v1/games/${game.id}`,
        headers: { authorization: `Bearer ${host.access_token}` },
        payload: { cancel: true },
      });
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/games/${game.id}/join`,
        headers: { authorization: `Bearer ${player.access_token}` },
      });
      expect(res.statusCode).toBe(422);
    });

    /**
     * THE concurrent-join test. Create a 4-seat game with the host already in
     * (3 seats free). Fire 20 join attempts in parallel from 20 different
     * users. Exactly 3 must succeed; the rest must get 409. This is the
     * canonical "you cannot oversell capacity" guarantee.
     */
    it("under concurrent load, never oversells capacity", async () => {
      const host = await createTestUser(app);
      const game = await createGame(host, { capacity: 4 });

      const contenders = await Promise.all(
        Array.from({ length: 20 }, () => createTestUser(app)),
      );

      const results = await Promise.all(
        contenders.map((u) =>
          app.inject({
            method: "POST",
            url: `/api/v1/games/${game.id}/join`,
            headers: { authorization: `Bearer ${u.access_token}` },
          }),
        ),
      );
      const succeeded = results.filter((r) => r.statusCode === 200).length;
      const conflicted = results.filter((r) => r.statusCode === 409).length;
      expect(succeeded).toBe(3); // 4 capacity − 1 host = 3 seats
      expect(succeeded + conflicted).toBe(20);

      // DB ground truth: exactly capacity rows in 'confirmed' status.
      const count = await sql<{ c: string }>`
        SELECT count(*)::text AS c FROM game_participants
         WHERE game_id = ${game.id} AND status = 'confirmed'
      `.execute(db.db);
      expect(Number(count.rows[0]!.c)).toBe(4);

      // Game status is 'full'
      const status = await sql<{ status: string }>`
        SELECT status FROM games WHERE id = ${game.id}
      `.execute(db.db);
      expect(status.rows[0]!.status).toBe("full");
    });
  });

  // ─────────────────────── host actions ───────────────────────

  describe("PATCH /games/:id", () => {
    it("lets the host cancel; rejects other users", async () => {
      const host = await createTestUser(app);
      const stranger = await createTestUser(app);
      const game = await createGame(host);

      const strangerAttempt = await app.inject({
        method: "PATCH",
        url: `/api/v1/games/${game.id}`,
        headers: { authorization: `Bearer ${stranger.access_token}` },
        payload: { cancel: true },
      });
      expect(strangerAttempt.statusCode).toBe(403);

      const hostCancel = await app.inject({
        method: "PATCH",
        url: `/api/v1/games/${game.id}`,
        headers: { authorization: `Bearer ${host.access_token}` },
        payload: { cancel: true },
      });
      expect(hostCancel.statusCode).toBe(200);
      expect(hostCancel.json<GameDetailBody>().status).toBe("cancelled");
    });
  });
});
