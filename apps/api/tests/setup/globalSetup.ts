import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Uses a local PostgreSQL database for testing. Applies all migrations against it.
 *
 * TEST_DATABASE_URL is intentionally respected when provided so developers and
 * CI can point tests at Docker Compose, Homebrew Postgres, or a disposable DB
 * without patching this file. DATABASE_URL is accepted as a fallback because
 * node-pg-migrate already uses that name.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const apiRoot = resolve(__dirname, "../..");

export async function setup(): Promise<void> {
  const url =
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    "postgres://localhost:5432/linkfit_test";
  console.warn(`Local-only mode: using PostgreSQL test database at ${url}`);

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
