-- Up Migration --

-- Device tokens table — stores APNs/FCM push tokens registered by clients.
-- One row per (user, token) pair. Tokens are NOT user-private secrets but they
-- are device identifiers; we soft-delete via `revoked_at` so we keep an audit
-- trail when a user signs out or an APNs feedback round marks one expired.

CREATE TYPE device_platform AS ENUM ('ios', 'android');

CREATE TABLE device_tokens (
  id          uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid             NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       text             NOT NULL CHECK (char_length(token) BETWEEN 8 AND 512),
  platform    device_platform  NOT NULL,
  last_seen   timestamptz      NOT NULL DEFAULT now(),
  revoked_at  timestamptz      NULL,
  created_at  timestamptz      NOT NULL DEFAULT now()
);

-- A device token is globally unique per user. If the same physical device
-- re-installs the app, the new (user, token) pair is a fresh row; the old
-- one stays until APNs reports the token unregistered.
CREATE UNIQUE INDEX device_tokens_user_token_uq
  ON device_tokens (user_id, token);

-- Fanout lookup: "give me every active token for this user".
CREATE INDEX device_tokens_user_active_idx
  ON device_tokens (user_id)
  WHERE revoked_at IS NULL;

-- Down Migration ----------------------------------------------------------
DROP INDEX IF EXISTS device_tokens_user_active_idx;
DROP INDEX IF EXISTS device_tokens_user_token_uq;
DROP TABLE IF EXISTS device_tokens;
DROP TYPE  IF EXISTS device_platform;
