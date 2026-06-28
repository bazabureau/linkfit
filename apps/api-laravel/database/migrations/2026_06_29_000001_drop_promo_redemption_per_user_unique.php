<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Drops the booking_promo_redemptions per-user UNIQUE index added by
 * 2026_06_18_000002. That index ((promo_code_id, user_id)) hard-caps every user
 * at ONE redemption per code, which directly contradicts promo_codes.per_user_limit
 * (validated up to 1000). With the index in place, a legitimate 2nd redemption of a
 * multi-use code raises a 23505 that the booking path misreads as an idempotency
 * replay → a misleading 409 "Duplicate booking request" and a lost booking.
 *
 * The per-user limit is still correctly enforced in code: promoDiscount() counts
 * existing redemptions for the (promo, user) pair under a promo_codes-row
 * lockForUpdate, which serialises concurrent redemptions of the SAME code across
 * courts — so the count-then-check cannot be raced past the cap. The DB index was
 * redundant for the limit=1 case and actively wrong for limit>=2.
 *
 * `DROP INDEX IF EXISTS <name>` is valid on both Postgres and SQLite, so this is
 * a no-op where the index was never created (the original was pgsql-only).
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('booking_promo_redemptions')) {
            return;
        }
        DB::statement('DROP INDEX IF EXISTS booking_promo_redemptions_promo_user_uq');
    }

    public function down(): void
    {
        // Reversible only on Postgres (the index was pgsql-only) and only when the
        // current data has no per-user duplicates — recreating a unique index over
        // legitimately multi-used codes would fail, so guard against it.
        if (config('database.default') !== 'pgsql' || ! Schema::hasTable('booking_promo_redemptions')) {
            return;
        }
        $hasDupes = DB::table('booking_promo_redemptions')
            ->whereNotNull('user_id')
            ->select('promo_code_id', 'user_id')
            ->groupBy('promo_code_id', 'user_id')
            ->havingRaw('count(*) > 1')
            ->exists();
        if (! $hasDupes) {
            DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS booking_promo_redemptions_promo_user_uq ON booking_promo_redemptions (promo_code_id, user_id)');
        }
    }
};
