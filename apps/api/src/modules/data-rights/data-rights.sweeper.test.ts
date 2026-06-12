import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer, type LinkfitServer } from "../../shared/http/server.js";
import { buildTestDb } from "../../../tests/helpers/db.js";
import { buildTestEnv } from "../../../tests/helpers/env.js";
import { createTestUser, truncateAll } from "../../../tests/helpers/fixtures.js";
import { type DbHandle } from "../../shared/db/pool.js";
import { DataRightsSweeper } from "./data-rights.sweeper.js";

/**
 * Integration tests for the sweeper. We drive it directly via `tick()`
 * rather than the timer so the test is deterministic — no Date manipulation
 * via timers, no flaky 100ms waits.
 */
describe("DataRightsSweeper", () => {
  const env = buildTestEnv();
  let app: LinkfitServer;
  let db: DbHandle;
  let sweeper: DataRightsSweeper;
  let tmpUploadDir: string;

  beforeAll(async () => {
    db = buildTestDb();
    app = await buildServer({ env, logger: pino({ level: "silent" }), db });
    await app.ready();
    tmpUploadDir = mkdtempSync(join(tmpdir(), "linkfit-sweeper-test-"));
    sweeper = new DataRightsSweeper({
      db,
      logger: pino({ level: "silent" }),
      uploadDir: tmpUploadDir,
    });
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
  });

  it("hard-deletes accounts whose hard_delete_at has passed", async () => {
    const alice = await createTestUser(app);
    // Schedule and immediately back-date hard_delete_at into the past.
    await db.db
      .insertInto("account_deletion_requests")
      .values({
        user_id: alice.id,
        hard_delete_at: new Date(Date.now() - 60_000),
        status: "scheduled",
      })
      .execute();
    await db.db.updateTable("users").set({ deleted_at: new Date() }).where("id", "=", alice.id).execute();

    const result = await sweeper.tick();
    expect(result.accountsDeleted).toBe(1);

    const stillThere = await db.db
      .selectFrom("users")
      .select("id")
      .where("id", "=", alice.id)
      .executeTakeFirst();
    expect(stillThere).toBeUndefined();
  });

  it("does NOT delete accounts whose hard_delete_at is still in the future", async () => {
    const bob = await createTestUser(app);
    await db.db
      .insertInto("account_deletion_requests")
      .values({
        user_id: bob.id,
        hard_delete_at: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        status: "scheduled",
      })
      .execute();

    const result = await sweeper.tick();
    expect(result.accountsDeleted).toBe(0);

    const stillThere = await db.db
      .selectFrom("users")
      .select("id")
      .where("id", "=", bob.id)
      .executeTakeFirst();
    expect(stillThere?.id).toBe(bob.id);
  });

  it("skips already-cancelled deletion requests", async () => {
    const carol = await createTestUser(app);
    await db.db
      .insertInto("account_deletion_requests")
      .values({
        user_id: carol.id,
        hard_delete_at: new Date(Date.now() - 60_000),
        status: "cancelled",
        cancelled_at: new Date(),
      })
      .execute();

    const result = await sweeper.tick();
    expect(result.accountsDeleted).toBe(0);
  });

  it("purges expired data exports — unlinks file and flips row to failed", async () => {
    const dave = await createTestUser(app);

    // Create a real export so the file exists on disk.
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/me/data-export",
      headers: { authorization: `Bearer ${dave.access_token}` },
    });
    expect(res.statusCode).toBe(200);

    // Find the file that the service wrote to the configured UPLOAD_DIR
    // and the row it inserted. We then back-date expires_at to drive the
    // sweeper into the purge branch.
    const row = await db.db
      .selectFrom("data_export_requests")
      .selectAll()
      .where("user_id", "=", dave.id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe("ready");
    expect(row.download_url).not.toBeNull();

    const downloadUrl = row.download_url;
    if (downloadUrl === null) throw new Error("download_url missing on ready export");
    const filenameParts = downloadUrl.split("/");
    const filename = filenameParts[filenameParts.length - 1];
    if (filename === undefined) throw new Error("filename empty");
    const realFilepath = join(env.UPLOAD_DIR, "data-exports", filename);
    expect(existsSync(realFilepath)).toBe(true);

    // Re-point the sweeper at the real upload dir for this case so it
    // can find the file it needs to unlink.
    const realSweeper = new DataRightsSweeper({
      db,
      logger: pino({ level: "silent" }),
      uploadDir: env.UPLOAD_DIR,
    });

    await db.db
      .updateTable("data_export_requests")
      .set({ expires_at: new Date(Date.now() - 60_000) })
      .where("id", "=", row.id)
      .execute();

    const result = await realSweeper.tick();
    expect(result.exportsPurged).toBe(1);

    const after = await db.db
      .selectFrom("data_export_requests")
      .selectAll()
      .where("id", "=", row.id)
      .executeTakeFirstOrThrow();
    expect(after.status).toBe("failed");
    expect(after.download_url).toBeNull();
    expect(existsSync(realFilepath)).toBe(false);
  });

  it("is idempotent — running twice does no extra work", async () => {
    const eve = await createTestUser(app);
    await db.db
      .insertInto("account_deletion_requests")
      .values({
        user_id: eve.id,
        hard_delete_at: new Date(Date.now() - 60_000),
        status: "scheduled",
      })
      .execute();

    const first = await sweeper.tick();
    expect(first.accountsDeleted).toBe(1);

    const second = await sweeper.tick();
    expect(second.accountsDeleted).toBe(0);
  });

  it("tmpUploadDir exists for the test fixture lifetime", () => {
    // Sanity: the temp directory we minted should exist.
    expect(readdirSync(tmpUploadDir)).toEqual([]);
  });
});
