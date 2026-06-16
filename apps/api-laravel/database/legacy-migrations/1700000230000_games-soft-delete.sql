-- Up Migration --
-- Soft-delete column for admin moderation. We never hard-delete games because
-- their participants, ratings, and audit history reference them. Public
-- queries must filter by `deleted_at IS NULL`; admin queries can include
-- everything.

ALTER TABLE games
  ADD COLUMN deleted_at timestamptz NULL;

CREATE INDEX games_not_deleted_idx
  ON games (starts_at)
  WHERE deleted_at IS NULL;

-- Down Migration --
DROP INDEX IF EXISTS games_not_deleted_idx;
ALTER TABLE games DROP COLUMN IF EXISTS deleted_at;
