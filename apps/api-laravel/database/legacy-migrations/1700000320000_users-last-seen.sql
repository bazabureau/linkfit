-- Up Migration --
--
-- Adds `users.last_seen_at` so we can surface "Active now" / "5m ago" /
-- "Active yesterday" presence chips on player lists and public profiles.
--
-- The column is refreshed by the auth middleware on a debounced cadence:
-- after a successful JWT verification, the guard fires a fire-and-forget
-- UPDATE only if the existing `last_seen_at` is older than 60 seconds (the
-- WHERE clause does the debounce in the API auth middleware.
-- This keeps the write rate to at most one row update per active user per
-- minute, so it stays cheap even with high request volume.
--
-- Existing rows are backfilled to NOW() rather than NULL so the iOS UI
-- doesn't render every legacy account as "never seen" the day this ships.
-- New columns of this kind are usually NULLable; we explicitly leave it
-- nullable for test fixtures / system accounts that never authenticate.
--
-- A simple btree index supports the "active in the last X minutes" queries
-- we expect to add later (e.g. player-discovery filters, admin presence
-- dashboards). It is a partial index on `last_seen_at IS NOT NULL` to keep
-- it tight even on accounts that never log in.

ALTER TABLE users
  ADD COLUMN last_seen_at timestamptz NULL DEFAULT now();

-- Backfill: every existing row already inherits DEFAULT now() from the
-- ADD COLUMN above, so this is a no-op for fresh deploys. Keeping the
-- explicit UPDATE here documents intent and is safe to re-run.
UPDATE users SET last_seen_at = now() WHERE last_seen_at IS NULL;

CREATE INDEX users_last_seen_at_idx
  ON users (last_seen_at DESC)
  WHERE last_seen_at IS NOT NULL;

-- Down Migration --
DROP INDEX IF EXISTS users_last_seen_at_idx;
ALTER TABLE users DROP COLUMN IF EXISTS last_seen_at;
