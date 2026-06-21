<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('api_idempotency_keys')) {
            Schema::create('api_idempotency_keys', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('user_id');
                $table->string('route_key', 240);
                $table->string('idempotency_key', 200);
                $table->string('request_hash', 64);
                $table->string('status', 32)->default('processing');
                $table->unsignedSmallInteger('response_status')->nullable();
                $table->longText('response_body')->nullable();
                $table->timestampTz('completed_at')->nullable();
                $table->timestampsTz();
                $table->unique(['user_id', 'route_key', 'idempotency_key'], 'api_idempotency_user_route_key_unique');
                $table->index(['created_at']);
            });
        }

        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }

        if (Schema::hasTable('bookings')) {
            DB::statement("CREATE UNIQUE INDEX IF NOT EXISTS bookings_active_court_start_unique ON bookings (court_id, starts_at) WHERE status IN ('pending_payment', 'partially_paid', 'paid')");
            DB::statement('CREATE INDEX IF NOT EXISTS bookings_user_starts_id_idx ON bookings (user_id, starts_at DESC, id DESC)');
        }

        if (Schema::hasTable('booking_holds')) {
            DB::table('booking_holds')->where('expires_at', '<=', now())->delete();
            DB::statement('
                DELETE FROM booking_holds h
                USING (
                    SELECT id, row_number() OVER (PARTITION BY court_id, starts_at ORDER BY created_at DESC, id DESC) AS rn
                    FROM booking_holds
                ) ranked
                WHERE h.id = ranked.id AND ranked.rn > 1
            ');
            DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS booking_holds_court_start_unique ON booking_holds (court_id, starts_at)');
            DB::statement('CREATE INDEX IF NOT EXISTS booking_holds_user_expires_id_idx ON booking_holds (user_id, expires_at, id)');
        }
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('DROP INDEX IF EXISTS booking_holds_user_expires_id_idx');
            DB::statement('DROP INDEX IF EXISTS booking_holds_court_start_unique');
            DB::statement('DROP INDEX IF EXISTS bookings_user_starts_id_idx');
            DB::statement('DROP INDEX IF EXISTS bookings_active_court_start_unique');
        }

        Schema::dropIfExists('api_idempotency_keys');
    }
};
