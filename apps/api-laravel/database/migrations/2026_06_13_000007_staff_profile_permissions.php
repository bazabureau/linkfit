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
            if (! Schema::hasColumn('users', 'staff_title')) {
                $table->string('staff_title', 80)->nullable();
            }
            if (! Schema::hasColumn('users', 'staff_permissions')) {
                $table->jsonb('staff_permissions')->nullable();
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('users')) {
            return;
        }

        Schema::table('users', function (Blueprint $table) {
            if (Schema::hasColumn('users', 'staff_permissions')) {
                $table->dropColumn('staff_permissions');
            }
            if (Schema::hasColumn('users', 'staff_title')) {
                $table->dropColumn('staff_title');
            }
        });
    }
};
