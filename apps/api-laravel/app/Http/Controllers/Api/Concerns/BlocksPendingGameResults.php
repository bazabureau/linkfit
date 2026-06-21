<?php

namespace App\Http\Controllers\Api\Concerns;

use App\Support\ApiException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

trait BlocksPendingGameResults
{
    /**
     * Base query for "finished games this user still owes a result for": games
     * that have ended, are not cancelled/completed, have no completed scoring
     * row yet, and have >= 2 confirmed players (so a result is actually
     * recordable). Scoped to games the user can report on (host, or a confirmed
     * participant the host delegated). Shared by both the blocking write-guard
     * and GET /me/pending-results so the two can never drift.
     */
    protected function pendingGameResultQuery(string $userId)
    {
        $hasResultAccessColumn = Schema::hasColumn('game_participants', 'can_report_result');

        return DB::table('games as g')
            ->join('sports as s', 's.id', '=', 'g.sport_id')
            ->leftJoin('courts as c', 'c.id', '=', 'g.court_id')
            ->leftJoin('venues as v', 'v.id', '=', 'c.venue_id')
            ->leftJoin('match_scores as ms', 'ms.game_id', '=', 'g.id')
            ->whereNull('g.deleted_at')
            ->whereNotIn('g.status', ['cancelled', 'completed'])
            ->whereRaw("g.starts_at + (g.duration_minutes * interval '1 minute') <= now()")
            ->where(function ($q) use ($userId, $hasResultAccessColumn) {
                $q->where('g.host_user_id', $userId);
                if ($hasResultAccessColumn) {
                    $q->orWhereExists(function ($sub) use ($userId) {
                        $sub->selectRaw('1')
                            ->from('game_participants as gp')
                            ->whereColumn('gp.game_id', 'g.id')
                            ->where('gp.user_id', $userId)
                            ->where('gp.status', 'confirmed')
                            ->where('gp.can_report_result', true);
                    });
                }
            })
            ->where(function ($q) {
                $q->whereNull('ms.game_id')
                    ->orWhere('ms.status', '!=', 'completed');
            })
            // Only count a game that can actually be scored: reportResult /
            // assertValidTeams need at least two confirmed players to form the
            // two teams. A game that never filled (e.g. just the host) can never
            // be scored, so it must NOT trap the user into an unrecordable
            // result before they can join/create anything else.
            ->whereRaw("(select count(*) from game_participants gp2 where gp2.game_id = g.id and gp2.status = 'confirmed') >= 2")
            ->orderBy('g.starts_at');
    }

    /**
     * Every finished game the user still owes a result for, oldest first. Powers
     * GET /me/pending-results so the app can show the full to-do list, not only
     * the single game the write-guard blocks on. (P3#84)
     *
     * @return array<int, array<string, mixed>>
     */
    protected function pendingGameResults(string $userId): array
    {
        return $this->pendingGameResultQuery($userId)
            ->limit(50)
            ->get([
                'g.id',
                'g.starts_at',
                'g.duration_minutes',
                's.slug as sport_slug',
                'c.name as court_name',
                'v.name as venue_name',
            ])
            ->map(fn ($g) => [
                'id' => (string) $g->id,
                'starts_at' => $g->starts_at,
                'duration_minutes' => (int) $g->duration_minutes,
                'sport_slug' => $g->sport_slug,
                'court_name' => $g->court_name,
                'venue_name' => $g->venue_name,
                'action' => 'record_result',
            ])
            ->all();
    }

    protected function ensureNoPendingGameResult(string $userId): void
    {
        $pending = $this->pendingGameResultQuery($userId)
            ->first([
                'g.id',
                'g.starts_at',
                's.slug as sport_slug',
                'c.name as court_name',
                'v.name as venue_name',
            ]);

        if ($pending !== null) {
            throw new ApiException(409, 'PENDING_GAME_RESULT', 'Record your finished game result before continuing', [
                'pending_game' => [
                    'id' => $pending->id,
                    'starts_at' => $pending->starts_at,
                    'sport_slug' => $pending->sport_slug,
                    'court_name' => $pending->court_name,
                    'venue_name' => $pending->venue_name,
                ],
                'action' => 'record_result',
            ]);
        }
    }

    protected function ensureNoPendingHostedGameResult(string $userId): void
    {
        $this->ensureNoPendingGameResult($userId);
    }
}
