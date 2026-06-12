-- Up Migration --
--
-- Adds session-attribution metadata to `refresh_tokens` so we can power
-- the iOS "logged-in devices" screen at GET /api/v1/me/sessions.
--
--   * `user_agent`  — captured from the request `User-Agent` header at
--                     mint time. Free-form text; trimmed/truncated by
--                     the service. NULL when the caller didn't send one
--                     (e.g. background refresh from a non-browser client
--                     that strips it). Stored as text so we can render it
--                     unchanged on the device list.
--
--   * `last_used_at` — stamped to NOW() on (a) mint and (b) every
--                      successful refresh that consumes this row. Drives
--                      the "Last active …" line on the device list.
--                      NULL only on rows minted before this migration.
--
-- Strictly additive: existing rows get NULL on both columns, which the
-- service interprets as "unknown UA, last used unknown" — the row is
-- still listable and revocable.
--
-- The partial index on (user_id) WHERE revoked_at IS NULL keeps the
-- list endpoint a single seek even for users with long token-rotation
-- histories. The existing `refresh_tokens_user_idx` is full-table; this
-- one is small because typically <5 active sessions per user.

ALTER TABLE refresh_tokens
  ADD COLUMN user_agent   text        NULL,
  ADD COLUMN last_used_at timestamptz NULL;

CREATE INDEX refresh_tokens_user_active_idx
  ON refresh_tokens (user_id, created_at DESC)
  WHERE revoked_at IS NULL;

-- Down Migration ----------------------------------------------------------
DROP INDEX IF EXISTS refresh_tokens_user_active_idx;
ALTER TABLE refresh_tokens
  DROP COLUMN IF EXISTS last_used_at,
  DROP COLUMN IF EXISTS user_agent;
