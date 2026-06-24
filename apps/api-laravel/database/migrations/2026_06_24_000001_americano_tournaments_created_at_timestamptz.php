<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * americano_tournaments.created_at ships as TIMESTAMP (no tz) — the only
 * non-timestamptz timestamp column in the schema. AmericanoController emits it
 * to clients, so without a tz the wire value is a bare local string rather than
 * ISO-8601 Zulu. Promote it to timestamptz (interpreting the existing naive
 * values as UTC, which is how the app writes now()).
 *
 * Postgres-only and guarded: the legacy americano_* tables are pgsql-gated, so
 * on the sqlite test harness (and any schema without the table/column) this is a
 * clean no-op. The ALTER is wrapped so a column already in timestamptz (re-run)
 * does not error.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }
        if (! Schema::hasTable('americano_tournaments') || ! Schema::hasColumn('americano_tournaments', 'created_at')) {
            return;
        }

        try {
            DB::statement("ALTER TABLE americano_tournaments ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC'");
        } catch (\Throwable $e) {
            report($e);
        }
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }
        if (! Schema::hasTable('americano_tournaments') || ! Schema::hasColumn('americano_tournaments', 'created_at')) {
            return;
        }

        try {
            DB::statement("ALTER TABLE americano_tournaments ALTER COLUMN created_at TYPE timestamp USING created_at AT TIME ZONE 'UTC'");
        } catch (\Throwable $e) {
            report($e);
        }
    }
};
