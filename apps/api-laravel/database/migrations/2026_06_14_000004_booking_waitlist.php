<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('booking_waitlist_entries')) {
            Schema::create('booking_waitlist_entries', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('user_id');
                $table->uuid('court_id');
                $table->timestampTz('starts_at');
                $table->unsignedSmallInteger('duration_minutes');
                $table->string('status', 32)->default('active');
                $table->timestampTz('notified_at')->nullable();
                $table->timestampTz('cancelled_at')->nullable();
                $table->timestampsTz();
                $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
                $table->foreign('court_id')->references('id')->on('courts')->cascadeOnDelete();
                $table->unique(['user_id', 'court_id', 'starts_at', 'duration_minutes']);
                $table->index(['court_id', 'starts_at', 'status']);
                $table->index(['user_id', 'created_at']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('booking_waitlist_entries');
    }
};
