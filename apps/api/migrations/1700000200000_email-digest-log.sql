-- Up Migration --
--
-- Email digest agent.
--
-- Adds two pieces of state:
--
--   1. `users.notification_preferences` (jsonb, default `{}`) — per-user
--      notification opt-ins. The digest agent reads `weekly_digest=true`;
--      other agents can extend the same blob without a fresh migration.
--      Defaulting to `{}` means existing accounts opt-in only when the iOS
--      client explicitly writes to the column (handled by the users module).
--
--   2. `email_digest_log` — append-only ledger of "we already sent the
--      Monday-09:00 digest to user X this week". The composite primary key
--      (`user_id`, `kind`, `sent_at::date`) is the idempotency guard: a
--      same-day re-run of `runWeeklyDigest()` cannot double-send because the
--      INSERT collides on the PK. `sent_at` is preserved at full timestamp
--      resolution for ops debugging — the PK uses the date projection so a
--      single retry inside the same day is the natural deduper.
--
-- The `kind` text column is open-coded rather than an enum so future digest
-- variants (daily summary, tournament reminders, …) can land without a
-- schema migration: the agent owns the semantics, the DB just dedupes.

ALTER TABLE users
  ADD COLUMN notification_preferences jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE email_digest_log (
  user_id  uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind     text        NOT NULL CHECK (char_length(kind) BETWEEN 1 AND 64),
  sent_at  timestamptz NOT NULL DEFAULT now(),
  -- Materialized calendar-day so the idempotency UNIQUE can live in a
  -- regular b-tree (casting timestamptz → date inside an index expression
  -- is non-IMMUTABLE because the result depends on the session TZ).
  sent_on  date        NOT NULL DEFAULT ((now() AT TIME ZONE 'UTC')::date),
  PRIMARY KEY (user_id, kind, sent_on)
);

-- "Which users got digest X today?" — the scheduler's idempotency probe.
CREATE INDEX email_digest_log_kind_sent_at_idx
  ON email_digest_log (kind, sent_at DESC);

-- Down Migration --

DROP INDEX IF EXISTS email_digest_log_kind_sent_at_idx;
DROP TABLE IF EXISTS email_digest_log;
ALTER TABLE users DROP COLUMN IF EXISTS notification_preferences;
