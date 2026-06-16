-- Up Migration --

CREATE TYPE rating_outcome AS ENUM ('win', 'loss', 'draw');

-- One row per (rater → rated) pair within a game. The triple primary key
-- prevents double-submission and the CHECK forbids self-rating.
CREATE TABLE ratings (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id         uuid        NOT NULL REFERENCES games(id)  ON DELETE CASCADE,
  rater_user_id   uuid        NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  rated_user_id   uuid        NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  sport_id        uuid        NOT NULL REFERENCES sports(id) ON DELETE RESTRICT,
  outcome         rating_outcome NOT NULL,
  behavior_ok     boolean     NOT NULL,
  processed_at    timestamptz NULL,  -- non-null once consumed by ELO recompute
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, rater_user_id, rated_user_id),
  CONSTRAINT ratings_no_self_chk CHECK (rater_user_id <> rated_user_id)
);

CREATE INDEX ratings_game_idx       ON ratings (game_id);
CREATE INDEX ratings_rated_user_idx ON ratings (rated_user_id);
CREATE INDEX ratings_unprocessed_idx ON ratings (game_id) WHERE processed_at IS NULL;

CREATE TABLE player_sport_stats (
  user_id           uuid        NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  sport_id          uuid        NOT NULL REFERENCES sports(id) ON DELETE RESTRICT,
  elo_rating        integer     NOT NULL DEFAULT 1200 CHECK (elo_rating >= 0 AND elo_rating <= 4000),
  games_played      integer     NOT NULL DEFAULT 0    CHECK (games_played >= 0),
  games_won         integer     NOT NULL DEFAULT 0    CHECK (games_won >= 0),
  reliability_score smallint    NOT NULL DEFAULT 100  CHECK (reliability_score BETWEEN 0 AND 100),
  last_recalc_at    timestamptz NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, sport_id),
  CONSTRAINT player_sport_stats_won_lte_played_chk CHECK (games_won <= games_played)
);

CREATE TRIGGER player_sport_stats_set_updated_at
  BEFORE UPDATE ON player_sport_stats
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX player_sport_stats_sport_elo_idx
  ON player_sport_stats (sport_id, elo_rating DESC);

CREATE TABLE audit_log (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid        NULL REFERENCES users(id) ON DELETE SET NULL,
  action        text        NOT NULL,
  entity        text        NOT NULL,
  entity_id     uuid        NULL,
  metadata      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_actor_idx  ON audit_log (actor_user_id, created_at DESC);
CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id, created_at DESC);

-- Down Migration --
DROP TABLE IF EXISTS audit_log;
DROP TRIGGER IF EXISTS player_sport_stats_set_updated_at ON player_sport_stats;
DROP TABLE IF EXISTS player_sport_stats;
DROP TABLE IF EXISTS ratings;
DROP TYPE IF EXISTS rating_outcome;
