import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import { buildServer, type LinkfitServer } from "../../shared/http/server.js";
import { buildTestDb } from "../../../tests/helpers/db.js";
import { buildTestEnv } from "../../../tests/helpers/env.js";
import { seedBakuPadelVenues, truncateAll } from "../../../tests/helpers/fixtures.js";
import { type DbHandle } from "../../shared/db/pool.js";

describe("catalog routes", () => {
  const env = buildTestEnv();
  let app: LinkfitServer;
  let db: DbHandle;

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
  });

  describe("GET /api/v1/sports", () => {
    it("returns the seeded sports (padel + football_5)", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/sports" });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ items: { slug: string }[] }>();
      const slugs = body.items.map((s) => s.slug).sort();
      expect(slugs).toEqual(["football_5", "padel"]);
    });
  });

  describe("GET /api/v1/venues", () => {
    it("returns every venue when no geo filter is provided", async () => {
      await seedBakuPadelVenues(db);
      const res = await app.inject({ method: "GET", url: "/api/v1/venues" });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ items: unknown[] }>();
      expect(body.items.length).toBe(3);
    });

    it("filters by geo radius and returns sorted-by-distance results", async () => {
      await seedBakuPadelVenues(db);
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/venues?lat=40.4093&lng=49.8671&radius_km=5",
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ items: { name: string; distance_km: number }[] }>();
      expect(body.items.length).toBe(2); // Khirdalan ~18 km is excluded
      expect(body.items[0]!.distance_km).toBeLessThanOrEqual(body.items[1]!.distance_km);
      expect(body.items.map((v) => v.name)).not.toContain("Padel Khirdalan");
    });

    it("rejects partial geo params (lat without lng)", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/venues?lat=40.4" });
      expect(res.statusCode).toBe(400);
    });

    it("filters by sport when no geo provided", async () => {
      await seedBakuPadelVenues(db);
      const res = await app.inject({ method: "GET", url: "/api/v1/venues?sport=padel" });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ items: unknown[] }>().items.length).toBe(3);

      const noMatch = await app.inject({
        method: "GET",
        url: "/api/v1/venues?sport=football_5",
      });
      expect(noMatch.statusCode).toBe(200);
      expect(noMatch.json<{ items: unknown[] }>().items.length).toBe(0);
    });
  });

  describe("GET /api/v1/venues/:id", () => {
    it("returns full venue + courts list", async () => {
      const venues = await seedBakuPadelVenues(db);
      const v = venues[0]!;
      const res = await app.inject({ method: "GET", url: `/api/v1/venues/${v.id}` });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ id: string; courts: { sport_slug: string }[] }>();
      expect(body.id).toBe(v.id);
      expect(body.courts.length).toBe(1);
      expect(body.courts[0]!.sport_slug).toBe("padel");
    });

    it("returns 404 for unknown id", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/venues/00000000-0000-0000-0000-000000000000",
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 400 for malformed UUID", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/venues/not-a-uuid" });
      expect(res.statusCode).toBe(400);
    });
  });
});
