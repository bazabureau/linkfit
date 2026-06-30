<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Founder / co-founder designation for the people who started Linkfit. Nullable
 * (virtually every user is null). Surfaced via User::toPublicUser as
 * `founder_role` ('founder' | 'co_founder') so the app can show a distinct badge
 * and a differentiated profile for them. Set out-of-band — never user-editable.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('users') && ! Schema::hasColumn('users', 'founder_role')) {
            Schema::table('users', function (Blueprint $table) {
                $table->string('founder_role', 20)->nullable();
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('users', 'founder_role')) {
            Schema::table('users', function (Blueprint $table) {
                $table->dropColumn('founder_role');
            });
        }
    }
};
