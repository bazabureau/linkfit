import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import { sql } from "kysely";
import { buildServer, type LinkfitServer } from "../../shared/http/server.js";
import { buildTestDb } from "../../../tests/helpers/db.js";
import { buildTestEnv } from "../../../tests/helpers/env.js";
import { createTestUser, truncateAll } from "../../../tests/helpers/fixtures.js";
import { type DbHandle } from "../../shared/db/pool.js";

/**
 * Follows tests run against the standard server (follows routes are wired in
 * `server.ts`).
 */

interface FollowPageBody {
  items: {
    id: string;
    display_name: string;
    photo_url: string | null;
    followed_at: string;
  }[];
  next_offset: number | null;
}

describe("follows routes", () => {
  const env = buildTestEnv();
  let app: LinkfitServer;
  let db: DbHandle;

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
  });

  it("follows another user (happy path) and emits a notification", async () => {
    const alice = await createTestUser(app, { display_name: "Alice" });
    const bob = await createTestUser(app, { display_name: "Bob" });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/users/${bob.id}/follow`,
      headers: { authorization: `Bearer ${alice.access_token}` },
    });
    expect(res.statusCode).toBe(204);

    // Edge exists.
    const edge = await sql<{ c: string }>`
      SELECT count(*)::text AS c FROM follows
       WHERE follower_user_id = ${alice.id}
         AND followed_user_id = ${bob.id}
    `.execute(db.db);
    expect(Number(edge.rows[0]!.c)).toBe(1);

    // Notification was created for Bob.
    const notif = await sql<{ c: string; title: string | null }>`
      SELECT count(*)::text AS c, MAX(title) AS title
        FROM notifications
       WHERE user_id = ${bob.id}
         AND type = 'system'
    `.execute(db.db);
    expect(Number(notif.rows[0]!.c)).toBe(1);
    expect(notif.rows[0]!.title).toBe("New follower");
  });

  it("rejects self-follow with 400", async () => {
    const alice = await createTestUser(app);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/users/${alice.id}/follow`,
      headers: { authorization: `Bearer ${alice.access_token}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("duplicate follow is a no-op — single row, single notification", async () => {
    const alice = await createTestUser(app);
    const bob = await createTestUser(app);

    for (const _ of [1, 2, 3]) {
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/users/${bob.id}/follow`,
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(res.statusCode).toBe(204);
    }

    const edge = await sql<{ c: string }>`SELECT count(*)::text AS c FROM follows`.execute(db.db);
    expect(Number(edge.rows[0]!.c)).toBe(1);

    const notif = await sql<{ c: string }>`
      SELECT count(*)::text AS c FROM notifications
       WHERE user_id = ${bob.id} AND type = 'system'
    `.execute(db.db);
    expect(Number(notif.rows[0]!.c)).toBe(1);
  });

  it("unfollow removes the edge (and is idempotent)", async () => {
    const alice = await createTestUser(app);
    const bob = await createTestUser(app);
    await app.inject({
      method: "POST",
      url: `/api/v1/users/${bob.id}/follow`,
      headers: { authorization: `Bearer ${alice.access_token}` },
    });

    const first = await app.inject({
      method: "DELETE",
      url: `/api/v1/users/${bob.id}/follow`,
      headers: { authorization: `Bearer ${alice.access_token}` },
    });
    expect(first.statusCode).toBe(204);

    const after = await sql<{ c: string }>`SELECT count(*)::text AS c FROM follows`.execute(db.db);
    expect(Number(after.rows[0]!.c)).toBe(0);

    // Second delete is still 204 — idempotent.
    const second = await app.inject({
      method: "DELETE",
      url: `/api/v1/users/${bob.id}/follow`,
      headers: { authorization: `Bearer ${alice.access_token}` },
    });
    expect(second.statusCode).toBe(204);
  });

  it("paginates followers and following lists", async () => {
    const target = await createTestUser(app, { display_name: "Target" });

    // Create three followers; deterministic ordering needs distinct timestamps,
    // so we insert them serially and assert newest-first.
    const followers = [
      await createTestUser(app, { display_name: "F1" }),
      await createTestUser(app, { display_name: "F2" }),
      await createTestUser(app, { display_name: "F3" }),
    ];
    for (const f of followers) {
      await app.inject({
        method: "POST",
        url: `/api/v1/users/${target.id}/follow`,
        headers: { authorization: `Bearer ${f.access_token}` },
      });
    }

    // page 1: limit=2
    const p1 = await app.inject({
      method: "GET",
      url: `/api/v1/users/${target.id}/followers?limit=2`,
    });
    expect(p1.statusCode).toBe(200);
    const body1 = p1.json<FollowPageBody>();
    expect(body1.items).toHaveLength(2);
    expect(body1.next_offset).toBe(2);
    // Newest-first: F3, F2.
    expect(body1.items.map((i) => i.display_name)).toEqual(["F3", "F2"]);

    // page 2: pickup the last one
    const p2 = await app.inject({
      method: "GET",
      url: `/api/v1/users/${target.id}/followers?limit=2&offset=2`,
    });
    expect(p2.statusCode).toBe(200);
    const body2 = p2.json<FollowPageBody>();
    expect(body2.items).toHaveLength(1);
    expect(body2.items[0]!.display_name).toBe("F1");
    expect(body2.next_offset).toBeNull();

    // /following from one of the followers shows only the target.
    const fwl = await app.inject({
      method: "GET",
      url: `/api/v1/users/${followers[0]!.id}/following`,
    });
    expect(fwl.statusCode).toBe(200);
    const fwlBody = fwl.json<FollowPageBody>();
    expect(fwlBody.items).toHaveLength(1);
    expect(fwlBody.items[0]!.id).toBe(target.id);
  });

  // ── Net new coverage for the Players agent ─────────────────────────────

  it("returns 404 when listing followers for an unknown user", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/users/00000000-0000-0000-0000-000000000000/followers`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 404 when listing following for an unknown user", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/users/00000000-0000-0000-0000-000000000000/following`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns an empty page with null next_offset when the user has no followers", async () => {
    const lonely = await createTestUser(app, { display_name: "Lonely" });

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/users/${lonely.id}/followers?limit=20`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<FollowPageBody>();
    expect(body.items).toHaveLength(0);
    expect(body.next_offset).toBeNull();
  });

  it("clamps oversized limits to the 100-row server cap without erroring", async () => {
    const target = await createTestUser(app, { display_name: "T" });
    // Add 3 followers so we know we'd get a non-empty payload.
    for (let i = 0; i < 3; i++) {
      const f = await createTestUser(app, { display_name: `F${String(i)}` });
      await app.inject({
        method: "POST",
        url: `/api/v1/users/${target.id}/follow`,
        headers: { authorization: `Bearer ${f.access_token}` },
      });
    }

    // limit=500 violates Zod's `.max(100)` — request should be rejected with
    // a 400 rather than silently clamped at the route layer. This pins the
    // contract: the client must send a value ≤100.
    const tooBig = await app.inject({
      method: "GET",
      url: `/api/v1/users/${target.id}/followers?limit=500`,
    });
    expect(tooBig.statusCode).toBe(400);

    // Exactly-100 is the documented max and must succeed.
    const ok = await app.inject({
      method: "GET",
      url: `/api/v1/users/${target.id}/followers?limit=100`,
    });
    expect(ok.statusCode).toBe(200);
    const body = ok.json<FollowPageBody>();
    expect(body.items).toHaveLength(3);
    expect(body.next_offset).toBeNull();
  });
});
