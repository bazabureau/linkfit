-- Up Migration --
-- Database-level overbooking guard. The bookings service already runs an
-- explicit overlap SELECT ... FOR UPDATE before inserting, but that check
-- lives in application code — a bug, a forgotten code path (admin tooling,
-- a future bulk import) or a serialization edge case could still slip two
-- active bookings onto the same court window. An EXCLUDE constraint makes
-- the invariant impossible to violate no matter who writes the row.
--
-- btree_gist lets the GiST index mix the scalar `court_id =` test with the
-- range `&&` overlap test in a single exclusion constraint.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- `timestamptz + interval` is only STABLE in Postgres (month/day arithmetic
-- depends on the session timezone), so it cannot appear in an index
-- expression directly. Pure minute arithmetic is timezone-independent,
-- which makes this thin wrapper safe to declare IMMUTABLE.
CREATE FUNCTION booking_time_range(starts timestamptz, mins smallint)
RETURNS tstzrange
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT tstzrange(starts, starts + make_interval(mins => mins::int), '[)');
$$;

-- Defensive cleanup so the constraint can be installed even if a dev/test
-- database accumulated overlapping rows before the guard existed (production
-- shipped zero booking rows when the court-window flow landed — see
-- 1700000020000). For every group of mutually overlapping active bookings we
-- keep the earliest-created row and cancel the rest. Cancelling (instead of
-- deleting) preserves the audit trail and any attached payment_splits.
UPDATE bookings b
   SET status = 'cancelled', cancelled_at = now()
 WHERE b.status NOT IN ('cancelled', 'refunded', 'failed')
   AND EXISTS (
     SELECT 1
       FROM bookings o
      WHERE o.court_id = b.court_id
        AND o.id <> b.id
        AND o.status NOT IN ('cancelled', 'refunded', 'failed')
        AND booking_time_range(o.starts_at, o.duration_minutes)
            && booking_time_range(b.starts_at, b.duration_minutes)
        AND (o.created_at < b.created_at OR (o.created_at = b.created_at AND o.id < b.id))
   );

-- The half-open '[)' range means back-to-back bookings (one ending exactly
-- when the next starts) do NOT conflict — same semantics as the service's
-- `a_start < b_end AND b_start < a_end` predicate.
ALTER TABLE bookings
  ADD CONSTRAINT bookings_no_overlap_excl
  EXCLUDE USING gist (
    court_id WITH =,
    booking_time_range(starts_at, duration_minutes) WITH &&
  )
  WHERE (status NOT IN ('cancelled', 'refunded', 'failed'));

-- Down Migration --
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_no_overlap_excl;
DROP FUNCTION IF EXISTS booking_time_range(timestamptz, smallint);
DROP EXTENSION IF EXISTS btree_gist;
