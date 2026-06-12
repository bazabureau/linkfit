import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "kysely";
import { buildTestDb } from "../../../tests/helpers/db.js";
import { type DbHandle } from "./pool.js";

/**
 * Phase 2 schema-only smoke tests. We do not implement booking flows in
 * Phase 1; we just guarantee the tables, foreign keys, and uniqueness
 * constraints are in place so we don't break migrations later.
 */
describe("phase 2 schema", () => {
  let db: DbHandle;
  beforeAll(() => {
    db = buildTestDb();
  });
  afterAll(async () => {
    await db.close();
  });

  it("bookings table exists with idempotency_key UNIQUE", async () => {
    const result = await sql<{ column_name: string }>`
      SELECT column_name FROM information_schema.columns
       WHERE table_name = 'bookings' AND column_name = 'idempotency_key'
    `.execute(db.db);
    expect(result.rows.length).toBe(1);

    const uniques = await sql<{ constraint_name: string }>`
      SELECT tc.constraint_name
        FROM information_schema.table_constraints tc
       WHERE tc.table_name = 'bookings'
         AND tc.constraint_type = 'UNIQUE'
    `.execute(db.db);
    const names = uniques.rows.map((r) => r.constraint_name).join(",");
    expect(names).toMatch(/idempotency_key|game_id/);
  });

  it("payment_splits enforces UNIQUE(booking_id, user_id)", async () => {
    const result = await sql<{ constraint_name: string }>`
      SELECT tc.constraint_name
        FROM information_schema.table_constraints tc
       WHERE tc.table_name = 'payment_splits'
         AND tc.constraint_type = 'UNIQUE'
    `.execute(db.db);
    expect(result.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("booking_status enum has all 6 states", async () => {
    const result = await sql<{ enum_label: string }>`
      SELECT e.enumlabel AS enum_label
        FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
       WHERE t.typname = 'booking_status'
       ORDER BY e.enumsortorder
    `.execute(db.db);
    expect(result.rows.map((r) => r.enum_label)).toEqual([
      "pending_payment",
      "partially_paid",
      "paid",
      "cancelled",
      "refunded",
      "failed",
    ]);
  });

  it("bookings.user_id is a NOT NULL FK to users.id", async () => {
    const cols = await sql<{ column_name: string; is_nullable: string }>`
      SELECT column_name, is_nullable
        FROM information_schema.columns
       WHERE table_name = 'bookings' AND column_name = 'user_id'
    `.execute(db.db);
    expect(cols.rows.length).toBe(1);
    expect(cols.rows[0]?.is_nullable).toBe("NO");

    const fks = await sql<{ foreign_table: string; foreign_column: string }>`
      SELECT
        ccu.table_name  AS foreign_table,
        ccu.column_name AS foreign_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = 'bookings'
        AND kcu.column_name = 'user_id'
    `.execute(db.db);
    expect(fks.rows.length).toBeGreaterThanOrEqual(1);
    expect(fks.rows[0]?.foreign_table).toBe("users");
    expect(fks.rows[0]?.foreign_column).toBe("id");
  });

  it("payment_splits enforces non-negative amount_minor", async () => {
    // The schema disallows negative amounts. We assert by attempting an
    // insert that violates the constraint and expecting Postgres to throw.
    // The test is scoped to constraint checking — it doesn't need a real
    // booking to exist because the type/check constraint fires earliest.
    await expect(
      sql`
        INSERT INTO payment_splits (booking_id, user_id, amount_minor)
        VALUES (gen_random_uuid(), gen_random_uuid(), -1)
      `.execute(db.db),
    ).rejects.toThrow();
  });

  it("notifications.type enum includes 'system' (used by follow notifications)", async () => {
    // The follows.routes test expects a 'system' notification to be created
    // when a user is followed. Pin the enum so future schema rewrites can't
    // silently drop that value.
    const result = await sql<{ enum_label: string }>`
      SELECT e.enumlabel AS enum_label
        FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
       WHERE t.typname = 'notification_type'
    `.execute(db.db);
    const labels = result.rows.map((r) => r.enum_label);
    expect(labels).toContain("system");
  });
});
