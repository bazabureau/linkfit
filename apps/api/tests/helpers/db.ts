import pino from "pino";
import { createDb, type DbHandle } from "../../src/shared/db/pool.js";

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL not set. Make sure tests/setup/globalSetup.ts ran successfully.",
    );
  }
  return url;
}

export function buildTestDb(): DbHandle {
  return createDb({
    databaseUrl: testDatabaseUrl(),
    logger: pino({ level: "silent" }),
  });
}
