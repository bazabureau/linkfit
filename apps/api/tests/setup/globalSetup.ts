import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Uses local PostgreSQL database for testing. Applies all migrations against it.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const apiRoot = resolve(__dirname, "../..");

export async function setup(): Promise<void> {
  console.warn("Local-only mode: using local PostgreSQL database 'linkfit_test' directly.");
  const url = "postgres://localhost:5432/linkfit_test";

  process.env.TEST_DATABASE_URL = url;
  process.env.DATABASE_URL = url;

  // Apply migrations against the test container.
  const result = spawnSync(
    "npx",
    ["node-pg-migrate", "up", "-m", "migrations", "-j", "sql", "--no-check-order"],
    {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: url },
      stdio: "inherit",
    },
  );
  if (result.status !== 0) {
    throw new Error(`Migrations failed in test setup (exit ${String(result.status)})`);
  }
}

export async function teardown(): Promise<void> {
  // No-op for local database
}
