-- Up Migration --
-- Add OAuth provider linkage columns (Sign in with Apple + Google).
-- Each column is the provider's stable subject identifier (`sub` claim).
--
-- A user may have NEITHER a password_hash NOR an OAuth `sub` only if they
-- were soft-deleted later; we drop the NOT NULL on password_hash because
-- OAuth-only signups never hold a credential locally. Email uniqueness is
-- still enforced via the existing UNIQUE constraint on users.email.

ALTER TABLE users
  ALTER COLUMN password_hash DROP NOT NULL;

ALTER TABLE users
  ADD COLUMN apple_sub  text NULL,
  ADD COLUMN google_sub text NULL;

-- Partial unique indexes — soft-deleted rows are excluded so we can recycle
-- a sub if a user ever re-registers under a new row (very edge case).
CREATE UNIQUE INDEX users_apple_sub_unique_idx
  ON users (apple_sub)
  WHERE apple_sub IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX users_google_sub_unique_idx
  ON users (google_sub)
  WHERE google_sub IS NOT NULL AND deleted_at IS NULL;

-- Down Migration --
DROP INDEX IF EXISTS users_google_sub_unique_idx;
DROP INDEX IF EXISTS users_apple_sub_unique_idx;
ALTER TABLE users DROP COLUMN IF EXISTS google_sub;
ALTER TABLE users DROP COLUMN IF EXISTS apple_sub;
-- We don't restore NOT NULL on password_hash on rollback — OAuth-created
-- rows may legitimately have NULL there and would block the restore.
