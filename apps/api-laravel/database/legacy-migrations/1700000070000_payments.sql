-- Up Migration --
-- Local payment tracking.
--
-- Court bookings store the local payment reference on bookings.external_ref.
-- Tournament entries use tournament_entry_payments to keep the pending payment
-- separate from active tournament entries until the app marks it succeeded.

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

-- Down Migration --
DROP TRIGGER IF EXISTS tournament_entry_payments_set_updated_at ON tournament_entry_payments;
DROP TABLE IF EXISTS tournament_entry_payments;
DROP TYPE  IF EXISTS tournament_entry_payment_status;
