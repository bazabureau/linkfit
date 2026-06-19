<?php

namespace App\Http\Controllers\Api\Concerns;

use App\Support\ApiException;
use Illuminate\Support\Facades\DB;

trait BlocksPendingGameResults
{
    protected function ensureNoPendingGameResult(string $userId): void
    {
        $pending = DB::table('games as g')
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
            ->first(['g.id']);

        if ($pending !== null) {
            throw new ApiException(409, 'PENDING_GAME_RESULT', 'Record your finished game result before continuing');
        }
    }

    protected function ensureNoPendingHostedGameResult(string $userId): void
    {
        $this->ensureNoPendingGameResult($userId);
    }
}
