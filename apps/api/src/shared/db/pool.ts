import { Kysely, PostgresDialect, type LogEvent } from "kysely";
import pg from "pg";
import { type Logger } from "pino";
import { type Database } from "./types.js";

export interface DbDeps {
  databaseUrl: string;
  logger: Logger;
  maxConnections?: number;
}

export interface DbHandle {
  readonly pool: pg.Pool;
  readonly db: Kysely<Database>;
  close: () => Promise<void>;
}

export function createDb(deps: DbDeps): DbHandle {
  const pool = new pg.Pool({
    connectionString: deps.databaseUrl,
    max: deps.maxConnections ?? 10,
    idleTimeoutMillis: 30_000,
    application_name: "linkfit-api",
  });

  pool.on("error", (err) => {
    deps.logger.error({ err }, "postgres pool error");
  });

  const db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
    log: (event: LogEvent) => {
      if (event.level === "error") {
        deps.logger.error(
          { err: event.error, sql: event.query.sql, params: event.query.parameters },
          "kysely query error",
        );
      } else {
        deps.logger.trace(
          { sql: event.query.sql, durationMs: event.queryDurationMillis },
          "kysely query",
        );
      }
    },
  });

  return {
    pool,
    db,
    close: async () => {
      await db.destroy();
    },
  };
}
