<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('user_saved_venues')) {
            Schema::create('user_saved_venues', function (Blueprint $table) {
                $table->uuid('user_id');
                $table->uuid('venue_id');
                $table->timestampTz('created_at')->useCurrent();
                $table->primary(['user_id', 'venue_id']);
                $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
                $table->foreign('venue_id')->references('id')->on('venues')->cascadeOnDelete();
                $table->index(['venue_id', 'created_at']);
            });
        }

        if (! Schema::hasTable('user_saved_courts')) {
            Schema::create('user_saved_courts', function (Blueprint $table) {
                $table->uuid('user_id');
                $table->uuid('court_id');
                $table->timestampTz('created_at')->useCurrent();
                $table->primary(['user_id', 'court_id']);
                $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
                $table->foreign('court_id')->references('id')->on('courts')->cascadeOnDelete();
                $table->index(['court_id', 'created_at']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('user_saved_courts');
        Schema::dropIfExists('user_saved_venues');
    }
};
