-- Up Migration --
--
-- Membership tiers — Free, Plus, Premium.
--
-- Every user gets exactly one row in `memberships` keyed by `user_id`. The
-- `tier` column drives the unlock matrix (unlimited bookings, ad-free,
-- early tournament access, coach-on-demand placeholder, custom badge).
--
-- The row is created with `tier='free'` for every existing user as part
-- of this migration AND for every future user via a backfill insert in
-- the application service (the membership row is created lazily on first
-- read so we don't need to touch the auth flow). Either path is
-- idempotent because (user_id) is the primary key.

CREATE TYPE membership_tier AS ENUM ('free', 'plus', 'premium');

CREATE TABLE memberships (
  user_id                uuid             PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tier                   membership_tier  NOT NULL DEFAULT 'free',
  current_period_end     timestamptz      NULL,
  cancel_at_period_end   boolean          NOT NULL DEFAULT false,
  updated_at             timestamptz      NOT NULL DEFAULT now()
);

CREATE INDEX memberships_tier_idx ON memberships (tier);

CREATE TRIGGER memberships_set_updated_at
  BEFORE UPDATE ON memberships
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Backfill: every existing user gets a default `free` row. We use
-- `ON CONFLICT DO NOTHING` so re-runs are harmless and so a future user
-- inserted between CREATE TABLE and this INSERT doesn't cause a race.
INSERT INTO memberships (user_id, tier)
  SELECT id, 'free'::membership_tier FROM users
  ON CONFLICT (user_id) DO NOTHING;

-- Down Migration --
DROP TRIGGER IF EXISTS memberships_set_updated_at ON memberships;
DROP INDEX IF EXISTS memberships_tier_idx;
DROP TABLE IF EXISTS memberships;
DROP TYPE  IF EXISTS membership_tier;
