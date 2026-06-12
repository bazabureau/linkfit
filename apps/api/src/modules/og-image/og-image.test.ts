import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import { sql } from "kysely";
import { buildServer, type LinkfitServer } from "../../shared/http/server.js";
import { buildTestDb } from "../../../tests/helpers/db.js";
import { buildTestEnv } from "../../../tests/helpers/env.js";
import { createTestUser, truncateAll } from "../../../tests/helpers/fixtures.js";
import { type DbHandle } from "../../shared/db/pool.js";
import { PngCache } from "./cache.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

async function getPadelSportId(db: DbHandle): Promise<string> {
  const row = await sql<{ id: string }>`SELECT id FROM sports WHERE slug = 'padel'`.execute(
    db.db,
  );
  return row.rows[0]!.id;
}

describe("og-image routes", () => {
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

  // PNG magic number: 89 50 4E 47 0D 0A 1A 0A
  function isPng(buf: Buffer): boolean {
    return (
      buf.length >= 8 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47 &&
      buf[4] === 0x0d &&
      buf[5] === 0x0a &&
      buf[6] === 0x1a &&
      buf[7] === 0x0a
    );
  }

  describe("GET /og/game/:id.png", () => {
    it("renders a PNG ≥ 5 KB and caches subsequent calls", async () => {
      const host = await createTestUser(app, { display_name: "Aydan H." });
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
          skill_min_elo: 1100,
          skill_max_elo: 1500,
        },
      });
      expect(create.statusCode).toBe(201);
      const game = create.json<{ id: string }>();

      const t0 = Date.now();
      const first = await app.inject({ method: "GET", url: `/og/game/${game.id}.png` });
      const firstMs = Date.now() - t0;

      expect(first.statusCode).toBe(200);
      expect(first.headers["content-type"]).toBe("image/png");
      const firstBuf = first.rawPayload;
      expect(firstBuf.length).toBeGreaterThanOrEqual(5 * 1024);
      expect(isPng(firstBuf)).toBe(true);

      // Second call should be served from the cache and be substantially
      // faster than the first render. We assert that the buffer is
      // byte-identical and that the wall-clock is "fast" (sub-50ms is
      // realistic — the actual render takes ≥hundreds of ms).
      const t1 = Date.now();
      const second = await app.inject({ method: "GET", url: `/og/game/${game.id}.png` });
      const secondMs = Date.now() - t1;
      expect(second.statusCode).toBe(200);
      expect(second.rawPayload.equals(firstBuf)).toBe(true);
      // Cache hit must beat the cold render comfortably. Render is at
      // minimum ~80ms in this test container; cache hit is single-digit ms.
      expect(secondMs).toBeLessThan(Math.max(50, Math.floor(firstMs / 2)));
    });

    it("returns 404 for an unknown game id", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/og/game/00000000-0000-0000-0000-000000000000.png",
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /og/user/:id.png", () => {
    it("renders a profile card with the user's display name", async () => {
      const user = await createTestUser(app, { display_name: "Vusal Q." });
      // Seed a padel stats row so the card surfaces non-default numbers —
      // the test only checks PNG validity, but this exercises the JOIN.
      await sql`
        INSERT INTO player_sport_stats (user_id, sport_id, elo_rating, games_played, games_won)
        VALUES (${user.id}, ${padelId}, 1340, 42, 27)
      `.execute(db.db);

      const res = await app.inject({ method: "GET", url: `/og/user/${user.id}.png` });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("image/png");
      expect(res.rawPayload.length).toBeGreaterThanOrEqual(5 * 1024);
      expect(isPng(res.rawPayload)).toBe(true);
    });
  });

  describe("GET /og/tournament/:id.png", () => {
    it("renders a tournament card", async () => {
      // Provision a user so the FK-bound test environment matches a real
      // scenario, then insert a tournament directly — there's no public
      // POST endpoint for tournament creation.
      await createTestUser(app, { display_name: "Captain N." });
      const inserted = await sql<{ id: string }>`
        INSERT INTO tournaments (
          name, description, sport_id, venue_id,
          starts_at, ends_at, registration_deadline,
          max_squads, squad_size, entry_fee_minor, currency, status
        ) VALUES (
          'Baku Open 2026', 'Spring padel showdown', ${padelId}, NULL,
          ${new Date(Date.now() + 7 * ONE_DAY_MS)},
          ${new Date(Date.now() + 9 * ONE_DAY_MS)},
          ${new Date(Date.now() + 5 * ONE_DAY_MS)},
          16, 2, 5000, 'USD', 'registration_open'
        )
        RETURNING id
      `.execute(db.db);
      const tournamentId = inserted.rows[0]!.id;

      const res = await app.inject({
        method: "GET",
        url: `/og/tournament/${tournamentId}.png`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("image/png");
      expect(res.rawPayload.length).toBeGreaterThanOrEqual(5 * 1024);
      expect(isPng(res.rawPayload)).toBe(true);
    });
  });
});

// ─────────────────── Pure cache unit test ───────────────────

describe("PngCache", () => {
  it("returns the same buffer on a hit and evicts after TTL expires", () => {
    let now = 1_000;
    const cache = new PngCache({ ttlMs: 100, maxEntries: 3, now: () => now });
    const buf = Buffer.from("hello");
    cache.set("k", buf);
    expect(cache.get("k")?.equals(buf)).toBe(true);
    now += 50;
    expect(cache.get("k")?.equals(buf)).toBe(true);
    now += 200;
    expect(cache.get("k")).toBeNull();
  });

  it("LRU-evicts the oldest entry once max is exceeded", () => {
    let now = 0;
    const cache = new PngCache({ ttlMs: 60_000, maxEntries: 2, now: () => now });
    cache.set("a", Buffer.from("A"));
    now += 1;
    cache.set("b", Buffer.from("B"));
    now += 1;
    cache.set("c", Buffer.from("C"));
    expect(cache.get("a")).toBeNull();
    expect(cache.get("b")?.toString()).toBe("B");
    expect(cache.get("c")?.toString()).toBe("C");
  });
});
