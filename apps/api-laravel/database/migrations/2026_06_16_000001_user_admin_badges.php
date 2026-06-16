<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('users')) {
            return;
        }

        Schema::table('users', function (Blueprint $table) {
            if (! Schema::hasColumn('users', 'is_vip')) {
                $table->boolean('is_vip')->default(false);
            }
            if (! Schema::hasColumn('users', 'vip_badge_label')) {
                $table->string('vip_badge_label', 40)->nullable();
            }
            if (! Schema::hasColumn('users', 'vip_expires_at')) {
                $table->timestampTz('vip_expires_at')->nullable();
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('users')) {
            return;
        }

        Schema::table('users', function (Blueprint $table) {
            if (Schema::hasColumn('users', 'vip_expires_at')) {
                $table->dropColumn('vip_expires_at');
            }
            if (Schema::hasColumn('users', 'vip_badge_label')) {
                $table->dropColumn('vip_badge_label');
            }
            if (Schema::hasColumn('users', 'is_vip')) {
                $table->dropColumn('is_vip');
            }
        });
    }
};
