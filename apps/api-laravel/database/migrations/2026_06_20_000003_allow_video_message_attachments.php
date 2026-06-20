<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('messages') || ! Schema::hasColumn('messages', 'attachment_type')) {
            return;
        }

        if (config('database.default') === 'pgsql') {
            DB::statement('ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_attachment_type_check');
            DB::statement("ALTER TABLE messages ADD CONSTRAINT messages_attachment_type_check CHECK (attachment_type IS NULL OR attachment_type IN ('image', 'voice', 'video'))");
        }
    }

    public function down(): void
    {
        if (! Schema::hasTable('messages') || ! Schema::hasColumn('messages', 'attachment_type')) {
            return;
        }

        if (config('database.default') === 'pgsql') {
            DB::statement('ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_attachment_type_check');
            DB::statement("ALTER TABLE messages ADD CONSTRAINT messages_attachment_type_check CHECK (attachment_type IS NULL OR attachment_type IN ('image', 'voice'))");
        }
    }
};
