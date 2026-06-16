-- Up Migration --
--
-- Wave-10 referrals expansion. The Wave-7 migration
-- (`1700000160000_referrals.sql`) shipped:
--   * `users.referral_code` — the shareable code (UNIQUE, 6 chars).
--   * `referrals` ledger — keyed on referee, records who-referred-whom.
--
-- That covered the "post-signup redeem-a-code" flow. Wave-10 extends the
-- viral surface so the signup endpoint itself can accept `?ref=<code>` and
-- bind the referral atomically with the new user row. To keep the dashboard
-- payload a single-row read (instead of an aggregate on every /me/referral
-- call), we denormalize two columns onto `users`:
--
--   * `referred_by_user_id` — who I came from. Nullable: organic sign-ups
--     and pre-Wave-10 accounts both have NULL. FK to users(id) with
--     ON DELETE SET NULL so a deleted referrer doesn't cascade-delete the
--     downstream account.
--   * `referral_count` — how many people came in through MY code. Bumped
--     atomically by the signup endpoint when it links a new referee.
--     NOT NULL, default 0. Backfilled from the existing `referrals` ledger
--     so the column is consistent with anyone who redeemed under the old
--     post-signup flow.
--
-- Both columns are belt-and-suspenders alongside the existing ledger — the
-- ledger remains the system of record (still PK on referee_user_id, still
-- the source of "who did I refer" rows on the dashboard). The columns
-- exist for fast denormalized reads (count badge in the iOS hero card) and
-- to encode the "referred by X" edge at the user level for cohort analysis.

ALTER TABLE users
  ADD COLUMN referred_by_user_id uuid NULL
    REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN referral_count int NOT NULL DEFAULT 0;

-- A user cannot have referred themselves. The Wave-7 ledger already
-- enforces this via `referrals_no_self`; the same invariant on the new
-- denormalized column gives DB-level safety even if a future service
-- bypasses the ledger.
ALTER TABLE users
  ADD CONSTRAINT users_referred_by_self_chk
    CHECK (referred_by_user_id IS NULL OR referred_by_user_id <> id);

-- Index for "who did X refer" cohort lookups. The dashboard reads through
-- the ledger (sorted by created_at), so this index is primarily for
-- ad-hoc analytics / future "my referrer" surface — kept narrow.
CREATE INDEX users_referred_by_idx
  ON users (referred_by_user_id)
  WHERE referred_by_user_id IS NOT NULL;

-- Backfill `referred_by_user_id` from the existing referrals ledger. Each
-- row in `referrals` maps directly: the referee's row gets the referrer
-- stamped in. The PK on `referrals.referee_user_id` guarantees at most one
-- row per referee, so the UPDATE is unambiguous.
UPDATE users u
   SET referred_by_user_id = r.referrer_user_id
  FROM referrals r
 WHERE r.referee_user_id = u.id
   AND u.referred_by_user_id IS NULL;

-- Backfill `referral_count` from the ledger. Counts every active referee
-- the user has acquired so far. Soft-deleted referees still count (they
-- once signed up under this code) — `referral_count` is a lifetime tally,
-- not a "currently active downstream" gauge.
UPDATE users u
   SET referral_count = COALESCE(c.cnt, 0)
  FROM (
    SELECT referrer_user_id, COUNT(*)::int AS cnt
      FROM referrals
     GROUP BY referrer_user_id
  ) c
 WHERE c.referrer_user_id = u.id;

-- Down Migration --
DROP INDEX IF EXISTS users_referred_by_idx;
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_referred_by_self_chk,
  DROP COLUMN IF EXISTS referral_count,
  DROP COLUMN IF EXISTS referred_by_user_id;
