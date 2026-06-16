-- Up Migration --
-- Reports module: tighten the schema to support the moderation flow.
--
-- 1. Replace the free-text `reason` column with a controlled enum so the
--    iOS client can show stable preset chips and the backend can do
--    threshold-based auto-flagging by reason category. Existing rows are
--    bucketed into 'other' — they were free-form notes already.
-- 2. Move what used to be the `reason` free text into `notes` for anything
--    a user wants to explain. We add no new column — `notes` already exists
--    and was previously admin-only; now it's a shared field (the user's
--    submission notes if any; the reviewer's note on review).
-- 3. Add an index on (target_kind, target_id, status) so the auto-flag
--    pre-check ("does this target already have 3+ pending reports?") is a
--    single index hit.
--
-- Why a new migration instead of editing the old one: the production DB has
-- already run 1700000009000 with the text column. node-pg-migrate is a
-- one-way migration runner; we lay a follow-up on top.

CREATE TYPE report_reason AS ENUM (
  'spam',
  'harassment',
  'no_show',
  'fake_profile',
  'inappropriate_content',
  'other'
);

-- Existing reason values are arbitrary text. Park them into a separate
-- column so the audit trail isn't lost, then collapse them all to 'other'
-- on the enum side.
ALTER TABLE reports
  ADD COLUMN reason_text text NULL;

UPDATE reports SET reason_text = reason;

ALTER TABLE reports
  DROP COLUMN reason;

ALTER TABLE reports
  ADD COLUMN reason report_reason NOT NULL DEFAULT 'other';

ALTER TABLE reports
  ALTER COLUMN reason DROP DEFAULT;

-- For each historical row, attach the original free-text reason to notes
-- (preserving anything the moderator may have already written).
UPDATE reports
   SET notes = COALESCE(notes, '') ||
       CASE
         WHEN notes IS NULL OR notes = '' THEN reason_text
         ELSE E'\n---\n' || reason_text
       END
 WHERE reason_text IS NOT NULL AND reason_text <> '';

ALTER TABLE reports DROP COLUMN reason_text;

CREATE INDEX reports_target_status_idx
  ON reports (target_kind, target_id, status);

-- Down Migration --
DROP INDEX IF EXISTS reports_target_status_idx;
ALTER TABLE reports
  ADD COLUMN reason_text text NULL;
UPDATE reports SET reason_text = reason::text;
ALTER TABLE reports DROP COLUMN reason;
ALTER TABLE reports
  ADD COLUMN reason text NOT NULL DEFAULT 'other'
  CHECK (char_length(reason) BETWEEN 1 AND 2000);
UPDATE reports SET reason = COALESCE(reason_text, 'other');
ALTER TABLE reports ALTER COLUMN reason DROP DEFAULT;
ALTER TABLE reports DROP COLUMN reason_text;
DROP TYPE IF EXISTS report_reason;
