<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('booking_holds')) {
            Schema::create('booking_holds', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('user_id');
                $table->uuid('court_id');
                $table->timestampTz('starts_at');
                $table->unsignedSmallInteger('duration_minutes');
                $table->timestampTz('expires_at');
                $table->string('source', 32)->default('app');
                $table->string('idempotency_key', 200)->nullable();
                $table->timestampsTz();
                $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
                $table->foreign('court_id')->references('id')->on('courts')->cascadeOnDelete();
                $table->unique(['user_id', 'idempotency_key']);
                $table->index(['court_id', 'starts_at', 'expires_at']);
                $table->index(['user_id', 'expires_at']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('booking_holds');
    }
};
