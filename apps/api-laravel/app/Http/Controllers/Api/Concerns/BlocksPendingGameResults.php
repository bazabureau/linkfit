<?php

namespace App\Http\Controllers\Api\Concerns;

use App\Support\ApiException;
use Illuminate\Support\Facades\DB;

trait BlocksPendingGameResults
{
    protected function ensureNoPendingHostedGameResult(string $userId): void
    {
        $pending = DB::table('games as g')
            ->leftJoin('match_scores as ms', 'ms.game_id', '=', 'g.id')
            ->where('g.host_user_id', $userId)
            ->whereNull('g.deleted_at')
            ->whereIn('g.status', ['open', 'full'])
            ->whereRaw("g.starts_at + (g.duration_minutes * interval '1 minute') <= now()")
            ->where(function ($q) {
                $q->whereNull('ms.game_id')
                    ->orWhere('ms.status', '!=', 'completed');
            })
            ->orderBy('g.starts_at')
            ->first(['g.id']);

        if ($pending !== null) {
            throw ApiException::conflict('Record your finished game result before continuing');
        }
    }
}
