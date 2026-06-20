<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        if (config('database.default') !== 'pgsql') {
            return;
        }

        DB::statement('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_admin_role_check');
        DB::statement("ALTER TABLE users ADD CONSTRAINT users_admin_role_check CHECK (admin_role IS NULL OR admin_role IN ('admin', 'moderator', 'partner', 'coach'))");
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS coaches_user_id_uq ON coaches (user_id) WHERE user_id IS NOT NULL');
    }

    public function down(): void
    {
        if (config('database.default') !== 'pgsql') {
            return;
        }

        DB::statement('DROP INDEX IF EXISTS coaches_user_id_uq');
        DB::statement('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_admin_role_check');
        DB::statement("ALTER TABLE users ADD CONSTRAINT users_admin_role_check CHECK (admin_role IS NULL OR admin_role IN ('admin', 'moderator', 'partner'))");
    }
};
