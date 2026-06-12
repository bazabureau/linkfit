-- Up Migration --
-- Users + rotating refresh-token table with family-based reuse detection.

CREATE TABLE users (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email           citext      NOT NULL UNIQUE,
  password_hash   text        NOT NULL,
  display_name    text        NOT NULL,
  photo_url       text        NULL,
  home_lat        numeric(9, 6) NULL,
  home_lng        numeric(9, 6) NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz NULL,
  CONSTRAINT users_email_format_chk        CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  CONSTRAINT users_display_name_length_chk CHECK (char_length(display_name) BETWEEN 1 AND 80),
  CONSTRAINT users_home_lat_range_chk      CHECK (home_lat IS NULL OR (home_lat BETWEEN -90  AND 90)),
  CONSTRAINT users_home_lng_range_chk      CHECK (home_lng IS NULL OR (home_lng BETWEEN -180 AND 180))
);

-- Partial index: ignore soft-deleted rows in active-user lookups
CREATE INDEX users_active_idx ON users (id) WHERE deleted_at IS NULL;

-- Auto-update updated_at on row write
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Refresh tokens: each row is one token; rotation creates a new row in the
-- same `family_id` and revokes the old row. If a revoked token is ever
-- presented for refresh, the entire family is revoked (theft response).
CREATE TABLE refresh_tokens (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- sha256(opaque token string) — 32 bytes. We never store the token itself.
  token_hash      bytea       NOT NULL UNIQUE,
  family_id       uuid        NOT NULL,
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz NULL,
  replaced_by     uuid        NULL REFERENCES refresh_tokens(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT refresh_tokens_expiry_after_creation_chk CHECK (expires_at > created_at)
);

CREATE INDEX refresh_tokens_user_idx        ON refresh_tokens (user_id);
CREATE INDEX refresh_tokens_family_idx      ON refresh_tokens (family_id);
CREATE INDEX refresh_tokens_expires_at_idx  ON refresh_tokens (expires_at);

-- Down Migration --
DROP TABLE IF EXISTS refresh_tokens;
DROP TRIGGER IF EXISTS users_set_updated_at ON users;
DROP FUNCTION IF EXISTS set_updated_at();
DROP INDEX IF EXISTS users_active_idx;
DROP TABLE IF EXISTS users;
