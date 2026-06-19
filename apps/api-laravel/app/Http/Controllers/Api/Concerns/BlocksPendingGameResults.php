<?php

namespace App\Http\Controllers\Api\Concerns;

use App\Support\ApiException;
use Illuminate\Support\Facades\DB;

trait BlocksPendingGameResults
{
    protected function ensureNoPendingGameResult(string $userId): void
    {
        $pending = DB::table('games as g')
            ->join('sports as s', 's.id', '=', 'g.sport_id')
            ->leftJoin('courts as c', 'c.id', '=', 'g.court_id')
            ->leftJoin('venues as v', 'v.id', '=', 'c.venue_id')
            ->leftJoin('match_scores as ms', 'ms.game_id', '=', 'g.id')
            ->whereNull('g.deleted_at')
            ->whereNotIn('g.status', ['cancelled', 'completed'])
            ->whereRaw("g.starts_at + (g.duration_minutes * interval '1 minute') <= now()")
            ->where(function ($q) use ($userId) {
                $q->where('g.host_user_id', $userId)
                    ->orWhereExists(function ($sub) use ($userId) {
                        $sub->selectRaw('1')
                            ->from('game_participants as gp')
                            ->whereColumn('gp.game_id', 'g.id')
                            ->where('gp.user_id', $userId)
                            ->where('gp.status', 'confirmed');
                    });
            })
            ->where(function ($q) {
                $q->whereNull('ms.game_id')
                    ->orWhere('ms.status', '!=', 'completed');
            })
            ->orderBy('g.starts_at')
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
