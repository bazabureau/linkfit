<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Additive: gives `messages` an optional per-sender idempotency key so a retried
 * "send message" (mobile resends on flaky networks) replays the original message
 * instead of duplicating it. Nullable column + a UNIQUE partial index scoped to
 * (sender_user_id, idempotency_key) — historical rows (key NULL) are untouched
 * and never collide. Strictly additive: no existing column is altered or dropped.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('messages')) {
            return;
        }
        if (! Schema::hasColumn('messages', 'idempotency_key')) {
            Schema::table('messages', function ($table) {
                $table->string('idempotency_key', 200)->nullable();
            });
        }

        if (config('database.default') === 'pgsql') {
            // Partial unique index: only enforced when a key is present, scoped to
            // the sender so two users may legitimately reuse the same client key.
            DB::statement(
                'CREATE UNIQUE INDEX IF NOT EXISTS messages_sender_idempotency_uq '.
                'ON messages (sender_user_id, idempotency_key) '.
                'WHERE idempotency_key IS NOT NULL'
            );
        }
    }

    public function down(): void
    {
        if (config('database.default') === 'pgsql') {
            DB::statement('DROP INDEX IF EXISTS messages_sender_idempotency_uq');
        }
        if (Schema::hasTable('messages') && Schema::hasColumn('messages', 'idempotency_key')) {
            Schema::table('messages', function ($table) {
                $table->dropColumn('idempotency_key');
            });
        }
    }
};
