<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('support_tickets')) {
            return;
        }

        if (config('database.default') === 'pgsql') {
            DB::statement('ALTER TABLE support_tickets DROP CONSTRAINT IF EXISTS support_tickets_user_id_foreign');
            DB::statement('ALTER TABLE support_tickets ALTER COLUMN user_id DROP NOT NULL');
            DB::statement('ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_user_id_foreign FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL');
        }
    }

    public function down(): void
    {
        if (! Schema::hasTable('support_tickets') || config('database.default') !== 'pgsql') {
            return;
        }

        DB::statement('ALTER TABLE support_tickets DROP CONSTRAINT IF EXISTS support_tickets_user_id_foreign');
        DB::statement('ALTER TABLE support_tickets ALTER COLUMN user_id SET NOT NULL');
        DB::statement('ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_user_id_foreign FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE');
    }
};
