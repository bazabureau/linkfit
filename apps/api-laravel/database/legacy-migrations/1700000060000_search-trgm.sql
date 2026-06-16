-- Up Migration --
-- Global search support. We use the pg_trgm extension to power fast
-- case-insensitive substring matching across the entities the iOS app
-- exposes through its unified Search screen (players, games, tournaments,
-- venues). Trigram GIN indexes give us sub-linear ILIKE / similarity()
-- queries without pulling in a full-text search engine.
--
-- Columns chosen:
--   users.display_name     — player directory search
--   games.notes            — host-supplied free text (game discovery)
--   tournaments.name       — tournament discovery
--   venues.name + address  — venue lookup ("padel hub", "yasamal", etc.)

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS users_display_name_trgm_idx
  ON users USING gin (display_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS games_notes_trgm_idx
  ON games USING gin (notes gin_trgm_ops)
  WHERE notes IS NOT NULL;

CREATE INDEX IF NOT EXISTS tournaments_name_trgm_idx
  ON tournaments USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS venues_name_trgm_idx
  ON venues USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS venues_address_trgm_idx
  ON venues USING gin (address gin_trgm_ops);

-- Down Migration --
DROP INDEX IF EXISTS venues_address_trgm_idx;
DROP INDEX IF EXISTS venues_name_trgm_idx;
DROP INDEX IF EXISTS tournaments_name_trgm_idx;
DROP INDEX IF EXISTS games_notes_trgm_idx;
DROP INDEX IF EXISTS users_display_name_trgm_idx;
-- pg_trgm may be used by other migrations later; leave the extension in place.
