<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Venue logo: a plain text URL (uploaded like venue photos). Shown on the venue
 * card + venue page so each venue (partner or not) can carry its own brand mark.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('venues', 'logo_url')) {
            DB::statement('ALTER TABLE venues ADD COLUMN logo_url text');
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('venues', 'logo_url')) {
            DB::statement('ALTER TABLE venues DROP COLUMN logo_url');
        }
    }
};
