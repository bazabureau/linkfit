-- Up Migration --

-- Original migration (1700000007000) created `messages.body` with a strict
-- `CHECK (char_length(body) BETWEEN 1 AND 4000)`. A follow-up
-- (1700000008000) added attachments and an OR-check meant to allow
-- attachment-only messages — but it never dropped the inline CHECK from the
-- column definition, so the column constraint always wins and empty-body +
-- attachment writes still fail at the DB. This migration drops the obsolete
-- column-level CHECK and replaces it with a single named, length-only CHECK
-- on the table; the OR-content rule from 1700000008000 already covers
-- presence.

-- Postgres auto-names column-inline CHECKs as "<table>_<column>_check".
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_body_check;

-- Keep the upper bound to defend against runaway payloads.
ALTER TABLE messages
  ADD CONSTRAINT messages_body_length_chk
    CHECK (char_length(body) <= 4000);

-- Down Migration --
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_body_length_chk;
ALTER TABLE messages
  ADD CONSTRAINT messages_body_check
    CHECK (char_length(body) BETWEEN 1 AND 4000);
