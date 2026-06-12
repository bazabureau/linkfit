import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import { buildServer, type LinkfitServer } from "../../shared/http/server.js";
import { buildTestDb } from "../../../tests/helpers/db.js";
import { buildTestEnv } from "../../../tests/helpers/env.js";
import {
  createTestUser,
  truncateAll,
  type TestUser,
} from "../../../tests/helpers/fixtures.js";
import { type DbHandle } from "../../shared/db/pool.js";
import { sql } from "kysely";

const ONE_HOUR_MS = 60 * 60 * 1000;

interface GameDetailBody {
  id: string;
  host_user_id: string;
  status: string;
}

async function getPadelSportId(db: DbHandle): Promise<string> {
  const row = await db.db
    .selectFrom("sports")
    .select("id")
    .where("slug", "=", "padel")
    .executeTakeFirstOrThrow();
  return row.id;
}

/**
 * Host self-delete is a thin wrapper around the existing soft-delete column.
 * The tests verify:
 *   - host can delete their own game (204)
 *   - non-host cannot (403)
 *   - deleted game disappears from list / detail (404)
 *   - DB row sticks around with deleted_at populated
 *   - double-delete returns 404 (idempotent-ish from the user's POV)
 */
describe("DELETE /api/v1/games/:id (host self-delete)", () => {
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

  async function createGame(host: TestUser): Promise<GameDetailBody> {
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
      },
    });
    if (res.statusCode !== 201) {
      throw new Error(`createGame: ${String(res.statusCode)} ${res.body}`);
    }
    return res.json<GameDetailBody>();
  }

  it("returns 204 and soft-deletes the game when called by the host", async () => {
    const host = await createTestUser(app);
    const game = await createGame(host);

    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/games/${game.id}`,
      headers: { authorization: `Bearer ${host.access_token}` },
    });
    expect(del.statusCode).toBe(204);

    // Row still in DB, but with deleted_at populated.
    const row = await sql<{ deleted_at: Date | null }>`
      SELECT deleted_at FROM games WHERE id = ${game.id}
    `.execute(db.db);
    expect(row.rows[0]?.deleted_at).not.toBeNull();
  });

  it("removes the game from public listing and detail after delete", async () => {
    const host = await createTestUser(app);
    const game = await createGame(host);

    await app.inject({
      method: "DELETE",
      url: `/api/v1/games/${game.id}`,
      headers: { authorization: `Bearer ${host.access_token}` },
    });

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/games/${game.id}`,
    });
    expect(detail.statusCode).toBe(404);

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/games?lat=40.4093&lng=49.8671&radius_km=10",
    });
    expect(list.statusCode).toBe(200);
    const items = (list.json<{ items: { id: string }[] }>().items);
    expect(items.find((g) => g.id === game.id)).toBeUndefined();
  });

  it("returns 403 when a non-host tries to delete", async () => {
    const host = await createTestUser(app);
    const intruder = await createTestUser(app);
    const game = await createGame(host);

    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/games/${game.id}`,
      headers: { authorization: `Bearer ${intruder.access_token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 when unauthenticated", async () => {
    const host = await createTestUser(app);
    const game = await createGame(host);
    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/games/${game.id}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 404 on a second delete (idempotent from caller's perspective)", async () => {
    const host = await createTestUser(app);
    const game = await createGame(host);

    const first = await app.inject({
      method: "DELETE",
      url: `/api/v1/games/${game.id}`,
      headers: { authorization: `Bearer ${host.access_token}` },
    });
    expect(first.statusCode).toBe(204);

    const second = await app.inject({
      method: "DELETE",
      url: `/api/v1/games/${game.id}`,
      headers: { authorization: `Bearer ${host.access_token}` },
    });
    expect(second.statusCode).toBe(404);
  });

  it("returns 404 when game id does not exist", async () => {
    const host = await createTestUser(app);
    const res = await app.inject({
      method: "DELETE",
      url: "/api/v1/games/00000000-0000-0000-0000-000000000000",
      headers: { authorization: `Bearer ${host.access_token}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
