import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import { sql } from "kysely";
import { buildServer, type LinkfitServer } from "../../shared/http/server.js";
import { buildTestDb } from "../../../tests/helpers/db.js";
import { buildTestEnv } from "../../../tests/helpers/env.js";
import { createTestUser, truncateAll } from "../../../tests/helpers/fixtures.js";
import { type DbHandle } from "../../shared/db/pool.js";
import { FeedService } from "./feed.service.js";

interface FeedActor {
  id: string;
  display_name: string;
  photo_url: string | null;
}

interface FeedEventBody {
  id: string;
  type: string;
  actor: FeedActor;
  payload: Record<string, unknown>;
  visibility: string;
  created_at: string;
}

interface FeedPageBody {
  items: FeedEventBody[];
  next_cursor: string | null;
}

/**
 * The feed worker reads from real source tables — but driving it via the
 * games / ratings / tournaments services adds a lot of test setup noise.
 * For the integration suite we exercise the SERVICE layer (`FeedService`)
 * directly, which is also what the worker calls. That keeps the read-path
 * tests (the most important contract) tight and deterministic.
 */
describe("feed routes", () => {
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

  it("returns an empty page when the user has no follows or events", async () => {
    const alice = await createTestUser(app, { display_name: "Alice" });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/feed",
      headers: { authorization: `Bearer ${alice.access_token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<FeedPageBody>();
    expect(body.items).toEqual([]);
    expect(body.next_cursor).toBeNull();
  });

  it("serves the public-only feed to unauthenticated callers", async () => {
    // The list route is soft-auth: anonymous callers see only events with
    // visibility = 'public' (no follows or self resolution applies), with
    // `liked_by_me` forced to false. This is the contract that lets the
    // same endpoint power both the signed-in home feed and the public
    // discovery view.
    const stranger = await createTestUser(app, { display_name: "Stranger" });
    await feedService.emit({
      actorUserId: stranger.id,
      type: "elo_milestone",
      payload: { elo_rating: 1500 },
      visibility: "public",
    });
    await feedService.emit({
      actorUserId: stranger.id,
      type: "joined_game",
      payload: { game_id: "44444444-4444-4444-4444-444444444444" },
      visibility: "followers",
    });

    const res = await app.inject({ method: "GET", url: "/api/v1/feed" });
    expect(res.statusCode).toBe(200);
    const body = res.json<FeedPageBody>();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.visibility).toBe("public");
  });

  it("only surfaces events from people the viewer follows (plus self)", async () => {
    const alice = await createTestUser(app, { display_name: "Alice" });
    const bob = await createTestUser(app, { display_name: "Bob" });
    const carol = await createTestUser(app, { display_name: "Carol" });

    // Alice follows Bob only.
    await app.inject({
      method: "POST",
      url: `/api/v1/users/${bob.id}/follow`,
      headers: { authorization: `Bearer ${alice.access_token}` },
    });

    await feedService.emit({
      actorUserId: bob.id,
      type: "joined_game",
      payload: { game_id: "11111111-1111-1111-1111-111111111111", sport_slug: "padel" },
    });
    await feedService.emit({
      actorUserId: carol.id,
      type: "joined_game",
      payload: { game_id: "22222222-2222-2222-2222-222222222222", sport_slug: "padel" },
    });
    await feedService.emit({
      actorUserId: alice.id,
      type: "won_match",
      payload: { game_id: "33333333-3333-3333-3333-333333333333" },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/feed",
      headers: { authorization: `Bearer ${alice.access_token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<FeedPageBody>();

    const actorIds = body.items.map((e) => e.actor.id).sort();
    // Bob (followed) + Alice (self); Carol is NOT followed and should be absent.
    expect(actorIds).toEqual([alice.id, bob.id].sort());
  });

  it("paginates newest-first using opaque cursors", async () => {
    const alice = await createTestUser(app);

    // Emit five self-events with distinct timestamps. We commit them
    // sequentially so created_at ordering is well-defined.
    for (let i = 0; i < 5; i++) {
      await feedService.emit({
        actorUserId: alice.id,
        type: "joined_game",
        payload: { game_id: `id-${String(i)}`, idx: i },
        sourceKey: `t-${String(i)}`,
      });
      // Tiny sleep to guarantee monotonic created_at on fast hardware.
      await new Promise((r) => setTimeout(r, 5));
    }

    // First page, limit=2.
    const p1 = await app.inject({
      method: "GET",
      url: "/api/v1/feed?limit=2",
      headers: { authorization: `Bearer ${alice.access_token}` },
    });
    expect(p1.statusCode).toBe(200);
    const body1 = p1.json<FeedPageBody>();
    expect(body1.items).toHaveLength(2);
    expect(body1.next_cursor).not.toBeNull();
    // Newest first → idx 4 then idx 3.
    expect(body1.items.map((e) => e.payload.idx)).toEqual([4, 3]);

    // Second page using the cursor.
    const p2 = await app.inject({
      method: "GET",
      url: `/api/v1/feed?limit=2&cursor=${encodeURIComponent(body1.next_cursor ?? "")}`,
      headers: { authorization: `Bearer ${alice.access_token}` },
    });
    expect(p2.statusCode).toBe(200);
    const body2 = p2.json<FeedPageBody>();
    expect(body2.items).toHaveLength(2);
    expect(body2.items.map((e) => e.payload.idx)).toEqual([2, 1]);
    expect(body2.next_cursor).not.toBeNull();

    // Third page picks up the last row and ends the cursor.
    const p3 = await app.inject({
      method: "GET",
      url: `/api/v1/feed?limit=2&cursor=${encodeURIComponent(body2.next_cursor ?? "")}`,
      headers: { authorization: `Bearer ${alice.access_token}` },
    });
    expect(p3.statusCode).toBe(200);
    const body3 = p3.json<FeedPageBody>();
    expect(body3.items).toHaveLength(1);
    expect(body3.items[0]?.payload.idx).toBe(0);
    expect(body3.next_cursor).toBeNull();
  });

  it("hides private events from non-self callers, even when followed", async () => {
    const alice = await createTestUser(app);
    const bob = await createTestUser(app);

    await app.inject({
      method: "POST",
      url: `/api/v1/users/${bob.id}/follow`,
      headers: { authorization: `Bearer ${alice.access_token}` },
    });

    // Bob emits two events, one public/followers-default, one private.
    await feedService.emit({
      actorUserId: bob.id,
      type: "won_match",
      payload: { game_id: "g-public" },
    });
    await feedService.emit({
      actorUserId: bob.id,
      type: "elo_milestone",
      payload: { elo_rating: 1400 },
      visibility: "private",
    });

    // Alice sees only the non-private one.
    const aliceRes = await app.inject({
      method: "GET",
      url: "/api/v1/feed",
      headers: { authorization: `Bearer ${alice.access_token}` },
    });
    const aliceBody = aliceRes.json<FeedPageBody>();
    expect(aliceBody.items).toHaveLength(1);
    expect(aliceBody.items[0]?.type).toBe("won_match");

    // Bob sees both — the private one is still his.
    const bobRes = await app.inject({
      method: "GET",
      url: "/api/v1/feed",
      headers: { authorization: `Bearer ${bob.access_token}` },
    });
    const bobBody = bobRes.json<FeedPageBody>();
    expect(bobBody.items.map((e) => e.type).sort()).toEqual([
      "elo_milestone",
      "won_match",
    ]);
  });

  it("public events are visible even to callers who don't follow the actor", async () => {
    const alice = await createTestUser(app);
    const stranger = await createTestUser(app);

    await feedService.emit({
      actorUserId: stranger.id,
      type: "elo_milestone",
      payload: { elo_rating: 1500 },
      visibility: "public",
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/feed",
      headers: { authorization: `Bearer ${alice.access_token}` },
    });
    const body = res.json<FeedPageBody>();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.actor.id).toBe(stranger.id);
    expect(body.items[0]?.visibility).toBe("public");
  });

  it("dedupes emits sharing a source_key", async () => {
    const alice = await createTestUser(app);

    for (const _ of [1, 2, 3]) {
      await feedService.emit({
        actorUserId: alice.id,
        type: "joined_game",
        payload: { game_id: "g-1" },
        sourceKey: "gp:g-1:alice",
      });
    }

    const count = await sql<{ c: string }>`
      SELECT count(*)::text AS c FROM feed_events
       WHERE actor_user_id = ${alice.id}
    `.execute(db.db);
    expect(Number(count.rows[0]?.c ?? "0")).toBe(1);
  });

  it("rejects malformed cursors with a 400", async () => {
    const alice = await createTestUser(app);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/feed?cursor=not-a-real-cursor",
      headers: { authorization: `Bearer ${alice.access_token}` },
    });
    expect(res.statusCode).toBe(400);
  });
});
