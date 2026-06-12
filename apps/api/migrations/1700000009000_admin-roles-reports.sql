-- Up Migration --
-- Admin roles + user-submitted reports.
--
-- 1. `users.admin_role` opt-in column. NULL = regular user (the vast majority).
--    Values restricted to 'admin' or 'moderator' via CHECK so we don't grow a
--    sprawl of free-text role strings.
-- 2. `reports` table for user-submitted complaints about other users, games,
--    or messages. Lifecycle: pending → reviewed | dismissed. Notes + reviewer
--    captured for an audit trail (orthogonal to audit_log, which logs the
--    moderator's actions; reports capture the user's claim).
-- 3. Seed: if no admin currently exists, promote the oldest registered user.
--    Idempotent — running twice never demotes anyone or flips an existing one.

ALTER TABLE users
  ADD COLUMN admin_role text NULL
    CHECK (admin_role IS NULL OR admin_role IN ('admin', 'moderator'));

-- Fast lookup of staff users for /admin endpoints.
CREATE INDEX users_admin_role_idx ON users (admin_role)
  WHERE admin_role IS NOT NULL;

CREATE TYPE report_target_kind AS ENUM ('user', 'game', 'message');
CREATE TYPE report_status      AS ENUM ('pending', 'reviewed', 'dismissed');

CREATE TABLE reports (
  id                  uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_user_id    uuid              NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_kind         report_target_kind NOT NULL,
  -- We don't FK target_id because it points across three different tables.
  -- Service layer validates existence at create time.
  target_id           uuid              NOT NULL,
  reason              text              NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 2000),
  status              report_status     NOT NULL DEFAULT 'pending',
  notes               text              NULL,
  reviewed_by_user_id uuid              NULL REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at         timestamptz       NULL,
  created_at          timestamptz       NOT NULL DEFAULT now(),
  CONSTRAINT reports_reviewed_consistency_chk CHECK (
    (status = 'pending'  AND reviewed_at IS NULL  AND reviewed_by_user_id IS NULL)
    OR
    (status IN ('reviewed','dismissed') AND reviewed_at IS NOT NULL)
  )
);

-- Primary admin-panel query: "show me pending reports newest first".
CREATE INDEX reports_status_created_idx
  ON reports (status, created_at DESC);
CREATE INDEX reports_reporter_idx
  ON reports (reporter_user_id, created_at DESC);
CREATE INDEX reports_target_idx
  ON reports (target_kind, target_id);

-- Seed: promote oldest user to admin if no admin exists yet.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE admin_role = 'admin') THEN
    UPDATE users
       SET admin_role = 'admin'
     WHERE id = (
       SELECT id FROM users
        WHERE deleted_at IS NULL
        ORDER BY created_at ASC
        LIMIT 1
     );
  END IF;
END $$;

-- Down Migration --
DROP INDEX IF EXISTS reports_target_idx;
DROP INDEX IF EXISTS reports_reporter_idx;
DROP INDEX IF EXISTS reports_status_created_idx;
DROP TABLE IF EXISTS reports;
DROP TYPE  IF EXISTS report_status;
DROP TYPE  IF EXISTS report_target_kind;
DROP INDEX IF EXISTS users_admin_role_idx;
ALTER TABLE users DROP COLUMN IF EXISTS admin_role;
