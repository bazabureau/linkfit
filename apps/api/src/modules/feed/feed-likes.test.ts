import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import { buildServer, type LinkfitServer } from "../../shared/http/server.js";
import { buildTestDb } from "../../../tests/helpers/db.js";
import { buildTestEnv } from "../../../tests/helpers/env.js";
import { createTestUser, truncateAll } from "../../../tests/helpers/fixtures.js";
import { type DbHandle } from "../../shared/db/pool.js";
import { FeedService } from "./feed.service.js";

interface LikeBody {
  likes_count: number;
}

interface FeedEventBody {
  id: string;
  likes_count: number;
  liked_by_me: boolean;
}

interface FeedPageBody {
  items: FeedEventBody[];
}

/**
 * Likes are exercised on real feed events created via `feedService.emit`.
 * The emit path is the same one the worker uses, so testing through it
 * keeps the surface honest — we never hit a synthetic row that production
 * code wouldn't produce.
 */
describe("feed likes", () => {
  const env = buildTestEnv();
  let app: LinkfitServer;
  let db: DbHandle;
  let feedService: FeedService;

  beforeAll(async () => {
    db = buildTestDb();
    app = await buildServer({ env, logger: pino({ level: "silent" }), db });
    await app.ready();
    feedService = new FeedService({ db });
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
  });

  async function emitEventFor(userId: string): Promise<string> {
    await feedService.emit({
      actorUserId: userId,
      type: "joined_game",
      visibility: "public",
      payload: { game_id: "11111111-1111-1111-1111-111111111111", sport_slug: "padel" },
    });
    const row = await db.db
      .selectFrom("feed_events")
      .select("id")
      .where("actor_user_id", "=", userId)
      .executeTakeFirstOrThrow();
    return row.id;
  }

  it("increments likes_count and flips liked_by_me on POST /like", async () => {
    const alice = await createTestUser(app, { display_name: "Alice" });
    const eventId = await emitEventFor(alice.id);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/feed/${eventId}/like`,
      headers: { authorization: `Bearer ${alice.access_token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<LikeBody>().likes_count).toBe(1);

    // Verify the next /feed read reflects the like.
    const feed = await app.inject({
      method: "GET",
      url: "/api/v1/feed",
      headers: { authorization: `Bearer ${alice.access_token}` },
    });
    const item = feed.json<FeedPageBody>().items[0];
    expect(item?.likes_count).toBe(1);
    expect(item?.liked_by_me).toBe(true);
  });

  it("double-tap is idempotent (still 1 like, 200 OK both times)", async () => {
    const alice = await createTestUser(app);
    const eventId = await emitEventFor(alice.id);

    for (let i = 0; i < 2; i++) {
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/feed/${eventId}/like`,
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<LikeBody>().likes_count).toBe(1);
    }
  });

  it("DELETE /like removes the like and is idempotent on a non-liked event", async () => {
    const alice = await createTestUser(app);
    const eventId = await emitEventFor(alice.id);

    // Like, then unlike.
    await app.inject({
      method: "POST",
      url: `/api/v1/feed/${eventId}/like`,
      headers: { authorization: `Bearer ${alice.access_token}` },
    });
    const unlike = await app.inject({
      method: "DELETE",
      url: `/api/v1/feed/${eventId}/like`,
      headers: { authorization: `Bearer ${alice.access_token}` },
    });
    expect(unlike.statusCode).toBe(200);
    expect(unlike.json<LikeBody>().likes_count).toBe(0);

    // Second unlike is also 200 with count 0 — idempotent.
    const noop = await app.inject({
      method: "DELETE",
      url: `/api/v1/feed/${eventId}/like`,
      headers: { authorization: `Bearer ${alice.access_token}` },
    });
    expect(noop.statusCode).toBe(200);
    expect(noop.json<LikeBody>().likes_count).toBe(0);
  });

  it("aggregates likes across multiple users on the same event", async () => {
    const alice = await createTestUser(app);
    const bob = await createTestUser(app);
    const eventId = await emitEventFor(alice.id);

    await app.inject({
      method: "POST",
      url: `/api/v1/feed/${eventId}/like`,
      headers: { authorization: `Bearer ${alice.access_token}` },
    });
    const second = await app.inject({
      method: "POST",
      url: `/api/v1/feed/${eventId}/like`,
      headers: { authorization: `Bearer ${bob.access_token}` },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json<LikeBody>().likes_count).toBe(2);

    // Bob's view: liked_by_me = true; Alice's view also true. Both see count=2.
    const bobFeed = await app.inject({
      method: "GET",
      url: "/api/v1/feed",
      headers: { authorization: `Bearer ${bob.access_token}` },
    });
    const item = bobFeed.json<FeedPageBody>().items[0];
    expect(item?.likes_count).toBe(2);
    expect(item?.liked_by_me).toBe(true);
  });

  it("returns 400 when the feed event does not exist", async () => {
    const alice = await createTestUser(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/feed/00000000-0000-0000-0000-000000000000/like",
      headers: { authorization: `Bearer ${alice.access_token}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects unauthenticated like/unlike", async () => {
    const fakeId = "11111111-1111-1111-1111-111111111111";
    const post = await app.inject({
      method: "POST",
      url: `/api/v1/feed/${fakeId}/like`,
    });
    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/feed/${fakeId}/like`,
    });
    expect(post.statusCode).toBe(401);
    expect(del.statusCode).toBe(401);
  });
});
