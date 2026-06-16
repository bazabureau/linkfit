-- Up Migration --

CREATE TABLE sports (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text        NOT NULL UNIQUE,
  name        text        NOT NULL,
  min_players smallint    NOT NULL CHECK (min_players  > 0),
  max_players smallint    NOT NULL CHECK (max_players >= min_players),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Seed: Linkfit only supports padel and tennis.
INSERT INTO sports (slug, name, min_players, max_players) VALUES
  ('padel',      'Padel',           4,  4),
  ('tennis',     'Tennis',          2,  4);

CREATE TABLE venues (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text        NOT NULL,
  address      text        NOT NULL,
  lat          numeric(9, 6) NOT NULL CHECK (lat BETWEEN -90  AND 90),
  lng          numeric(9, 6) NOT NULL CHECK (lng BETWEEN -180 AND 180),
  owner_user_id uuid       NULL REFERENCES users(id) ON DELETE SET NULL,
  is_partner   boolean     NOT NULL DEFAULT false,
  phone        text        NULL,
  description  text        NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER venues_set_updated_at
  BEFORE UPDATE ON venues
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- earthdistance expression index for fast "venues within X km" queries.
CREATE INDEX venues_earth_idx
  ON venues USING gist (ll_to_earth(lat::float8, lng::float8));

CREATE TABLE courts (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id           uuid        NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  sport_id           uuid        NOT NULL REFERENCES sports(id) ON DELETE RESTRICT,
  name               text        NOT NULL,
  hourly_price_minor integer     NOT NULL CHECK (hourly_price_minor >= 0),
  currency           char(3)     NOT NULL DEFAULT 'AZN',
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venue_id, name)
);

CREATE INDEX courts_venue_idx ON courts (venue_id);
CREATE INDEX courts_sport_idx ON courts (sport_id);

-- Down Migration --
DROP TABLE IF EXISTS courts;
DROP TRIGGER IF EXISTS venues_set_updated_at ON venues;
DROP INDEX IF EXISTS venues_earth_idx;
DROP TABLE IF EXISTS venues;
DROP TABLE IF EXISTS sports;
