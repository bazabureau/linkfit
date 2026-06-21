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

        // The notification_type enum shipped without a squad bucket. Squad
        // invites (SquadsController::invite) need their own type so the client
        // can route the tap to /squads/{id} and badge it distinctly from game/
        // tournament invites. Additive + idempotent: existing rows untouched.
        DB::statement("ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'squad.invited'");
    }

    public function down(): void
    {
        // PostgreSQL cannot remove enum values without recreating the type and
        // rewriting the column, so this migration is intentionally irreversible.
    }
};
