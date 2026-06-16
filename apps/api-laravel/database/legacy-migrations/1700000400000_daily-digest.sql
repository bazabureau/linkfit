-- Up Migration --
--
-- Wave-10: Daily digest push sweeper.
--
-- Adds the two artefacts the smart-push scheduler needs:
--
--   1. `users.time_zone` — IANA tz string (e.g. "Asia/Baku"). The hourly
--      sweeper consults this to decide whether the user's local clock has
--      hit 18:00, which is the only hour we fire the daily digest. A
--      default of 'Asia/Baku' matches Linkfit's primary market so every
--      existing user starts out wired to the correct local 6pm without
--      a backfill.
--
--   2. `users.daily_digest_enabled` — boolean opt-out toggle. Defaults to
--      true (engagement wins out-of-the-box) but a single UPDATE flips
--      it off when the user disables the digest from the notification
--      preferences screen. Lives on `users` rather than the per-type
--      `notification_preferences` table because the digest isn't a
--      notification_type enum value — adding one would require a
--      cross-cutting enum migration (PG enums are append-only and the
--      iOS settings screen pins the existing 8 values).
--
--   3. `daily_digest_sent` — idempotency ledger keyed on (user_id, sent_date).
--      The sweeper INSERTs on a hit with ON CONFLICT DO NOTHING RETURNING *
--      so two overlapping ticks (or two pods racing) can't double-fire
--      for the same user on the same UTC date. `sent_date` is computed
--      in the sweeper from the user's LOCAL date — two users in different
--      time zones can both fire on the same UTC instant for "their" 18:00
--      without colliding on the PK.
--
-- All three artefacts are reversible — the down migration drops them.

ALTER TABLE users
  ADD COLUMN time_zone text NOT NULL DEFAULT 'Asia/Baku',
  ADD COLUMN daily_digest_enabled boolean NOT NULL DEFAULT true;

CREATE TABLE daily_digest_sent (
  user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- `sent_date` is the user's LOCAL calendar date the digest fired for —
  -- NOT the UTC date — so timezone math at insert time guarantees one
  -- digest per local day even when the sweeper runs across a UTC date
  -- boundary.
  sent_date  date        NOT NULL,
  sent_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, sent_date)
);

CREATE INDEX daily_digest_sent_user_idx ON daily_digest_sent (user_id);

-- Down Migration --

DROP INDEX IF EXISTS daily_digest_sent_user_idx;
DROP TABLE IF EXISTS daily_digest_sent;
ALTER TABLE users DROP COLUMN IF EXISTS daily_digest_enabled;
ALTER TABLE users DROP COLUMN IF EXISTS time_zone;
