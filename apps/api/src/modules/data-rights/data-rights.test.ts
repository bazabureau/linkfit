import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildServer, type LinkfitServer } from "../../shared/http/server.js";
import { buildTestDb } from "../../../tests/helpers/db.js";
import { buildTestEnv } from "../../../tests/helpers/env.js";
import { createTestUser, truncateAll } from "../../../tests/helpers/fixtures.js";
import { type DbHandle } from "../../shared/db/pool.js";

interface DeletionBody {
  user_id: string;
  status: "scheduled" | "cancelled" | "completed";
  requested_at: string;
  hard_delete_at: string;
  cancelled_at: string | null;
  completed_at: string | null;
}

interface ExportBody {
  id: string;
  user_id: string;
  status: "queued" | "processing" | "ready" | "failed";
  download_url: string | null;
  expires_at: string;
  created_at: string;
  completed_at: string | null;
}

describe("data-rights routes", () => {
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

  // ── Account deletion ───────────────────────────────────────────────

  describe("DELETE /api/v1/me", () => {
    it("schedules a deletion with a +30d hard_delete_at and anonymizes the user", async () => {
      const alice = await createTestUser(app, { display_name: "Alice" });

      const res = await app.inject({
        method: "DELETE",
        url: "/api/v1/me",
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(res.statusCode).toBe(202);
      const body = res.json<DeletionBody>();
      expect(body.user_id).toBe(alice.id);
      expect(body.status).toBe("scheduled");
      const hardDeleteMs = new Date(body.hard_delete_at).getTime() - Date.now();
      // ~30 days, allow ±1 day for clock drift / scheduling latency.
      expect(hardDeleteMs).toBeGreaterThan(29 * 24 * 3600 * 1000);
      expect(hardDeleteMs).toBeLessThan(31 * 24 * 3600 * 1000);

      // Verify the user was anonymized in the DB.
      const u = await db.db
        .selectFrom("users")
        .select(["email", "display_name", "photo_url", "deleted_at"])
        .where("id", "=", alice.id)
        .executeTakeFirstOrThrow();
      expect(u.email).toMatch(/^deleted-.*@linkfit\.deleted$/);
      expect(u.display_name).toBe("deleted user");
      expect(u.photo_url).toBeNull();
      expect(u.deleted_at).not.toBeNull();
    });

    it("returns 401 to unauthenticated callers", async () => {
      const res = await app.inject({ method: "DELETE", url: "/api/v1/me" });
      expect(res.statusCode).toBe(401);
    });

    it("returns 409 when a deletion is already scheduled", async () => {
      const alice = await createTestUser(app);
      const first = await app.inject({
        method: "DELETE",
        url: "/api/v1/me",
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(first.statusCode).toBe(202);

      const second = await app.inject({
        method: "DELETE",
        url: "/api/v1/me",
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(second.statusCode).toBe(409);
    });
  });

  describe("POST /api/v1/me/delete/cancel", () => {
    it("cancels a scheduled deletion and restores deleted_at = null", async () => {
      const alice = await createTestUser(app);
      await app.inject({
        method: "DELETE",
        url: "/api/v1/me",
        headers: { authorization: `Bearer ${alice.access_token}` },
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/me/delete/cancel",
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<DeletionBody>();
      expect(body.status).toBe("cancelled");
      expect(body.cancelled_at).not.toBeNull();

      const u = await db.db
        .selectFrom("users")
        .select("deleted_at")
        .where("id", "=", alice.id)
        .executeTakeFirstOrThrow();
      expect(u.deleted_at).toBeNull();
    });

    it("returns 404 when there's nothing to cancel", async () => {
      const alice = await createTestUser(app);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/me/delete/cancel",
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── Data export ────────────────────────────────────────────────────

  describe("POST /api/v1/me/data-export", () => {
    it("produces a JSON file at the returned download_url containing the user's data", async () => {
      const alice = await createTestUser(app, { display_name: "Alice" });

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/me/data-export",
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<ExportBody>();
      expect(body.status).toBe("ready");
      expect(body.download_url).not.toBeNull();
      expect(body.completed_at).not.toBeNull();

      // Resolve the download URL back to the on-disk file. `download_url`
      // is `<publicBaseUrl>/uploads/data-exports/<filename>`, the
      // filesystem lives at `<UPLOAD_DIR>/data-exports/<filename>`.
      const url = new URL(body.download_url!);
      const filename = url.pathname.split("/").pop()!;
      const filepath = `${env.UPLOAD_DIR}/data-exports/${filename}`;
      const json = JSON.parse(readFileSync(filepath, "utf8")) as {
        user_id: string;
        profile: { id: string; email: string } | null;
        games_hosted: { rows: unknown[]; _truncated: boolean };
      };
      expect(json.user_id).toBe(alice.id);
      expect(json.profile?.email).toBe(alice.email);
      expect(json.games_hosted._truncated).toBe(false);
    });

    it("rejects a second request within the cooldown window", async () => {
      const alice = await createTestUser(app);

      const first = await app.inject({
        method: "POST",
        url: "/api/v1/me/data-export",
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(first.statusCode).toBe(200);

      const second = await app.inject({
        method: "POST",
        url: "/api/v1/me/data-export",
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(second.statusCode).toBe(409);
    });

    it("returns 401 to unauthenticated callers", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/me/data-export",
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("GET /api/v1/me/data-export", () => {
    it("returns null when no export has been requested", async () => {
      const alice = await createTestUser(app);
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/me/data-export",
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe("null");
    });

    it("returns the latest export request", async () => {
      const alice = await createTestUser(app);
      await app.inject({
        method: "POST",
        url: "/api/v1/me/data-export",
        headers: { authorization: `Bearer ${alice.access_token}` },
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/me/data-export",
        headers: { authorization: `Bearer ${alice.access_token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<ExportBody>();
      expect(body.status).toBe("ready");
    });
  });

  // Touch fileURLToPath so the import is used even if all assertions short-
  // circuit; keeps Vitest from flagging an unused import on collection.
  it("smoke: fileURLToPath helper resolves", () => {
    expect(typeof fileURLToPath("file:///tmp/x")).toBe("string");
  });
});
