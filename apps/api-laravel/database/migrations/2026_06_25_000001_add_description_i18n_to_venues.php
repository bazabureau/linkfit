<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Localized venue descriptions: a JSONB column keyed by locale ({az,en,ru}).
 * CatalogController returns it as `description_i18n` and the web/app render the
 * blurb in the active language, falling back to the plain `description`.
 *
 * Idempotent — the column was first added directly on production, so this guards
 * with hasColumn so a fresh/redeployed database converges to the same schema.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('venues', 'description_i18n')) {
            DB::statement('ALTER TABLE venues ADD COLUMN description_i18n jsonb');
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('venues', 'description_i18n')) {
            DB::statement('ALTER TABLE venues DROP COLUMN description_i18n');
        }
    }
};
