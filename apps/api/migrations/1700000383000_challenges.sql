-- Up Migration --
-- Daily challenges (Wave-10): gamified engagement loop. Every user gets 3
-- small per-day challenges drawn from a rotating pool of 6 codes. Each
-- challenge is a (user_id, challenge_code, date) triple; `completed_at`
-- moves from NULL to NOW() the moment the server side-effect that the
-- code represents lands (follow created, game joined, story posted, etc).
--
-- Why a dedicated table instead of deriving from existing tables:
--   - The pool of "today's three" is generated once per user per day. If
--     we tried to derive from sources we'd need a deterministic shuffle
--     keyed on (user_id, date) every read AND we'd have no place to
--     stamp completion-time independently of the underlying action.
--   - Completion is sticky: completing "follow_one" today should not
--     re-arm tomorrow just because the user didn't follow anyone new on
--     Tuesday. The DATE column scopes the lifetime exactly to one local
--     day, and the `(user_id, challenge_code, date)` unique key makes
--     re-issue across days clean while keeping today idempotent.
--   - The auto-completion hooks (FollowsService, GamesService, etc.) all
--     UPDATE this table on each user action with a guarded WHERE clause
--     (`completed_at IS NULL AND date = CURRENT_DATE`). That keeps the
--     hot-path action services from caring whether a challenge is even
--     issued today — the no-op UPDATE is cheap.
--
-- Why no FK on `challenge_code`:
--   - The catalog of codes is a static enum in the service code (see
--     `challenges.service.ts`). Adding/removing a code is a code change,
--     not a data migration. A separate catalog table would force a
--     two-step deploy for every adjustment and gain us nothing — there's
--     no extra metadata to attach (titles/icons are AZ-localized on iOS).

CREATE TABLE IF NOT EXISTS user_challenges (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- One of: follow_one, join_a_game, post_a_story, comment_on_feed,
  -- invite_to_game, react_to_story. Enforced at the service layer, not in
  -- SQL — see migration header for rationale.
  challenge_code  TEXT         NOT NULL,
  -- The user's local calendar day this challenge belongs to. We accept
  -- the small skew across timezones in exchange for the simplicity of a
  -- per-user-per-day key — the iOS client renders relative-to-now so
  -- there's no user-visible boundary that has to match a TZ-aware cron.
  date            DATE         NOT NULL,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, challenge_code, date)
);

-- Lookup pattern is always "give me today's three challenges for this
-- user". The composite index keys exactly that path and stays small
-- because old rows are purged by the sweeper (or simply remain inert —
-- the read filters by `date = CURRENT_DATE`).
CREATE INDEX IF NOT EXISTS user_challenges_user_date_idx
  ON user_challenges(user_id, date);

-- Down Migration --
DROP INDEX IF EXISTS user_challenges_user_date_idx;
DROP TABLE IF EXISTS user_challenges;
