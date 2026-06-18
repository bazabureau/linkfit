-- Up Migration --

ALTER TABLE email_tokens
  ADD COLUMN attempts integer NOT NULL DEFAULT 0;

ALTER TABLE email_tokens
  ADD CONSTRAINT email_tokens_attempts_nonnegative_chk CHECK (attempts >= 0);

-- Six-digit verification codes are user-scoped, not globally unique. Keep a
-- lookup index for password-reset hashes, but remove the old global uniqueness
-- constraint that was safe only for opaque random tokens.
ALTER TABLE email_tokens
  DROP CONSTRAINT IF EXISTS email_tokens_token_hash_key;

CREATE INDEX IF NOT EXISTS email_tokens_kind_token_hash_idx
  ON email_tokens (kind, token_hash);

-- Down Migration --

DROP INDEX IF EXISTS email_tokens_kind_token_hash_idx;

ALTER TABLE email_tokens
  ADD CONSTRAINT email_tokens_token_hash_key UNIQUE (token_hash);

ALTER TABLE email_tokens
  DROP CONSTRAINT IF EXISTS email_tokens_attempts_nonnegative_chk;

ALTER TABLE email_tokens
  DROP COLUMN IF EXISTS attempts;
