<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('bookings')) {
            return;
        }

        Schema::table('bookings', function (Blueprint $table) {
            if (! Schema::hasColumn('bookings', 'checked_in_at')) {
                $table->timestampTz('checked_in_at')->nullable();
            }
            if (! Schema::hasColumn('bookings', 'checked_in_by_user_id')) {
                $table->uuid('checked_in_by_user_id')->nullable();
            }
            if (! Schema::hasColumn('bookings', 'internal_note')) {
                $table->text('internal_note')->nullable();
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('bookings')) {
            return;
        }

        Schema::table('bookings', function (Blueprint $table) {
            if (Schema::hasColumn('bookings', 'internal_note')) {
                $table->dropColumn('internal_note');
            }
            if (Schema::hasColumn('bookings', 'checked_in_by_user_id')) {
                $table->dropColumn('checked_in_by_user_id');
            }
            if (Schema::hasColumn('bookings', 'checked_in_at')) {
                $table->dropColumn('checked_in_at');
            }
        });
    }
};
