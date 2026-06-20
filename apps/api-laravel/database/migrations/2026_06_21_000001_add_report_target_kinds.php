<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    // `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block on some
    // PostgreSQL versions, so this migration must not be wrapped in one.
    public $withinTransaction = false;

    public function up(): void
    {
        if (config('database.default') !== 'pgsql') {
            return;
        }

        // The report_target_kind enum shipped as (user, game, message) and was
        // later extended with (story, feed_comment). The Reports API already
        // validates and summarizes feed_event, venue_review, and media targets,
        // but inserting any of them threw "invalid input value for enum" (500).
        // Add the missing values so the report/moderation flow works for every
        // reportable target.
        foreach (['feed_event', 'venue_review', 'media'] as $value) {
            DB::statement("ALTER TYPE report_target_kind ADD VALUE IF NOT EXISTS '{$value}'");
        }
    }

    public function down(): void
    {
        // PostgreSQL cannot remove enum values without recreating the type and
        // rewriting the column, so this migration is intentionally irreversible.
    }
};
