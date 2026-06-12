-- Trust & safety: signup-side IP throttling + account-level suspicion flag.
--
-- Two artefacts:
--
--   1. `signup_attempts` — append-only log of every registration attempt
--      keyed on the source IP. The spam-checks layer reads back the count
--      inside the trailing 24h window before each new signup and rejects
--      the 6th (default `SIGNUP_RATE_LIMIT_PER_DAY=5`).
--
--      The TTL is implicit: rows older than 24h are inert (the count query
--      filters on `attempted_at > NOW() - INTERVAL '24 hours'`). A nightly
--      reaper job can DELETE older rows; until then the table grows roughly
--      O(daily-signups). Cheap at any realistic Linkfit scale.
--
--   2. `users.flagged_for_review` — boolean flag set by suspicious-activity
--      detectors (e.g. the follow-burst tripwire in `social/follows.service`).
--      Surfaces to admin review without blocking the account outright; the
--      service layer reads this column when deciding whether to silently
--      rate-limit further high-frequency social actions.
--
-- Both pieces are owned by `shared/security/spam-checks.ts`.

CREATE TABLE IF NOT EXISTS signup_attempts (
  ip            TEXT        NOT NULL,
  attempted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index drives the per-IP-in-last-24h count. Reverse on attempted_at so
-- the scan stops as soon as it walks past the window boundary.
CREATE INDEX IF NOT EXISTS idx_signup_attempts_ip_recent
  ON signup_attempts (ip, attempted_at DESC);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS flagged_for_review BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index — most rows are FALSE; we only scan the flagged set when
-- the admin review queue endpoint runs.
CREATE INDEX IF NOT EXISTS idx_users_flagged_for_review
  ON users (id) WHERE flagged_for_review = TRUE;
