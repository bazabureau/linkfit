-- Up Migration --
--
-- Achievements / Badges system.
--
-- Two tables:
--   `achievements`       — the catalog (one row per badge definition). Lookups
--                          happen by `slug` (stable, app-readable) so the iOS
--                          client can hardcode references without baking in
--                          uuids.
--   `user_achievements`  — unlock ledger, composite PK (user_id, achievement_slug).
--
-- The `criteria` jsonb on `achievements` encodes the unlock rule in a small
-- DSL the service layer understands. Examples:
--   { "type": "games_played", "value": 10, "sport": "padel" }
--   { "type": "elo_min",      "value": 1500, "sport": "padel" }
--   { "type": "win_streak",   "value": 5,    "sport": "padel" }
--   { "type": "reliability_min", "value": 90, "min_games": 20, "sport": "padel" }
--   { "type": "tournament_finalist" }
--   { "type": "no_show_free_month" }
--
-- We deliberately don't expose `criteria` to clients; the API surface returns
-- a structured progress object instead.

CREATE TABLE achievements (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text        NOT NULL UNIQUE CHECK (char_length(slug) BETWEEN 1 AND 64),
  name        text        NOT NULL,
  description text        NOT NULL,
  icon_name   text        NOT NULL, -- SF Symbol name on iOS
  criteria    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_achievements (
  user_id            uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_slug   text        NOT NULL REFERENCES achievements(slug) ON DELETE CASCADE,
  unlocked_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, achievement_slug)
);

-- Fast "give me all unlocks for a user" lookup.
CREATE INDEX user_achievements_user_idx
  ON user_achievements (user_id, unlocked_at DESC);

-- Fast "who has badge X" lookup (admin / leaderboard surfacing).
CREATE INDEX user_achievements_slug_idx
  ON user_achievements (achievement_slug, unlocked_at DESC);

-- Down Migration ----------------------------------------------------------
DROP INDEX IF EXISTS user_achievements_slug_idx;
DROP INDEX IF EXISTS user_achievements_user_idx;
DROP TABLE IF EXISTS user_achievements;
DROP TABLE IF EXISTS achievements;
