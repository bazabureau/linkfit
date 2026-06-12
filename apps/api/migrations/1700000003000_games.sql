-- Up Migration --

CREATE TYPE game_status     AS ENUM ('open', 'full', 'cancelled', 'completed');
CREATE TYPE game_visibility AS ENUM ('public', 'invite');
CREATE TYPE participant_status AS ENUM ('confirmed', 'cancelled', 'no_show', 'played');

CREATE TABLE games (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  sport_id        uuid        NOT NULL REFERENCES sports(id) ON DELETE RESTRICT,
  court_id        uuid        NULL     REFERENCES courts(id) ON DELETE SET NULL,
  host_user_id    uuid        NOT NULL REFERENCES users(id)  ON DELETE RESTRICT,
  -- denormalised location so games not tied to a court (free park, etc.)
  -- still have a coordinate. Required.
  lat             numeric(9, 6) NOT NULL CHECK (lat BETWEEN -90  AND 90),
  lng             numeric(9, 6) NOT NULL CHECK (lng BETWEEN -180 AND 180),
  starts_at       timestamptz NOT NULL,
  duration_minutes smallint   NOT NULL CHECK (duration_minutes BETWEEN 15 AND 480),
  capacity        smallint    NOT NULL CHECK (capacity > 0),
  skill_min_elo   integer     NULL CHECK (skill_min_elo IS NULL OR skill_min_elo BETWEEN 0 AND 4000),
  skill_max_elo   integer     NULL CHECK (skill_max_elo IS NULL OR skill_max_elo BETWEEN 0 AND 4000),
  visibility      game_visibility NOT NULL DEFAULT 'public',
  status          game_status     NOT NULL DEFAULT 'open',
  notes           text        NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT games_skill_range_chk CHECK (
    skill_min_elo IS NULL OR skill_max_elo IS NULL OR skill_min_elo <= skill_max_elo
  )
);

CREATE INDEX games_starts_at_idx       ON games (starts_at);
CREATE INDEX games_sport_status_idx    ON games (sport_id, status, starts_at);
CREATE INDEX games_host_idx            ON games (host_user_id);
CREATE INDEX games_court_idx           ON games (court_id);
CREATE INDEX games_earth_idx
  ON games USING gist (ll_to_earth(lat::float8, lng::float8));

CREATE TRIGGER games_set_updated_at
  BEFORE UPDATE ON games
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE game_participants (
  game_id      uuid        NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  joined_at    timestamptz NOT NULL DEFAULT now(),
  status       participant_status NOT NULL DEFAULT 'confirmed',
  status_changed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, user_id)
);

CREATE INDEX game_participants_user_idx
  ON game_participants (user_id, status_changed_at DESC);

-- Down Migration --
DROP TABLE IF EXISTS game_participants;
DROP TRIGGER IF EXISTS games_set_updated_at ON games;
DROP INDEX IF EXISTS games_earth_idx;
DROP TABLE IF EXISTS games;
DROP TYPE IF EXISTS participant_status;
DROP TYPE IF EXISTS game_visibility;
DROP TYPE IF EXISTS game_status;
