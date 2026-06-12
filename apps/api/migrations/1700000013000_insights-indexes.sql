-- Up Migration --
--
-- Insights agent — indexes only.
--
-- Goal: serve `GET /api/v1/me/insights?sport=padel&days=90` without scanning.
-- We compute series (ELO over time, win-rate trend, games/week, opponents,
-- reliability) on the fly from `ratings` + `game_participants` + `games`.
-- A materialized table would have to invalidate on every recompute, which is
-- racy with the rating-submission write path. Indexes are cheaper.
--
-- Schema is intentionally lean — no new tables / views.

-- Replay ELO chronologically for a given (rated_user_id, sport_id):
--   SELECT ... FROM ratings WHERE rated_user_id=$1 AND sport_id=$2
--          AND created_at >= now() - interval '90 days'
--     ORDER BY created_at ASC;
CREATE INDEX IF NOT EXISTS ratings_rated_sport_created_idx
  ON ratings (rated_user_id, sport_id, created_at);

-- Opponents distribution + games-per-week join through game_participants
-- by rater perspective (the viewer-as-rater, listing opponents they rated).
CREATE INDEX IF NOT EXISTS ratings_rater_sport_created_idx
  ON ratings (rater_user_id, sport_id, created_at);

-- The opponents query joins ratings → users to fetch display_name; the
-- existing users PK covers that path.

-- Down Migration --
DROP INDEX IF EXISTS ratings_rater_sport_created_idx;
DROP INDEX IF EXISTS ratings_rated_sport_created_idx;
