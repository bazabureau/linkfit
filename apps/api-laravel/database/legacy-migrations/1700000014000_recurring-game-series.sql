-- Up Migration --
--
-- Recurring game series. A host schedules a weekly slot once (e.g. "every
-- Tuesday 19:00 at Padel Center for 8 weeks"). The series row is the
-- template; individual games are materialized at creation time so the
-- normal /games endpoints, push notifications, ratings and bookings keep
-- working without special-casing recurrence.
--
-- Cancelling a series flips downstream games' status to 'cancelled' from
-- the cancel point forward — past games are immutable history.

CREATE TYPE game_series_status AS ENUM ('active', 'cancelled');

CREATE TABLE game_series (
  id                uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  host_user_id      uuid              NOT NULL REFERENCES users(id)  ON DELETE RESTRICT,
  sport_id          uuid              NOT NULL REFERENCES sports(id) ON DELETE RESTRICT,
  court_id          uuid              NULL     REFERENCES courts(id) ON DELETE SET NULL,
  lat               numeric(9, 6)     NOT NULL CHECK (lat BETWEEN -90  AND 90),
  lng               numeric(9, 6)     NOT NULL CHECK (lng BETWEEN -180 AND 180),
  -- 0=Sunday … 6=Saturday, matches Postgres EXTRACT(DOW) so callers can
  -- compute next occurrences without conversion tables.
  day_of_week       smallint          NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  time_of_day       time              NOT NULL,
  duration_minutes  smallint          NOT NULL CHECK (duration_minutes BETWEEN 15 AND 480),
  capacity          smallint          NOT NULL CHECK (capacity > 0),
  occurrences       smallint          NOT NULL CHECK (occurrences BETWEEN 1 AND 52),
  starts_on         date              NOT NULL,
  ends_on           date              NOT NULL,
  status            game_series_status NOT NULL DEFAULT 'active',
  notes             text              NULL,
  created_at        timestamptz       NOT NULL DEFAULT now(),
  CONSTRAINT game_series_date_order_chk CHECK (ends_on >= starts_on)
);

CREATE INDEX game_series_host_idx   ON game_series (host_user_id, created_at DESC);
CREATE INDEX game_series_status_idx ON game_series (status, starts_on);

-- Link materialized games back to their template. NULL for ad-hoc games.
ALTER TABLE games
  ADD COLUMN series_id          uuid     NULL REFERENCES game_series(id) ON DELETE SET NULL,
  ADD COLUMN occurrence_number  smallint NULL CHECK (occurrence_number IS NULL OR occurrence_number > 0);

CREATE INDEX games_series_idx ON games (series_id, occurrence_number)
  WHERE series_id IS NOT NULL;

-- A series cannot have two games at the same slot number.
CREATE UNIQUE INDEX games_series_occurrence_uq
  ON games (series_id, occurrence_number)
  WHERE series_id IS NOT NULL;

-- Down Migration ----------------------------------------------------------
DROP INDEX IF EXISTS games_series_occurrence_uq;
DROP INDEX IF EXISTS games_series_idx;
ALTER TABLE games DROP COLUMN IF EXISTS occurrence_number;
ALTER TABLE games DROP COLUMN IF EXISTS series_id;
DROP INDEX IF EXISTS game_series_status_idx;
DROP INDEX IF EXISTS game_series_host_idx;
DROP TABLE IF EXISTS game_series;
DROP TYPE  IF EXISTS game_series_status;
