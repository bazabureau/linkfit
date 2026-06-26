<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Launch-waitlist lifecycle status. The public "coming soon" signup stores rows
 * in `launch_waitlist_entries`; admins need to move each lead through a simple
 * pipeline (pending -> invited -> joined / declined) from the admin panel. The
 * column defaults to 'pending' so the existing 47 rows backfill cleanly and the
 * public signup ({@see LaunchWaitlistController::store}) keeps working unchanged.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('launch_waitlist_entries') && ! Schema::hasColumn('launch_waitlist_entries', 'status')) {
            Schema::table('launch_waitlist_entries', function (Blueprint $table) {
                $table->string('status', 40)->default('pending');
                $table->index(['status', 'created_at']);
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('launch_waitlist_entries', 'status')) {
            Schema::table('launch_waitlist_entries', function (Blueprint $table) {
                $table->dropIndex(['status', 'created_at']);
                $table->dropColumn('status');
            });
        }
    }
};
