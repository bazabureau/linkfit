<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Adds the foreign keys + the promo per-user uniqueness that the Laravel-era
 * tables dropped. Designed to be safe on a live DB:
 *   - FKs are added NOT VALID — they enforce on every NEW write immediately but
 *     never fail the migration on pre-existing legacy rows (no data is touched
 *     or deleted). They can be VALIDATEd later once data is known clean.
 *   - The booking_promo_redemptions per-user unique is created only if no
 *     duplicates already exist, so the migration can never fail / never forces
 *     a destructive cleanup.
 * Everything is column-guarded and idempotent (re-runnable).
 */
return new class extends Migration
{
    public function up(): void
    {
        if (config('database.default') !== 'pgsql') {
            return;
        }

        $addFk = function (string $table, string $column, string $refTable, string $onDelete): void {
            if (! Schema::hasTable($table) || ! Schema::hasColumn($table, $column) || ! Schema::hasTable($refTable)) {
                return;
            }
            $name = $table.'_'.$column.'_fk';
            DB::statement("DO \$\$ BEGIN
                ALTER TABLE {$table} ADD CONSTRAINT {$name}
                    FOREIGN KEY ({$column}) REFERENCES {$refTable}(id) ON DELETE {$onDelete} NOT VALID;
            EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;");
        };

        // bookings actor / promo references.
        $addFk('bookings', 'promo_code_id', 'promo_codes', 'set null');
        $addFk('bookings', 'created_by_user_id', 'users', 'set null');
        $addFk('bookings', 'cancelled_by_user_id', 'users', 'set null');
        $addFk('bookings', 'checked_in_by_user_id', 'users', 'set null');
        $addFk('bookings', 'no_show_marked_by_user_id', 'users', 'set null');

        // venues / users actor references.
        $addFk('venues', 'approved_by_user_id', 'users', 'set null');
        $addFk('users', 'suspended_by_user_id', 'users', 'set null'); // self-referential

        // promo redemptions (cascade — child of promo/booking/user).
        $addFk('booking_promo_redemptions', 'promo_code_id', 'promo_codes', 'cascade');
        $addFk('booking_promo_redemptions', 'booking_id', 'bookings', 'cascade');
        $addFk('booking_promo_redemptions', 'user_id', 'users', 'cascade');

        // reminder ledger.
        $addFk('booking_reminders_sent', 'booking_id', 'bookings', 'cascade');
        $addFk('booking_reminders_sent', 'user_id', 'users', 'cascade');

        // ops tables.
        $addFk('push_notification_jobs', 'user_id', 'users', 'cascade');
        $addFk('media_assets', 'user_id', 'users', 'set null');
        $addFk('court_blocks', 'court_id', 'courts', 'cascade');
        $addFk('court_blocks', 'created_by_user_id', 'users', 'set null');

        // coaching authorship.
        $addFk('coaches', 'created_by', 'users', 'set null');
        $addFk('lessons', 'created_by', 'users', 'set null');

        // Hot-path indexes.
        if (Schema::hasTable('bookings') && Schema::hasColumn('bookings', 'promo_code_id')) {
            DB::statement('CREATE INDEX IF NOT EXISTS bookings_promo_code_id_idx ON bookings (promo_code_id)');
        }
        if (Schema::hasTable('push_notification_jobs')) {
            DB::statement("CREATE INDEX IF NOT EXISTS push_jobs_claim_idx ON push_notification_jobs (created_at) WHERE status IN ('pending','retry')");
        }

        // Per-user promo uniqueness — only if existing data has no duplicates,
        // so this never fails and never forces a destructive cleanup.
        if (Schema::hasTable('booking_promo_redemptions')) {
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
    }

    public function down(): void
    {
        if (config('database.default') !== 'pgsql') {
            return;
        }

        $dropFk = function (string $table, string $column): void {
            if (Schema::hasTable($table)) {
                DB::statement("ALTER TABLE {$table} DROP CONSTRAINT IF EXISTS {$table}_{$column}_fk");
            }
        };
        foreach ([
            ['bookings', 'promo_code_id'], ['bookings', 'created_by_user_id'], ['bookings', 'cancelled_by_user_id'],
            ['bookings', 'checked_in_by_user_id'], ['bookings', 'no_show_marked_by_user_id'],
            ['venues', 'approved_by_user_id'], ['users', 'suspended_by_user_id'],
            ['booking_promo_redemptions', 'promo_code_id'], ['booking_promo_redemptions', 'booking_id'], ['booking_promo_redemptions', 'user_id'],
            ['booking_reminders_sent', 'booking_id'], ['booking_reminders_sent', 'user_id'],
            ['push_notification_jobs', 'user_id'], ['media_assets', 'user_id'],
            ['court_blocks', 'court_id'], ['court_blocks', 'created_by_user_id'],
            ['coaches', 'created_by'], ['lessons', 'created_by'],
        ] as [$t, $c]) {
            $dropFk($t, $c);
        }
        DB::statement('DROP INDEX IF EXISTS bookings_promo_code_id_idx');
        DB::statement('DROP INDEX IF EXISTS push_jobs_claim_idx');
        DB::statement('DROP INDEX IF EXISTS booking_promo_redemptions_promo_user_uq');
    }
};
