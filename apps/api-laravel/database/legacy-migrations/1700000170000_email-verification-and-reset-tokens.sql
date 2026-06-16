-- Up Migration --
--
-- Email verification + password reset.
--
-- Adds `users.email_verified_at` so the iOS client can prompt unverified
-- accounts to confirm their address, and introduces `email_tokens` — a
-- single-purpose table of one-shot magic-link tokens used for both
-- verification ("verify") and password reset ("reset_password").
--
-- We store ONLY the sha256 of the token (`token_hash bytea UNIQUE`) so a
-- DB snapshot leak cannot be replayed against the API. `used_at` flips
-- atomically when the token is consumed; combined with `expires_at` this
-- gives us the standard one-shot, time-boxed magic-link semantics.

ALTER TABLE users
  ADD COLUMN email_verified_at timestamptz NULL;

CREATE TYPE email_token_kind AS ENUM ('verify', 'reset_password');

CREATE TABLE email_tokens (
  id          uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid              NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        email_token_kind  NOT NULL,
  token_hash  bytea             NOT NULL UNIQUE,
  expires_at  timestamptz       NOT NULL,
  used_at     timestamptz       NULL,
  created_at  timestamptz       NOT NULL DEFAULT now(),
  CONSTRAINT email_tokens_expiry_after_creation_chk CHECK (expires_at > created_at)
);

-- Lookup pattern for the "60s cool-down on resend" rule: find the most
-- recent unused token of a given kind for a given user.
CREATE INDEX email_tokens_user_kind_idx
  ON email_tokens (user_id, kind, created_at DESC);

-- Sweep dead tokens periodically without scanning the whole table.
CREATE INDEX email_tokens_expires_at_idx ON email_tokens (expires_at);

-- Down Migration --

DROP TABLE IF EXISTS email_tokens;
DROP TYPE  IF EXISTS email_token_kind;
ALTER TABLE users DROP COLUMN IF EXISTS email_verified_at;
