import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import { sql } from "kysely";
import { buildServer, type LinkfitServer } from "../../shared/http/server.js";
import { buildTestDb } from "../../../tests/helpers/db.js";
import { buildTestEnv } from "../../../tests/helpers/env.js";
import {
  createTestUser,
  seedBakuPadelVenues,
  truncateAll,
  type TestUser,
} from "../../../tests/helpers/fixtures.js";
import { type DbHandle } from "../../shared/db/pool.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

interface SearchBody {
  query: string;
  players: { id: string; display_name: string }[];
  games: { id: string; host_display_name: string; notes: string | null }[];
  tournaments: { id: string; name: string }[];
  venues: { id: string; name: string; address: string }[];
}

async function getPadelSportId(db: DbHandle): Promise<string> {
  const row = await sql<{ id: string }>`SELECT id FROM sports WHERE slug = 'padel'`.execute(
    db.db,
  );
  return row.rows[0]!.id;
}

async function createGameWithNotes(
  app: LinkfitServer,
  host: TestUser,
  padelId: string,
  notes: string,
): Promise<string> {
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
      notes,
    },
  });
  if (res.statusCode !== 201) {
    throw new Error(`createGame failed: ${String(res.statusCode)} ${res.body}`);
  }
  return res.json<{ id: string }>().id;
}

async function createTournament(
  db: DbHandle,
  name: string,
  padelId: string,
): Promise<string> {
  const starts = new Date(Date.now() + 7 * ONE_DAY_MS);
  const ends = new Date(starts.getTime() + 6 * ONE_HOUR_MS);
  const row = await sql<{ id: string }>`
    INSERT INTO tournaments
      (name, sport_id, starts_at, ends_at, registration_deadline,
       max_squads, squad_size, entry_fee_minor, currency, status)
    VALUES
      (${name},
       ${padelId},
       ${starts.toISOString()},
       ${ends.toISOString()},
       ${new Date(starts.getTime() - ONE_HOUR_MS).toISOString()},
       8, 4, 0, 'AZN', 'registration_open')
    RETURNING id
  `.execute(db.db);
  return row.rows[0]!.id;
}

describe("search routes", () => {
  const env = buildTestEnv();
  let app: LinkfitServer;
  let db: DbHandle;
  let padelId: string;

  beforeAll(async () => {
    db = buildTestDb();
    app = await buildServer({ env, logger: pino({ level: "silent" }), db });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
    padelId = await getPadelSportId(db);
  });

  it("rejects an empty query with 400", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/search?q=" });
    expect(res.statusCode).toBe(400);
  });

  it("finds a player by display name (case-insensitive)", async () => {
    await createTestUser(app, { display_name: "Salam Aliyev" });
    await createTestUser(app, { display_name: "Some Other Name" });

    const res = await app.inject({ method: "GET", url: "/api/v1/search?q=salam" });
    expect(res.statusCode).toBe(200);
    const body = res.json<SearchBody>();
    expect(body.players.length).toBe(1);
    expect(body.players[0]!.display_name).toBe("Salam Aliyev");
  });

  it("returns each type in its own bucket when type=all", async () => {
    const host = await createTestUser(app, { display_name: "Padel Player" });
    await createGameWithNotes(app, host, padelId, "Friendly padel match near Sahil");
    await createTournament(db, "Padel Spring Cup", padelId);
    await seedBakuPadelVenues(db);

    const res = await app.inject({ method: "GET", url: "/api/v1/search?q=padel" });
    expect(res.statusCode).toBe(200);
    const body = res.json<SearchBody>();
    expect(body.players.length).toBeGreaterThanOrEqual(1);
    expect(body.games.length).toBeGreaterThanOrEqual(1);
    expect(body.tournaments.length).toBe(1);
    expect(body.tournaments[0]!.name).toBe("Padel Spring Cup");
    expect(body.venues.length).toBeGreaterThanOrEqual(3);
  });

  it("scopes results when type=venues", async () => {
    await createTestUser(app, { display_name: "Padel Fan" });
    await seedBakuPadelVenues(db);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/search?q=padel&type=venues",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<SearchBody>();
    expect(body.players.length).toBe(0);
    expect(body.games.length).toBe(0);
    expect(body.tournaments.length).toBe(0);
    expect(body.venues.length).toBeGreaterThanOrEqual(3);
  });

  it("escapes special LIKE characters so '%' does not match everything", async () => {
    await createTestUser(app, { display_name: "Alice" });
    await createTestUser(app, { display_name: "Bob" });

    // Two literal `%` (URL-encoded). The min(2) length floor means we can't
    // probe with a single `%`, but two `%` is still a pattern that without
    // escaping would degenerate to "match anything" — the assertion holds.
    const res = await app.inject({ method: "GET", url: "/api/v1/search?q=%25%25" });
    expect(res.statusCode).toBe(200);
    const body = res.json<SearchBody>();
    // A literal "%%" must match no users — without escaping it would match all.
    expect(body.players.length).toBe(0);
  });

  it("escapes the underscore wildcard", async () => {
    await createTestUser(app, { display_name: "Alice" });
    await createTestUser(app, { display_name: "Bob" });

    // Two underscores — same logic as the `%%` test above, sized to clear
    // the min-length floor.
    const res = await app.inject({ method: "GET", url: "/api/v1/search?q=__" });
    expect(res.statusCode).toBe(200);
    expect(res.json<SearchBody>().players.length).toBe(0);
  });

  it("rejects a single-character query with 400 (min length 2)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/search?q=a" });
    expect(res.statusCode).toBe(400);
  });

  it("respects the limit parameter", async () => {
    for (let i = 0; i < 5; i += 1) {
      await createTestUser(app, { display_name: `Eko Player ${String(i)}` });
    }
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/search?q=eko&type=players&limit=2",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<SearchBody>().players.length).toBe(2);
  });

  it("searches game notes substring", async () => {
    const host = await createTestUser(app);
    await createGameWithNotes(app, host, padelId, "Looking for two more — beginners welcome");

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/search?q=beginners&type=games",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<SearchBody>();
    expect(body.games.length).toBe(1);
    expect(body.games[0]!.notes).toContain("beginners");
  });

  it("searches venue address", async () => {
    await seedBakuPadelVenues(db);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/search?q=Khirdalan&type=venues",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<SearchBody>();
    expect(body.venues.length).toBeGreaterThanOrEqual(1);
    expect(body.venues.some((v) => /Khirdalan/i.test(v.address))).toBe(true);
  });

  it("returns an empty bucket when nothing matches", async () => {
    await createTestUser(app, { display_name: "Alice" });
    const res = await app.inject({ method: "GET", url: "/api/v1/search?q=zzzzqqxx" });
    expect(res.statusCode).toBe(200);
    const body = res.json<SearchBody>();
    expect(body.players.length).toBe(0);
    expect(body.games.length).toBe(0);
    expect(body.tournaments.length).toBe(0);
    expect(body.venues.length).toBe(0);
  });
});
