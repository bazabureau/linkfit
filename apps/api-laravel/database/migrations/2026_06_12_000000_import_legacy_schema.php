<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (config('database.default') !== 'pgsql' || Schema::hasTable('users')) {
            return;
        }

        $dir = database_path('legacy-migrations');
        foreach (glob($dir.'/*.sql') ?: [] as $file) {
            $sql = file_get_contents($file);
            if ($sql === false) {
                continue;
            }
            $up = preg_split('/--\s*Down Migration\s*--/i', $sql)[0] ?? '';
            $up = preg_replace('/^\s*--\s*Up Migration\s*--\s*/i', '', $up);
            $up = trim((string) $up);
            if ($up !== '') {
                DB::unprepared($up);
            }
        }
    }

    public function down(): void
    {
        // The imported schema mirrors the legacy production database. It is
        // intentionally not dropped from Laravel to avoid accidental data loss.
    }
};
