<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('launch_analytics_events')) {
            Schema::create('launch_analytics_events', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->string('event', 160);
                $table->string('distinct_id', 120)->nullable();
                $table->uuid('user_id')->nullable();
                $table->json('properties')->nullable();
                $table->string('source', 40)->nullable();
                $table->string('ip_hash', 80)->nullable();
                $table->timestampTz('occurred_at');
                $table->timestampTz('created_at')->useCurrent();

                $table->index(['event', 'occurred_at']);
                $table->index(['distinct_id', 'occurred_at']);
                $table->index('user_id');
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('launch_analytics_events');
    }
};
