import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import { sql } from "kysely";
import { buildServer, type LinkfitServer } from "../../shared/http/server.js";
import { buildTestDb } from "../../../tests/helpers/db.js";
import { buildTestEnv } from "../../../tests/helpers/env.js";
import { createTestUser, truncateAll } from "../../../tests/helpers/fixtures.js";
import { type DbHandle } from "../../shared/db/pool.js";
import { FeedService } from "../feed/feed.service.js";

interface CommentBody {
  id: string;
  user_id: string;
  user_display_name: string;
  user_avatar_url: string | null;
  body: string;
  created_at: string;
}

interface CommentsPageBody {
  comments: CommentBody[];
  next_cursor: string | null;
  total: number;
}

/**
 * Integration tests for the feed-comments routes.
 *
 * Comments are exercised against real feed events created via
 * `feedService.emit` — the same path the worker uses in production. That
 * keeps the surface honest: we never assert against a synthetic row that
 * the rest of the stack wouldn't produce.
 *
 * We cover:
 *   - happy-path POST (returns the persisted shape; second GET sees it)
 *   - keyset pagination on GET (newest-first, next_cursor flips when full)
 *   - DELETE auth (author OK, event actor OK, third party forbidden,
 *     missing comment 404, unauthenticated 401)
 *   - block guard on POST (commenter and actor blocked → 403)
 */
