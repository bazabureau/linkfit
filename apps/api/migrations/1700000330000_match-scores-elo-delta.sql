-- Up Migration --
--
-- Adds `match_scores.elo_delta_by_user` so the iOS `FinalResultCard` can
-- surface the post-match ELO change next to each participant (e.g. "+18" /
-- "-12"). Without this column the iOS slot is always nil because the wire
-- shape (`MatchScoreSchema`) doesn't expose per-user rating movement.
--
-- Why JSONB and not a side table:
--   * The cardinality is tiny (max ~8 entries for a doubles padel match).
--   * Reads always co-occur with the rest of the match_scores row — a side
--     table would force a join on every GET /scoring.
--   * Writes happen once, atomically, alongside the player_sport_stats UPDATE
--     in `RatingsService.recomputeForGame`. A JSON map on the same row keeps
--     the write inside the existing transaction without an extra round trip.
--   * The map shape (`{ "<user_uuid>": <delta_int> }`) is decode-friendly for
--     iOS: it can lookup the current user's delta in O(1).
--
-- Default of `{}` (not NULL) so the column is always a valid JSON object —
-- iOS can `decode([String: Int].self)` without a NULL branch. Existing rows
-- inherit `{}`; the field stays empty until the ratings flow recomputes for
-- that game (matches the legacy behavior of "no delta yet visible").

ALTER TABLE match_scores
  ADD COLUMN elo_delta_by_user jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Down Migration --
ALTER TABLE match_scores DROP COLUMN IF EXISTS elo_delta_by_user;
