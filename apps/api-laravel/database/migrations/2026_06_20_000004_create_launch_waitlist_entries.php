<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('launch_waitlist_entries')) {
            Schema::create('launch_waitlist_entries', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->string('name', 160);
                $table->string('email', 190)->unique();
                $table->string('phone', 40)->nullable();
                $table->string('role', 40)->default('player');
                $table->string('locale', 8)->default('az');
                $table->string('source', 80)->default('web_waitlist');
                $table->text('message')->nullable();
                $table->string('ip_address', 80)->nullable();
                $table->string('user_agent', 512)->nullable();
                $table->timestampsTz();
                $table->index(['role', 'created_at']);
                $table->index(['source', 'created_at']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('launch_waitlist_entries');
    }
};
