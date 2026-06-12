-- Up Migration --
--
-- Membership tiers — Free, Plus, Premium.
--
-- Every user gets exactly one row in `memberships` keyed by `user_id`. The
-- `tier` column drives the unlock matrix (unlimited bookings, ad-free,
-- early tournament access, coach-on-demand placeholder, custom badge);
-- the rest of the columns are Stripe-side bookkeeping the webhook
-- handler keeps in sync.
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
  -- Stripe Customer + Subscription identifiers. We don't reuse the
  -- `stripe_customers` table from the payments module because that one is
  -- owned by the Payments agent and might lag behind us — and the
  -- membership subscription has its own lifecycle independent of any
  -- booking PaymentIntents.
  stripe_customer_id     text             NULL,
  stripe_subscription_id text             NULL,
  current_period_end     timestamptz      NULL,
  cancel_at_period_end   boolean          NOT NULL DEFAULT false,
  updated_at             timestamptz      NOT NULL DEFAULT now()
);

CREATE INDEX memberships_tier_idx ON memberships (tier);
CREATE INDEX memberships_subscription_idx
  ON memberships (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

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
DROP INDEX IF EXISTS memberships_subscription_idx;
DROP INDEX IF EXISTS memberships_tier_idx;
DROP TABLE IF EXISTS memberships;
DROP TYPE  IF EXISTS membership_tier;
