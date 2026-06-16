-- User-blocks table. Powers the "block this player" gesture
-- surfaced from ProfileView's overflow menu (FAZA 61.5).
--
-- Semantics:
--   * If A blocks B, neither user should see the other in any
--     discovery surface (players list, search, feed).
--   * Existing follow edges are removed on block (handled in
--     application code, not via FK cascade — we keep the audit row
--     in the `blocks` table even if the underlying users are later
--     deleted).
--   * Blocks are unilateral: B may still see content created by A
--     in private contexts they were already party to (e.g. games
--     they both joined before the block) but cannot initiate a new
--     conversation, follow, or invite.
--   * `created_at` is the canonical event time. Reads need to be
--     fast since we filter every discovery list against the
--     blocked-set — see the composite index below.

CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (blocker_user_id, blocked_user_id),
  CHECK (blocker_user_id <> blocked_user_id)
);

-- Reverse lookup (who blocked me?) — needed when filtering A's
-- listings to hide users who have blocked A.
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked
  ON user_blocks (blocked_user_id);
