<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * P1#34 — link an americano team back to the user that owns/joined it.
 *
 * Additive only: a NULLABLE `user_id` column (existing rows stay valid) plus a
 * lookup index so `mine()` can resolve "tournaments I joined as a team member"
 * with an index-backed `WHERE americano_teams.user_id = ?`. The FK is set to
 * ON DELETE SET NULL so deleting a user never cascades a team row away — the
 * standings/leaderboard the tournament rendered must survive the player leaving.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('americano_teams')) {
            return;
        }

        Schema::table('americano_teams', function (Blueprint $table): void {
            if (! Schema::hasColumn('americano_teams', 'user_id')) {
                $table->uuid('user_id')->nullable();
            }
        });

        // FK + index added via raw SQL with IF NOT EXISTS guards so re-running
        // the migration on a partially-applied schema is a no-op (Postgres).
        if (Schema::hasColumn('americano_teams', 'user_id')) {
            DB::statement(
                'CREATE INDEX IF NOT EXISTS americano_teams_user_id_idx ON americano_teams (user_id)'
            );
            DB::statement(<<<'SQL'
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint WHERE conname = 'americano_teams_user_id_fk'
                    ) THEN
                        ALTER TABLE americano_teams
                            ADD CONSTRAINT americano_teams_user_id_fk
                            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
                    END IF;
                END
                $$;
            SQL);
        }
    }

    public function down(): void
    {
        if (! Schema::hasTable('americano_teams')) {
            return;
        }

        DB::statement('ALTER TABLE americano_teams DROP CONSTRAINT IF EXISTS americano_teams_user_id_fk');
        DB::statement('DROP INDEX IF EXISTS americano_teams_user_id_idx');

        Schema::table('americano_teams', function (Blueprint $table): void {
            if (Schema::hasColumn('americano_teams', 'user_id')) {
                $table->dropColumn('user_id');
            }
        });
    }
};
