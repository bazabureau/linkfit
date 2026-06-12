-- Up Migration --
-- Notification preferences. Per-user toggle for whether each notification
-- type triggers an APNs push. The in-app row + SSE realtime delivery is
-- ALWAYS done — the notifications screen (and live chat ping) needs them
-- to stay coherent. Only the push channel is user-togglable here.
--
-- Design notes:
--   - One row per (user_id, type) when the user has overridden the default.
--     Absence of a row means "use the application default" (see
--     `defaultPushEnabledForType` in TS). This keeps the table small —
--     90%+ of users will have zero rows — and it makes migrations of the
--     default policy a code change instead of a 1M-row backfill.
--   - `push_enabled` is the only knob today. The schema reserves room for
--     `email_enabled` and `in_app_enabled` in case we ever add per-type
--     email digests or want to suppress in-app cards too.
--   - `quiet_hours_*` live on the `users` table (separate concern — global,
--     not per-type) to avoid duplicating the same values N times per user.

CREATE TABLE notification_preferences (
  user_id          uuid              NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type             notification_type NOT NULL,
  push_enabled     boolean           NOT NULL,
  email_enabled    boolean           NOT NULL DEFAULT true,
  in_app_enabled   boolean           NOT NULL DEFAULT true,
  updated_at       timestamptz       NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, type)
);

CREATE INDEX notification_preferences_user_idx
  ON notification_preferences (user_id);

-- Quiet hours — global per-user "don't push between these UTC hours".
-- Stored as nullable smallints (0–23). When both are NULL there is no
-- quiet window; setting them creates a window that may wrap midnight
-- (e.g. start=22, end=8 → 22:00–08:00 UTC).
--
-- We keep this on `users` rather than its own table because:
--   - it's exactly one row per user (1:1)
--   - it's read on every push attempt → cheaper to fetch alongside the
--     existing user-row reads than a second round-trip
ALTER TABLE users
  ADD COLUMN quiet_hours_start smallint NULL CHECK (quiet_hours_start IS NULL OR (quiet_hours_start >= 0 AND quiet_hours_start <= 23)),
  ADD COLUMN quiet_hours_end   smallint NULL CHECK (quiet_hours_end   IS NULL OR (quiet_hours_end   >= 0 AND quiet_hours_end   <= 23));

-- Either both NULL or both populated — half-set is meaningless and would
-- complicate the "is now inside quiet hours" check.
ALTER TABLE users
  ADD CONSTRAINT users_quiet_hours_paired_chk
  CHECK ((quiet_hours_start IS NULL) = (quiet_hours_end IS NULL));

-- Down Migration --
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_quiet_hours_paired_chk;
ALTER TABLE users DROP COLUMN IF EXISTS quiet_hours_end;
ALTER TABLE users DROP COLUMN IF EXISTS quiet_hours_start;
DROP INDEX IF EXISTS notification_preferences_user_idx;
DROP TABLE IF EXISTS notification_preferences;
