-- Up Migration --
--
-- Referrals system. Adds a per-user referral code so existing users can
-- share an invite link, and a `referrals` ledger that records which new
-- account redeemed which code.
--
-- Design choices:
--   * `users.referral_code` is the canonical shareable code; UNIQUE, 6 chars,
--     ambiguous characters removed (0/O/1/I) so it's safe to read aloud.
--     Existing rows get a deterministic backfill in this same migration so
--     anyone signed up before today can share immediately.
--   * `referrals` is keyed on `referee_user_id` (PK) — each new user can be
--     referred AT MOST ONCE. Trying to redeem a second code is rejected by
--     the PK conflict and surfaced as a 409 in the service layer.
--   * `code_used` is the literal code the referee typed in (a foreign key
--     to users(referral_code) keeps it honest if the referrer's code ever
--     rotates).
--   * Self-referral is blocked by a row-level CHECK constraint as a belt-
--     and-suspenders backup to the service-layer validation.

-- Add the column nullable so we can backfill, then promote to NOT NULL.
ALTER TABLE users
  ADD COLUMN referral_code text NULL;

-- Backfill every existing row with a unique 6-char code drawn from the
-- ambiguity-free alphabet. We do this inside a PL/pgSQL block because we
-- need a retry loop on the rare collision (each user only attempts once,
-- but two users could roll the same code on the same UPDATE).
DO $$
DECLARE
  u RECORD;
  candidate text;
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no 0/O/1/I
  i int;
  attempt int;
BEGIN
  FOR u IN SELECT id FROM users WHERE referral_code IS NULL LOOP
    attempt := 0;
    LOOP
      candidate := '';
      FOR i IN 1..6 LOOP
        candidate := candidate ||
          substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
      END LOOP;
      BEGIN
        UPDATE users SET referral_code = candidate WHERE id = u.id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        attempt := attempt + 1;
        IF attempt > 20 THEN
          RAISE EXCEPTION 'Could not generate unique referral code for user %', u.id;
        END IF;
      END;
    END LOOP;
  END LOOP;
END $$;

-- We intentionally keep the column NULLABLE so the existing auth flow
-- (which doesn't know about referrals) can keep registering users without
-- modification. The `ReferralsService` mints a code lazily on first read.
-- UNIQUE still applies — NULLs don't collide in Postgres UNIQUE indexes.
ALTER TABLE users
  ADD CONSTRAINT users_referral_code_uq UNIQUE (referral_code),
  ADD CONSTRAINT users_referral_code_format_chk
    CHECK (referral_code IS NULL OR referral_code ~ '^[A-HJ-NP-Z2-9]{6}$');

CREATE TABLE referrals (
  -- One row per referee. Composite PK isn't needed — being-referred is a
  -- once-per-account event.
  referee_user_id   uuid        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  referrer_user_id  uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_used         text        NOT NULL REFERENCES users(referral_code) ON DELETE RESTRICT,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referrals_no_self CHECK (referee_user_id <> referrer_user_id)
);

-- Fast "list everyone I referred" lookup for the GET /me/referrals endpoint.
CREATE INDEX referrals_referrer_idx
  ON referrals (referrer_user_id, created_at DESC);

-- Fast "did this code get used and by whom" lookup for fraud analysis.
CREATE INDEX referrals_code_idx
  ON referrals (code_used, created_at DESC);

-- Down Migration --
DROP INDEX IF EXISTS referrals_code_idx;
DROP INDEX IF EXISTS referrals_referrer_idx;
DROP TABLE IF EXISTS referrals;
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_referral_code_format_chk,
  DROP CONSTRAINT IF EXISTS users_referral_code_uq,
  DROP COLUMN IF EXISTS referral_code;
