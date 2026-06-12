import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "kysely";
import { buildTestDb } from "../../../tests/helpers/db.js";
import { type DbHandle } from "./pool.js";
import { withTransaction } from "./withTransaction.js";

/**
 * Uses a temporary scratch table created/dropped in this suite so we don't
 * depend on any business migration yet. Verifies that withTransaction:
 *   1. commits on success
 *   2. rolls back on a thrown error (no partial writes)
 *   3. propagates the original error
 */
describe("withTransaction (Postgres)", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = buildTestDb();
    await sql`
      CREATE TABLE IF NOT EXISTS scratch_tx_test (
        id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        note text NOT NULL
      )
    `.execute(handle.db);
    await sql`TRUNCATE TABLE scratch_tx_test`.execute(handle.db);
  });

  afterAll(async () => {
    await sql`DROP TABLE IF EXISTS scratch_tx_test`.execute(handle.db);
    await handle.close();
  });

  it("commits when the callback resolves", async () => {
    await withTransaction(handle.db, async (tx) => {
      await sql`INSERT INTO scratch_tx_test (note) VALUES ('committed')`.execute(tx);
    });
    const rows = await sql<{ count: string }>`SELECT count(*)::text AS count FROM scratch_tx_test`
      .execute(handle.db);
    expect(rows.rows[0]?.count).toBe("1");
  });

  it("rolls back when the callback throws", async () => {
    await expect(
      withTransaction(handle.db, async (tx) => {
        await sql`INSERT INTO scratch_tx_test (note) VALUES ('will-rollback')`.execute(tx);
        throw new Error("boom");
      }),
    ).rejects.toThrow(/boom/);

    const rows = await sql<{ count: string }>`
      SELECT count(*)::text AS count FROM scratch_tx_test WHERE note = 'will-rollback'
    `.execute(handle.db);
    expect(rows.rows[0]?.count).toBe("0");
  });

  it("propagates the original error type, not a generic wrapper", async () => {
    class DomainError extends Error {
      public override readonly name = "DomainError";
    }
    await expect(
      withTransaction(handle.db, async () => {
        await Promise.resolve();
        throw new DomainError("specific failure mode");
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("returns the callback's resolved value when it commits", async () => {
    const result = await withTransaction(handle.db, async (tx) => {
      await sql`INSERT INTO scratch_tx_test (note) VALUES ('ret-value')`.execute(tx);
      return { rowsInserted: 1, note: "ret-value" } as const;
    });
    expect(result.rowsInserted).toBe(1);
    expect(result.note).toBe("ret-value");

    const row = await sql<{ note: string }>`
      SELECT note FROM scratch_tx_test WHERE note = 'ret-value'
    `.execute(handle.db);
    expect(row.rows[0]?.note).toBe("ret-value");
  });

  it("two concurrent transactions both commit and produce two rows", async () => {
    // Smoke-tests that withTransaction doesn't accidentally serialise on a
    // shared piece of state — the pool must be able to lease two distinct
    // transaction connections in parallel.
    const before = await sql<{ count: string }>`
      SELECT count(*)::text AS count FROM scratch_tx_test WHERE note IN ('parallel-a', 'parallel-b')
    `.execute(handle.db);
    expect(before.rows[0]?.count).toBe("0");

    await Promise.all([
      withTransaction(handle.db, async (tx) => {
        await sql`INSERT INTO scratch_tx_test (note) VALUES ('parallel-a')`.execute(tx);
      }),
      withTransaction(handle.db, async (tx) => {
        await sql`INSERT INTO scratch_tx_test (note) VALUES ('parallel-b')`.execute(tx);
      }),
    ]);

    const after = await sql<{ count: string }>`
      SELECT count(*)::text AS count FROM scratch_tx_test WHERE note IN ('parallel-a', 'parallel-b')
    `.execute(handle.db);
    expect(after.rows[0]?.count).toBe("2");
  });
});
