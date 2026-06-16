-- Up Migration --
-- Phase 2 schema. Endpoints are NOT implemented yet, but the schema lives
-- here so we never paint ourselves into a corner with games / courts foreign
-- keys later.

CREATE TYPE booking_status AS ENUM (
  'pending_payment',
  'partially_paid',
  'paid',
  'cancelled',
  'refunded',
  'failed'
);

CREATE TYPE payment_split_status AS ENUM (
  'pending',
  'authorized',
  'captured',
  'refunded',
  'failed'
);

CREATE TABLE bookings (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id         uuid        NOT NULL UNIQUE REFERENCES games(id) ON DELETE RESTRICT,
  court_id        uuid        NOT NULL REFERENCES courts(id) ON DELETE RESTRICT,
  total_minor     integer     NOT NULL CHECK (total_minor >= 0),
  currency        char(3)     NOT NULL,
  status          booking_status NOT NULL DEFAULT 'pending_payment',
  idempotency_key text        NOT NULL UNIQUE,
  external_ref    text        NULL,  -- local/external payment reference
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  paid_at         timestamptz NULL,
  cancelled_at    timestamptz NULL,
  CONSTRAINT bookings_paid_status_chk CHECK (
    (status = 'paid' AND paid_at IS NOT NULL) OR
    (status <> 'paid' AND paid_at IS NULL) OR
    paid_at IS NOT NULL
  )
);

CREATE INDEX bookings_court_idx       ON bookings (court_id);
CREATE INDEX bookings_status_idx      ON bookings (status);
CREATE INDEX bookings_created_at_idx  ON bookings (created_at DESC);

CREATE TRIGGER bookings_set_updated_at
  BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE payment_splits (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      uuid        NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES users(id)    ON DELETE RESTRICT,
  amount_minor    integer     NOT NULL CHECK (amount_minor > 0),
  status          payment_split_status NOT NULL DEFAULT 'pending',
  external_ref    text        NULL,
  paid_at         timestamptz NULL,
  refunded_at     timestamptz NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, user_id)
);

CREATE INDEX payment_splits_booking_idx ON payment_splits (booking_id);
CREATE INDEX payment_splits_user_idx    ON payment_splits (user_id);
CREATE INDEX payment_splits_status_idx  ON payment_splits (status);

CREATE TRIGGER payment_splits_set_updated_at
  BEFORE UPDATE ON payment_splits
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration --
DROP TRIGGER IF EXISTS payment_splits_set_updated_at ON payment_splits;
DROP TABLE IF EXISTS payment_splits;
DROP TRIGGER IF EXISTS bookings_set_updated_at ON bookings;
DROP TABLE IF EXISTS bookings;
DROP TYPE IF EXISTS payment_split_status;
DROP TYPE IF EXISTS booking_status;
