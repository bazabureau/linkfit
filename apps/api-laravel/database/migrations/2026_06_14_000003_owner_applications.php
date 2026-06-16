<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('owner_applications')) {
            Schema::create('owner_applications', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('user_id');
                $table->uuid('venue_id')->nullable();
                $table->string('venue_name', 160);
                $table->text('venue_address');
                $table->decimal('lat', 9, 6)->nullable();
                $table->decimal('lng', 9, 6)->nullable();
                $table->string('contact_name', 120);
                $table->string('contact_phone', 60)->nullable();
                $table->string('contact_email', 254);
                $table->text('message')->nullable();
                $table->string('status', 32)->default('pending');
                $table->uuid('reviewed_by_user_id')->nullable();
                $table->timestampTz('reviewed_at')->nullable();
                $table->text('review_note')->nullable();
                $table->timestampsTz();
                $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
                $table->foreign('venue_id')->references('id')->on('venues')->nullOnDelete();
                $table->index(['status', 'created_at']);
                $table->index(['user_id', 'created_at']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('owner_applications');
    }
};
