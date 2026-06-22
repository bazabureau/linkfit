<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * Performance indexes for the hottest read paths flagged in the audit.
 *
 * Strictly ADDITIVE: plain (non-unique) secondary indexes only. No existing
 * index, column, constraint or row is touched.
 *
 * Scope note — most audit candidates were ALREADY indexed in the legacy
 * schema and earlier Laravel migrations, so they are intentionally NOT
 * re-added here (a duplicate index is pure overhead). The verified-missing
 * gaps are the `americano_*` tables, whose legacy DDL ships with no secondary
 * indexes at all, yet whose controller reads filter every row set by
 * `tournament_id` (teams/matches lists, standings, leaderboards) and host the
 * "my tournaments" query by `host_id`.
 *
 * Already covered elsewhere (skipped to avoid duplicates):
 *   - bookings (user_id, starts_at DESC, id DESC) → bookings_user_starts_id_idx (2026_06_22_000001)
 *   - bookings (court_id, starts_at) WHERE active   → bookings_active_court_start_unique (2026_06_22_000001)
 *   - feed_events (actor_user_id, created_at DESC)   → feed_events_actor_created_idx (legacy)
 *   - feed_events (created_at DESC) WHERE visible    → feed_events_visible_created_idx (legacy)
 *   - feed_event_reactions (feed_event_id, ...)      → PK leading column (legacy)
 *   - player_sport_stats (sport_id, elo_rating DESC) → player_sport_stats_sport_elo_idx (legacy)
 *   - messages (conversation_id, created_at DESC)    → messages_conversation_idx (legacy)
 *   - conversation_participants (user_id)            → conversation_participants_user_idx +
 *                                                       ..._active_idx WHERE left_at IS NULL (legacy)
 *   - follows (followed_user_id) / (follower_user_id)→ follows_followed_idx / follows_follower_idx (legacy)
 *   - americano_teams (user_id)                      → americano_teams_user_id_idx (2026_06_21_000002)
 *
 * Cross-dialect + idempotent: each index is guarded by hasTable/hasColumns and
 * wrapped in a try/catch that swallows "already exists" so a re-run (or a
 * partially-applied schema) is a no-op on BOTH Postgres and sqlite. On the
 * sqlite test harness the legacy `americano_*` tables do not exist (the legacy
 * import is pgsql-gated), so the guards make this migration a clean no-op there.
 */
return new class extends Migration
{
    /**
     * @var list<array{table: string, columns: list<string>, name: string}>
     */
    private array $indexes = [
        ['table' => 'americano_teams', 'columns' => ['tournament_id'], 'name' => 'americano_teams_tournament_idx'],
        ['table' => 'americano_matches', 'columns' => ['tournament_id'], 'name' => 'americano_matches_tournament_idx'],
        ['table' => 'americano_tournaments', 'columns' => ['host_id'], 'name' => 'americano_tournaments_host_idx'],
    ];

    public function up(): void
    {
        foreach ($this->indexes as $index) {
            $this->addIndex($index['table'], $index['columns'], $index['name']);
        }
    }

    public function down(): void
    {
        foreach (array_reverse($this->indexes) as $index) {
            $this->dropIndex($index['table'], $index['name']);
        }
    }

    /**
     * @param  list<string>  $columns
     */
    private function addIndex(string $table, array $columns, string $name): void
    {
        if (! Schema::hasTable($table) || ! Schema::hasColumns($table, $columns)) {
            return;
        }

        try {
            Schema::table($table, function (Blueprint $blueprint) use ($columns, $name): void {
                $blueprint->index($columns, $name);
            });
        } catch (Throwable $e) {
            // A pre-existing index of the same name (re-run, or already present
            // on a live DB) surfaces as a driver "already exists" error. That is
            // exactly the no-op we want; anything else is re-thrown.
            if (! $this->isAlreadyExists($e)) {
                throw $e;
            }
        }
    }

    private function dropIndex(string $table, string $name): void
    {
        if (! Schema::hasTable($table)) {
            return;
        }

        try {
            Schema::table($table, function (Blueprint $blueprint) use ($name): void {
                $blueprint->dropIndex($name);
            });
        } catch (Throwable $e) {
            // Index already gone (never created on this dialect / partial state).
            if (! $this->isMissing($e)) {
                throw $e;
            }
        }
    }

    private function isAlreadyExists(Throwable $e): bool
    {
        return Str::contains(strtolower($e->getMessage()), ['already exists', 'duplicate']);
    }

    private function isMissing(Throwable $e): bool
    {
        return Str::contains(strtolower($e->getMessage()), ['no such index', 'does not exist', 'not exist']);
    }
};