describe("feed comments", () => {
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

  // ============================================================
  // Happy-path POST
  // ============================================================
  it("POST creates a comment, returns the hydrated shape, GET sees it", async () => {
    const alice = await createTestUser(app, { display_name: "Alice" });
    const bob = await createTestUser(app, { display_name: "Bob" });
    const eventId = await emitEventFor(alice.id);

    const post = await app.inject({
      method: "POST",
      url: `/api/v1/feed/${eventId}/comments`,
      headers: { authorization: `Bearer ${bob.access_token}` },
      payload: { body: "Nice game!" },
    });
    expect(post.statusCode).toBe(201);
    const created = post.json<CommentBody>();
    expect(created.body).toBe("Nice game!");
    expect(created.user_id).toBe(bob.id);
    expect(created.user_display_name).toBe("Bob");
    expect(typeof created.id).toBe("string");
    expect(typeof created.created_at).toBe("string");

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/feed/${eventId}/comments`,
      headers: { authorization: `Bearer ${alice.access_token}` },
    });
    expect(list.statusCode).toBe(200);
    const page = list.json<CommentsPageBody>();
    expect(page.total).toBe(1);
    expect(page.comments).toHaveLength(1);
    expect(page.comments[0]?.id).toBe(created.id);
    expect(page.next_cursor).toBeNull();

    const notification = await db.db
      .selectFrom("notifications")
      .select(["type", "title", "body", "payload"])
      .where("user_id", "=", alice.id)
      .executeTakeFirstOrThrow();
    expect(notification.type).toBe("system");
    expect(notification.title).toBe("Bob");
    expect(notification.body).toBe("Nice game!");
    expect(notification.payload).toMatchObject({
      kind: "feed:comment",
      entity_id: eventId,
      event_id: eventId,
      comment_id: created.id,
      commenter_user_id: bob.id,
    });
  });

  it("POST trims whitespace and rejects empty / oversized bodies", async () => {
    const alice = await createTestUser(app);
    const eventId = await emitEventFor(alice.id);

    // Trim turns "  " into "" → 400 from Zod.
    const empty = await app.inject({
      method: "POST",
      url: `/api/v1/feed/${eventId}/comments`,
      headers: { authorization: `Bearer ${alice.access_token}` },
      payload: { body: "   " },
    });
    expect(empty.statusCode).toBe(400);

    const oversized = await app.inject({
      method: "POST",
      url: `/api/v1/feed/${eventId}/comments`,
      headers: { authorization: `Bearer ${alice.access_token}` },
      payload: { body: "x".repeat(501) },
    });
    expect(oversized.statusCode).toBe(400);
  });

  it("POST requires auth", async () => {
    const alice = await createTestUser(app);
    const eventId = await emitEventFor(alice.id);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/feed/${eventId}/comments`,
      payload: { body: "hi" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST returns 404 for a missing event", async () => {
    const alice = await createTestUser(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/feed/00000000-0000-0000-0000-000000000000/comments",
      headers: { authorization: `Bearer ${alice.access_token}` },
      payload: { body: "hi" },
    });
    expect(res.statusCode).toBe(404);
  });

  // ============================================================
  // GET pagination
  // ============================================================
  it("GET paginates newest-first with cursor + limit; total is invariant", async () => {
    const alice = await createTestUser(app);
    const bob = await createTestUser(app, { display_name: "Bob" });
    const eventId = await emitEventFor(alice.id);

    // 5 comments by bob. We post sequentially so timestamps stay strictly
    // increasing — that keeps the newest-first ordering deterministic.
    const created: string[] = [];
    for (let i = 0; i < 5; i++) {
      const post = await app.inject({
        method: "POST",
        url: `/api/v1/feed/${eventId}/comments`,
        headers: { authorization: `Bearer ${bob.access_token}` },
        payload: { body: `comment-${String(i)}` },
      });
      expect(post.statusCode).toBe(201);
      created.push(post.json<CommentBody>().id);
      // Tiny pause to widen the created_at gap; Postgres has microsecond
      // precision but back-to-back inserts can still tie on busy CI.
      await new Promise((r) => setTimeout(r, 5));
    }

    // First page: limit=2 → newest two, next_cursor populated.
    const p1 = await app.inject({
      method: "GET",
      url: `/api/v1/feed/${eventId}/comments?limit=2`,
      headers: { authorization: `Bearer ${alice.access_token}` },
    });
    expect(p1.statusCode).toBe(200);
    const page1 = p1.json<CommentsPageBody>();
    expect(page1.total).toBe(5);
    expect(page1.comments).toHaveLength(2);
    expect(page1.comments[0]?.body).toBe("comment-4");
    expect(page1.comments[1]?.body).toBe("comment-3");
    expect(page1.next_cursor).not.toBeNull();

    // Second page.
    const p2 = await app.inject({
      method: "GET",
      url: `/api/v1/feed/${eventId}/comments?limit=2&cursor=${encodeURIComponent(page1.next_cursor ?? "")}`,
      headers: { authorization: `Bearer ${alice.access_token}` },
    });
    expect(p2.statusCode).toBe(200);
    const page2 = p2.json<CommentsPageBody>();
    expect(page2.total).toBe(5);
    expect(page2.comments).toHaveLength(2);
    expect(page2.comments[0]?.body).toBe("comment-2");
    expect(page2.comments[1]?.body).toBe("comment-1");
    expect(page2.next_cursor).not.toBeNull();

    // Final page.
    const p3 = await app.inject({
      method: "GET",
      url: `/api/v1/feed/${eventId}/comments?limit=2&cursor=${encodeURIComponent(page2.next_cursor ?? "")}`,
      headers: { authorization: `Bearer ${alice.access_token}` },
    });
    expect(p3.statusCode).toBe(200);
    const page3 = p3.json<CommentsPageBody>();
    expect(page3.comments).toHaveLength(1);
    expect(page3.comments[0]?.body).toBe("comment-0");
    expect(page3.next_cursor).toBeNull();
  });

  it("GET rejects a malformed cursor with 400", async () => {
    const alice = await createTestUser(app);
    const eventId = await emitEventFor(alice.id);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/feed/${eventId}/comments?cursor=not-base64url`,
      headers: { authorization: `Bearer ${alice.access_token}` },
    });
    expect(res.statusCode).toBe(400);
  });

  // ============================================================
  // DELETE auth
  // ============================================================
  it("DELETE — author can delete their own comment", async () => {
    const alice = await createTestUser(app);
    const bob = await createTestUser(app);
    const eventId = await emitEventFor(alice.id);

    const post = await app.inject({
      method: "POST",
      url: `/api/v1/feed/${eventId}/comments`,
      headers: { authorization: `Bearer ${bob.access_token}` },
      payload: { body: "by bob" },
    });
    const commentId = post.json<CommentBody>().id;

    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/feed/comments/${commentId}`,
      headers: { authorization: `Bearer ${bob.access_token}` },
    });
    expect(del.statusCode).toBe(204);

    // Verify the row is gone.
    const list = await app.inject({
      method: "GET",
      url: `/api/v1/feed/${eventId}/comments`,
      headers: { authorization: `Bearer ${alice.access_token}` },
    });
    expect(list.json<CommentsPageBody>().total).toBe(0);
  });

  it("DELETE — event actor can moderate-delete a third party's comment", async () => {
    const alice = await createTestUser(app);
    const bob = await createTestUser(app);
    const eventId = await emitEventFor(alice.id);

    const post = await app.inject({
      method: "POST",
      url: `/api/v1/feed/${eventId}/comments`,
      headers: { authorization: `Bearer ${bob.access_token}` },
      payload: { body: "by bob" },
    });
    const commentId = post.json<CommentBody>().id;

    // Alice owns the event, so she can delete Bob's comment.
    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/feed/comments/${commentId}`,
      headers: { authorization: `Bearer ${alice.access_token}` },
    });
    expect(del.statusCode).toBe(204);
  });

  it("DELETE — unrelated user gets 403", async () => {
    const alice = await createTestUser(app);
    const bob = await createTestUser(app);
    const carol = await createTestUser(app);
    const eventId = await emitEventFor(alice.id);

    const post = await app.inject({
      method: "POST",
      url: `/api/v1/feed/${eventId}/comments`,
      headers: { authorization: `Bearer ${bob.access_token}` },
      payload: { body: "by bob" },
    });
    const commentId = post.json<CommentBody>().id;

    // Carol is neither the author (bob) nor the event actor (alice).
    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/feed/comments/${commentId}`,
      headers: { authorization: `Bearer ${carol.access_token}` },
    });
    expect(del.statusCode).toBe(403);
  });

  it("DELETE — missing comment is 404", async () => {
    const alice = await createTestUser(app);
    const res = await app.inject({
      method: "DELETE",
      url: "/api/v1/feed/comments/00000000-0000-0000-0000-000000000000",
      headers: { authorization: `Bearer ${alice.access_token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("DELETE — unauthenticated is 401", async () => {
    const fakeId = "11111111-1111-1111-1111-111111111111";
    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/feed/comments/${fakeId}`,
    });
    expect(res.statusCode).toBe(401);
  });

  // ============================================================
  // Block guard
  // ============================================================
  it("POST — bidirectional block guard returns 403", async () => {
    const alice = await createTestUser(app);
    const bob = await createTestUser(app);
    const eventId = await emitEventFor(alice.id);

    // Alice blocks Bob → Bob can't comment on Alice's events.
    await sql`
      INSERT INTO user_blocks (blocker_user_id, blocked_user_id)
      VALUES (${alice.id}::uuid, ${bob.id}::uuid)
    `.execute(db.db);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/feed/${eventId}/comments`,
      headers: { authorization: `Bearer ${bob.access_token}` },
      payload: { body: "hello" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST — self-comment by event actor is allowed", async () => {
    const alice = await createTestUser(app);
    const eventId = await emitEventFor(alice.id);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/feed/${eventId}/comments`,
      headers: { authorization: `Bearer ${alice.access_token}` },
      payload: { body: "my own card" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<CommentBody>().user_id).toBe(alice.id);
  });
});
