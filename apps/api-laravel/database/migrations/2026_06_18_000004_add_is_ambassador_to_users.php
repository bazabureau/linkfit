<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * LinkFit brand ambassadors — players promoted by an admin. Shown as a badge
 * next to their name across the app and site. Distinct from VIP / verified.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('users') && ! Schema::hasColumn('users', 'is_ambassador')) {
            Schema::table('users', function (Blueprint $table) {
                $table->boolean('is_ambassador')->default(false);
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('users', 'is_ambassador')) {
            Schema::table('users', function (Blueprint $table) {
                $table->dropColumn('is_ambassador');
            });
        }
    }
};
