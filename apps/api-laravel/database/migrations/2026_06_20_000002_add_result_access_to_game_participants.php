<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('game_participants')) {
            return;
        }

        Schema::table('game_participants', function (Blueprint $table): void {
            if (! Schema::hasColumn('game_participants', 'can_report_result')) {
                $table->boolean('can_report_result')->default(false);
            }
        });

        DB::statement('CREATE INDEX IF NOT EXISTS game_participants_result_access_idx ON game_participants (game_id, can_report_result) WHERE can_report_result = true');
    }

    public function down(): void
    {
        if (! Schema::hasTable('game_participants')) {
            return;
        }

        DB::statement('DROP INDEX IF EXISTS game_participants_result_access_idx');

        Schema::table('game_participants', function (Blueprint $table): void {
            if (Schema::hasColumn('game_participants', 'can_report_result')) {
                $table->dropColumn('can_report_result');
            }
        });
    }
};
