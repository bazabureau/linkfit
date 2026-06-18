<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Records when a user consented to the Terms & Privacy Policy at sign-up.
 * Nullable (legacy users + clients that don't yet send the flag have null).
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('users') && ! Schema::hasColumn('users', 'terms_accepted_at')) {
            Schema::table('users', function (Blueprint $table) {
                $table->timestampTz('terms_accepted_at')->nullable();
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('users', 'terms_accepted_at')) {
            Schema::table('users', function (Blueprint $table) {
                $table->dropColumn('terms_accepted_at');
            });
        }
    }
};
