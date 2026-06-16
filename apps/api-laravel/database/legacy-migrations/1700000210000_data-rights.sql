-- Up Migration --
--
-- GDPR data-rights module. Two new tables:
--
--   * data_export_requests    — user-initiated JSON dump of all their data.
--     Each request goes through queued -> processing -> ready|failed; on
--     success `download_url` points at a one-off file we expose under
--     /uploads/data-exports/<filename>.json and `expires_at` is +7 days
--     from completion. A small inline worker walks every owning module's
--     tables in `data-rights.service.ts` and writes the JSON file out.
--
--   * account_deletion_requests — schedules a hard delete in +30 days. The
--     row is keyed PK on `user_id` because each account can only be in one
--     deletion state at a time. When the user calls /delete we also set
--     `users.deleted_at` and anonymize their PII immediately so they
--     effectively disappear from the product right away — the 30-day window
--     just keeps the rows around so a /delete/cancel call can undo it
--     before an out-of-band purge job hard-deletes for real. The purge job
--     itself is not in scope for this migration (it'll be a cron sweeper
--     reading `hard_delete_at <= now() AND status = 'scheduled'`).

CREATE TYPE data_export_status AS ENUM ('queued', 'processing', 'ready', 'failed');

CREATE TABLE data_export_requests (
  id            uuid                 PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid                 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        data_export_status   NOT NULL DEFAULT 'queued',
  -- Populated when status flips to 'ready'. Absolute URL the iOS client
  -- can hand straight to URLSession / a share sheet.
  download_url  text                 NULL,
  -- Always populated at insert time (created_at + 7 days). We expose the
  -- value to clients so they can show a countdown; the actual purge of the
  -- on-disk file is done by the same out-of-band sweeper as account purges.
  expires_at    timestamptz          NOT NULL,
  created_at    timestamptz          NOT NULL DEFAULT now(),
  completed_at  timestamptz          NULL,
  CONSTRAINT data_export_requests_expiry_chk
    CHECK (expires_at > created_at)
);

-- "What's my most recent export?" — driven by the iOS DataRightsView when
-- it opens. Also feeds the per-user rate limit ("at most one queued/processing
-- request and at most one export per hour").
CREATE INDEX data_export_requests_user_idx
  ON data_export_requests (user_id, created_at DESC);

-- The sweeper finds expired files by scanning this in order.
CREATE INDEX data_export_requests_expires_at_idx
  ON data_export_requests (expires_at)
  WHERE status = 'ready';

CREATE TYPE account_deletion_status AS ENUM ('scheduled', 'cancelled', 'completed');

CREATE TABLE account_deletion_requests (
  -- PK on user_id: an account is either scheduled-to-delete, or it isn't.
  -- If the user cancels and then re-requests, we UPDATE the row in place.
  user_id        uuid                       PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  requested_at   timestamptz                NOT NULL DEFAULT now(),
  -- Always +30 days from `requested_at` at insertion time. The out-of-band
  -- purge job (not in scope here) picks up rows where status='scheduled'
  -- and hard_delete_at <= now() and tears the account down for real.
  hard_delete_at timestamptz                NOT NULL,
  status         account_deletion_status    NOT NULL DEFAULT 'scheduled',
  cancelled_at   timestamptz                NULL,
  completed_at   timestamptz                NULL,
  CONSTRAINT account_deletion_window_chk
    CHECK (hard_delete_at > requested_at)
);

-- Scheduled-deletes that are ripe for the purge sweeper.
CREATE INDEX account_deletion_requests_due_idx
  ON account_deletion_requests (hard_delete_at)
  WHERE status = 'scheduled';

-- Down Migration --
DROP INDEX IF EXISTS account_deletion_requests_due_idx;
DROP TABLE IF EXISTS account_deletion_requests;
DROP TYPE  IF EXISTS account_deletion_status;
DROP INDEX IF EXISTS data_export_requests_expires_at_idx;
DROP INDEX IF EXISTS data_export_requests_user_idx;
DROP TABLE IF EXISTS data_export_requests;
DROP TYPE  IF EXISTS data_export_status;
