-- Up Migration --
-- Stripe payment plumbing.
--
-- Court bookings: the booking row already exists in pending_payment status
-- when we mint a PaymentIntent. The intent id is stored back on the booking
-- via external_ref (column exists in 1700000005000). The webhook flips the
-- booking to paid via the existing BookingsService.markPaid() flow.
--
-- Tournament entries: the entry row does NOT exist when the user pays. We
-- cannot insert a pending entry because the active-row capacity check would
-- consume a squad slot. Instead we stash PaymentIntent metadata in
-- tournament_entry_payments and the webhook materializes the entry on
-- payment_intent.succeeded.

CREATE TABLE stripe_customers (
  user_id            uuid        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id text        NOT NULL UNIQUE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER stripe_customers_set_updated_at
  BEFORE UPDATE ON stripe_customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TYPE tournament_entry_payment_status AS ENUM (
  'pending',
  'succeeded',
  'failed'
);

CREATE TABLE tournament_entry_payments (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id       uuid        NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  captain_user_id     uuid        NOT NULL REFERENCES users(id)       ON DELETE RESTRICT,
  payment_intent_id   text        NOT NULL UNIQUE,
  amount_minor        integer     NOT NULL CHECK (amount_minor >= 0),
  currency            char(3)     NOT NULL,
  squad_name          text        NOT NULL,
  player_ids          uuid[]      NOT NULL DEFAULT '{}',
  status              tournament_entry_payment_status NOT NULL DEFAULT 'pending',
  entry_id            uuid        NULL REFERENCES tournament_entries(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  succeeded_at        timestamptz NULL
);

CREATE INDEX tournament_entry_payments_tournament_idx
  ON tournament_entry_payments (tournament_id);
CREATE INDEX tournament_entry_payments_captain_idx
  ON tournament_entry_payments (captain_user_id);
CREATE INDEX tournament_entry_payments_status_idx
  ON tournament_entry_payments (status);

CREATE TRIGGER tournament_entry_payments_set_updated_at
  BEFORE UPDATE ON tournament_entry_payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE stripe_webhook_events (
  id            text        PRIMARY KEY,
  type          text        NOT NULL,
  processed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX stripe_webhook_events_type_idx
  ON stripe_webhook_events (type);

-- Down Migration --
DROP TABLE IF EXISTS stripe_webhook_events;
DROP TRIGGER IF EXISTS tournament_entry_payments_set_updated_at ON tournament_entry_payments;
DROP TABLE IF EXISTS tournament_entry_payments;
DROP TYPE  IF EXISTS tournament_entry_payment_status;
DROP TRIGGER IF EXISTS stripe_customers_set_updated_at ON stripe_customers;
DROP TABLE IF EXISTS stripe_customers;
