-- Up Migration --
-- Evolve the bookings table to support the real iOS court-booking flow:
-- a user picks a venue + court + start time + duration, and we mint a
-- single-user booking against that time window.  The original Phase-2 sketch
-- coupled every booking to a game (game_id NOT NULL UNIQUE) — that's now
-- relaxed so bookings can exist without an associated game, and overlap is
-- detected on the court + time window rather than via the game uniqueness.

-- 1. Drop the game_id UNIQUE constraint so multiple bookings can reference
--    the same (optional) game in the future, and make the column nullable
--    since the new flow doesn't require a game.
ALTER TABLE bookings DROP CONSTRAINT bookings_game_id_key;
ALTER TABLE bookings ALTER COLUMN game_id DROP NOT NULL;

-- 2. Add the owner / time window columns.  user_id is required so we can
--    answer "GET /bookings/me" without a join.  starts_at + duration_minutes
--    define the window we check for overlaps.
ALTER TABLE bookings
  ADD COLUMN user_id          uuid        NULL REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN starts_at        timestamptz NULL,
  ADD COLUMN duration_minutes smallint    NULL
    CHECK (duration_minutes IS NULL OR (duration_minutes BETWEEN 15 AND 480));

-- 3. Backfill is unnecessary — the Phase-2 schema shipped zero booking rows
--    in production.  After the column gymnastics, tighten the NOT NULL.
UPDATE bookings SET starts_at = created_at, duration_minutes = 60
  WHERE starts_at IS NULL;
UPDATE bookings b SET user_id = (
  SELECT host_user_id FROM games g WHERE g.id = b.game_id
) WHERE user_id IS NULL AND b.game_id IS NOT NULL;
-- Any leftover rows would be orphans from earlier hand-seeding; safe to drop.
DELETE FROM bookings WHERE user_id IS NULL;

ALTER TABLE bookings
  ALTER COLUMN user_id          SET NOT NULL,
  ALTER COLUMN starts_at        SET NOT NULL,
  ALTER COLUMN duration_minutes SET NOT NULL;

-- 4. Helpful indexes.
CREATE INDEX bookings_user_idx              ON bookings (user_id, created_at DESC);
CREATE INDEX bookings_court_starts_at_idx   ON bookings (court_id, starts_at);
CREATE INDEX bookings_active_window_idx
  ON bookings (court_id, starts_at)
  WHERE status IN ('pending_payment', 'partially_paid', 'paid');

-- Down Migration --
DROP INDEX IF EXISTS bookings_active_window_idx;
DROP INDEX IF EXISTS bookings_court_starts_at_idx;
DROP INDEX IF EXISTS bookings_user_idx;
ALTER TABLE bookings
  DROP COLUMN IF EXISTS duration_minutes,
  DROP COLUMN IF EXISTS starts_at,
  DROP COLUMN IF EXISTS user_id;
ALTER TABLE bookings ALTER COLUMN game_id SET NOT NULL;
ALTER TABLE bookings ADD CONSTRAINT bookings_game_id_key UNIQUE (game_id);
