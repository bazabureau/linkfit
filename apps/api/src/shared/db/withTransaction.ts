import { type Kysely, type Transaction } from "kysely";
import { type Database } from "./types.js";

/**
 * Run a unit of work inside a single Postgres transaction.
 *
 * Throws bubble up after rollback. Nested calls reuse the active transaction
 * so multi-layer services don't accidentally open sub-transactions.
 *
 * Every service method that performs more than one write MUST go through this
 * helper. Repository functions accept the executor (`Kysely | Transaction`) so
 * the same code path works inside and outside a transaction.
 */
export type Executor = Kysely<Database> | Transaction<Database>;

export async function withTransaction<T>(
  db: Kysely<Database>,
  fn: (tx: Transaction<Database>) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (tx) => fn(tx));
}
