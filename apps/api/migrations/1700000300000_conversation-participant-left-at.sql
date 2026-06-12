-- Up Migration --
--
-- Adds soft-delete column `left_at` to conversation_participants so a user
-- can "leave" / hide a conversation from THEIR inbox without nuking the
-- thread for the other party. The conversation list endpoint filters on
-- `left_at IS NULL`; the participant row itself is kept so:
--   * the conversation's messages history remains intact for everyone else
--   * we have an audit trail of when the user stepped out
--   * `getOrCreateWith` can resurrect the row (set left_at = NULL) instead
--     of inserting a duplicate and tripping the PK
--
-- This is strictly additive: existing rows get NULL (i.e. still in-inbox),
-- so no behavioural change for any participant who hasn't left.

ALTER TABLE conversation_participants
  ADD COLUMN left_at timestamptz NULL;

-- The conversation list endpoint joins conversation_participants for the
-- viewer and filters on `left_at IS NULL`. A partial index keeps that
-- query fast even on large user inboxes — index size stays small because
-- the typical fleet has almost no left-rows.
CREATE INDEX conversation_participants_active_idx
  ON conversation_participants (user_id, conversation_id)
  WHERE left_at IS NULL;

-- Down Migration ----------------------------------------------------------
DROP INDEX IF EXISTS conversation_participants_active_idx;
ALTER TABLE conversation_participants DROP COLUMN IF EXISTS left_at;
