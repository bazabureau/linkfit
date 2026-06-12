import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import { sql } from "kysely";
import { buildServer, type LinkfitServer } from "../../shared/http/server.js";
import { buildTestDb } from "../../../tests/helpers/db.js";
import { buildTestEnv } from "../../../tests/helpers/env.js";
import { createTestUser, truncateAll } from "../../../tests/helpers/fixtures.js";
import { type DbHandle } from "../../shared/db/pool.js";

interface DeviceTokenBody {
  id: string;
  token: string;
  platform: "ios" | "android";
  last_seen: string;
  created_at: string;
}

describe("push device-tokens routes", () => {
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

  it("registers a new APNs device token for the authenticated user", async () => {
    const alice = await createTestUser(app);
    const token = "a".repeat(64); // 64-char hex stand-in
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/me/devices",
      headers: { authorization: `Bearer ${alice.access_token}` },
      payload: { token, platform: "ios" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<DeviceTokenBody>();
    expect(body.platform).toBe("ios");
    expect(body.token).toBe(token);

    const row = await sql<{ c: string }>`
      SELECT count(*)::text AS c FROM device_tokens
       WHERE user_id = ${alice.id} AND token = ${token} AND revoked_at IS NULL
    `.execute(db.db);
    expect(Number(row.rows[0]!.c)).toBe(1);
  });

  it("re-registering the same token is idempotent and reactivates a revoked row", async () => {
    const alice = await createTestUser(app);
    const token = "b".repeat(64);
    await app.inject({
      method: "POST",
      url: "/api/v1/me/devices",
      headers: { authorization: `Bearer ${alice.access_token}` },
      payload: { token, platform: "ios" },
    });
    // Revoke it.
    await app.inject({
      method: "DELETE",
      url: `/api/v1/me/devices/${token}`,
      headers: { authorization: `Bearer ${alice.access_token}` },
    });
    // Re-register — should resurrect.
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/me/devices",
      headers: { authorization: `Bearer ${alice.access_token}` },
      payload: { token, platform: "ios" },
    });
    expect(res.statusCode).toBe(201);

    const rows = await sql<{ c: string; active: string }>`
      SELECT count(*)::text AS c,
             count(*) FILTER (WHERE revoked_at IS NULL)::text AS active
        FROM device_tokens WHERE user_id = ${alice.id}
    `.execute(db.db);
    expect(Number(rows.rows[0]!.c)).toBe(1);
    expect(Number(rows.rows[0]!.active)).toBe(1);
  });

  it("rejects unauthenticated registration with 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/me/devices",
      payload: { token: "c".repeat(64), platform: "ios" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects tokens that are too short with 400", async () => {
    const alice = await createTestUser(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/me/devices",
      headers: { authorization: `Bearer ${alice.access_token}` },
      payload: { token: "abc", platform: "ios" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("revokes an existing token (204) and is idempotent on missing tokens", async () => {
    const alice = await createTestUser(app);
    const token = "d".repeat(64);
    await app.inject({
      method: "POST",
      url: "/api/v1/me/devices",
      headers: { authorization: `Bearer ${alice.access_token}` },
      payload: { token, platform: "ios" },
    });
    const first = await app.inject({
      method: "DELETE",
      url: `/api/v1/me/devices/${token}`,
      headers: { authorization: `Bearer ${alice.access_token}` },
    });
    expect(first.statusCode).toBe(204);

    const after = await sql<{ c: string }>`
      SELECT count(*)::text AS c FROM device_tokens
       WHERE user_id = ${alice.id} AND token = ${token} AND revoked_at IS NOT NULL
    `.execute(db.db);
    expect(Number(after.rows[0]!.c)).toBe(1);

    // Re-revoke is still 204 (idempotent) even though no active row exists.
    const second = await app.inject({
      method: "DELETE",
      url: `/api/v1/me/devices/${token}`,
      headers: { authorization: `Bearer ${alice.access_token}` },
    });
    expect(second.statusCode).toBe(204);
  });

  it("one user cannot revoke another user's token", async () => {
    const alice = await createTestUser(app);
    const bob = await createTestUser(app);
    const token = "e".repeat(64);
    await app.inject({
      method: "POST",
      url: "/api/v1/me/devices",
      headers: { authorization: `Bearer ${alice.access_token}` },
      payload: { token, platform: "ios" },
    });
    // Bob tries to nuke Alice's token. The endpoint returns 204 (idempotent
    // from Bob's perspective — he has no such row) but Alice's row stays.
    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/me/devices/${token}`,
      headers: { authorization: `Bearer ${bob.access_token}` },
    });
    expect(res.statusCode).toBe(204);
    const row = await sql<{ c: string }>`
      SELECT count(*)::text AS c FROM device_tokens
       WHERE user_id = ${alice.id} AND token = ${token} AND revoked_at IS NULL
    `.execute(db.db);
    expect(Number(row.rows[0]!.c)).toBe(1);
  });
});
