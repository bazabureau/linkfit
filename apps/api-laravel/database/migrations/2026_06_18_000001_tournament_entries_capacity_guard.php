<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * DB-level backstop against tournament over-registration. enter() locks the
 * tournaments row before counting, but the "active entries <= max_squads"
 * invariant spans INSERTs and withdrawn->pending re-activations and must hold
 * no matter who writes the row (admin tooling, bulk import). A row count can't
 * be an EXCLUDE/CHECK, so it is enforced by a trigger (raises 23514).
 */
return new class extends Migration
{
    public function up(): void
    {
        if (config('database.default') !== 'pgsql' || ! Schema::hasTable('tournament_entries')) {
            return;
        }

        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION tournament_entry_capacity_guard()
            RETURNS trigger AS $$
            DECLARE
              cap    integer;
              active integer;
            BEGIN
              IF NEW.status = 'withdrawn' THEN
                RETURN NEW; -- a withdrawn entry frees its slot
              END IF;

              SELECT max_squads INTO cap FROM tournaments WHERE id = NEW.tournament_id FOR UPDATE;
              IF cap IS NULL THEN
                RETURN NEW;
              END IF;

              SELECT count(*) INTO active
                FROM tournament_entries
               WHERE tournament_id = NEW.tournament_id
                 AND status <> 'withdrawn'
                 AND id <> NEW.id;

              IF active >= cap THEN
                RAISE EXCEPTION 'tournament is full' USING ERRCODE = 'check_violation';
              END IF;

              RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
        SQL);

        DB::statement('DROP TRIGGER IF EXISTS tournament_entries_capacity_guard ON tournament_entries');
        DB::statement(<<<'SQL'
            CREATE TRIGGER tournament_entries_capacity_guard
              BEFORE INSERT OR UPDATE ON tournament_entries
              FOR EACH ROW EXECUTE FUNCTION tournament_entry_capacity_guard();
        SQL);
    }

    public function down(): void
    {
        if (config('database.default') !== 'pgsql') {
            return;
        }
        DB::statement('DROP TRIGGER IF EXISTS tournament_entries_capacity_guard ON tournament_entries');
        DB::statement('DROP FUNCTION IF EXISTS tournament_entry_capacity_guard()');
    }
};
