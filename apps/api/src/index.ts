import { loadEnv } from "./shared/config/env.js";
import { createLogger } from "./shared/logging/logger.js";
import { createDb } from "./shared/db/pool.js";
import { buildServer } from "./shared/http/server.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env);

  const db = createDb({ databaseUrl: env.DATABASE_URL, logger });
  const app = await buildServer({ env, logger, db });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "shutting down");
    try {
      await app.close();
      await db.close();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "error during shutdown");
      process.exit(1);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) => {
    logger.fatal({ err: reason }, "unhandled rejection");
    process.exit(1);
  });
  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "uncaught exception");
    process.exit(1);
  });

  await app.listen({ port: env.PORT, host: env.HOST });
}

main().catch((err: unknown) => {
  // Logger may not exist yet (env load failure). Use stderr directly for boot crash.
   
  console.error("Fatal boot error:", err);
  process.exit(1);
});
