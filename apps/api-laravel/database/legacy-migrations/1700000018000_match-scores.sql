-- Up Migration --
--
-- Live-during-the-match scoring (Scoring agent). One row per game, keyed on
-- `game_id`. Padel-specific rules live in the application layer; this table
-- is shape-only — sets are a jsonb array of `{ a: int, b: int }` games, and
-- `current_game_a` / `current_game_b` track the in-progress set's score.
--
-- Why a single row, not point-by-point append-only:
--   • The "live" surface refetches every 5s with GET /scoring; one row read
--     beats stitching a points log every poll.
--   • Undo is O(1) — we keep a small in-app history buffer and rewind, no
--     SQL paging required.
--   • Final state feeds the rating flow as `{team_a_won: bool}` derived
--     from set count — no join.

CREATE TYPE match_score_status AS ENUM ('in_progress', 'completed');

CREATE TABLE match_scores (
  game_id           uuid               PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  team_a_user_ids   uuid[]             NOT NULL,
  team_b_user_ids   uuid[]             NOT NULL,
  -- Each element looks like `{"a": 6, "b": 4}`. Index N is set N+1.
  -- Tiebreaks are recorded as the games score (e.g. 7-6) plus an optional
  -- `tb` object `{"a": 7, "b": 5}` if we ever want to surface the tb score.
  sets              jsonb              NOT NULL DEFAULT '[]'::jsonb,
  -- Chronological list of points as a jsonb array of "a"|"b" strings.
  -- We keep this so `undo` can rewind by replaying. Capped in app logic
  -- to a few hundred entries — well within jsonb's comfort zone.
  points            jsonb              NOT NULL DEFAULT '[]'::jsonb,
  -- 0-indexed pointer into a virtual sets array (the in-progress set isn't
  -- yet committed to `sets`). Caps at 2 for best-of-3.
  current_set       smallint           NOT NULL DEFAULT 0 CHECK (current_set BETWEEN 0 AND 2),
  current_game_a    smallint           NOT NULL DEFAULT 0 CHECK (current_game_a BETWEEN 0 AND 7),
  current_game_b    smallint           NOT NULL DEFAULT 0 CHECK (current_game_b BETWEEN 0 AND 7),
  -- Point counters. 0/15/30/40 encoded as 0/1/2/3; deuce-or-greater encoded
  -- as 3+adv, with 4 meaning "advantage A" (when point_b == 3) etc. For
  -- tiebreak games we just keep raw integers — game-end logic handles both.
  point_a           smallint           NOT NULL DEFAULT 0 CHECK (point_a BETWEEN 0 AND 99),
  point_b           smallint           NOT NULL DEFAULT 0 CHECK (point_b BETWEEN 0 AND 99),
  status            match_score_status NOT NULL DEFAULT 'in_progress',
  started_at        timestamptz        NOT NULL DEFAULT now(),
  completed_at      timestamptz        NULL,
  updated_at        timestamptz        NOT NULL DEFAULT now(),
  CONSTRAINT match_scores_teams_nonempty CHECK (
    array_length(team_a_user_ids, 1) >= 1 AND array_length(team_b_user_ids, 1) >= 1
  )
);

CREATE INDEX match_scores_status_idx ON match_scores (status);

CREATE TRIGGER match_scores_set_updated_at
  BEFORE UPDATE ON match_scores
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration --
DROP TRIGGER IF EXISTS match_scores_set_updated_at ON match_scores;
DROP INDEX  IF EXISTS match_scores_status_idx;
DROP TABLE  IF EXISTS match_scores;
DROP TYPE   IF EXISTS match_score_status;
