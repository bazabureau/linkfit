<?php

namespace App\Http\Controllers\Api\Concerns;

use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Helpers for honouring user_blocks(blocker_user_id, blocked_user_id) across
 * discovery + action surfaces. "Discovery" hides a user from the viewer in
 * EITHER block direction; "action" forbids a blocked user from initiating
 * contact toward the person who blocked them.
 */
trait FiltersBlockedUsers
{
    /**
     * Constrain a query so rows whose $userColumn is in a block relationship
     * with the viewer (either direction) are excluded. No-op when anonymous.
     */
    protected function whereNotBlocked(Builder $query, ?string $viewerId, string $userColumn): Builder
    {
        if ($viewerId === null) {
            return $query;
        }

        return $query->whereNotExists(function ($q) use ($viewerId, $userColumn) {
            $q->selectRaw('1')->from('user_blocks as ub')
                ->where(function ($w) use ($viewerId, $userColumn) {
                    $w->where(fn ($x) => $x->where('ub.blocker_user_id', $viewerId)->whereColumn('ub.blocked_user_id', $userColumn))
                        ->orWhere(fn ($x) => $x->where('ub.blocked_user_id', $viewerId)->whereColumn('ub.blocker_user_id', $userColumn));
                });
        });
    }

    /** True when $actorId is blocked BY $targetId (actor may not initiate toward target). */
    protected function isBlockedBy(string $actorId, string $targetId): bool
    {
        return DB::table('user_blocks')
            ->where('blocker_user_id', $targetId)
            ->where('blocked_user_id', $actorId)
            ->exists();
    }

    /** True when a block exists in EITHER direction between the two users. */
    protected function blockExistsBetween(string $a, string $b): bool
    {
        return DB::table('user_blocks')
            ->where(fn ($q) => $q->where('blocker_user_id', $a)->where('blocked_user_id', $b))
            ->orWhere(fn ($q) => $q->where('blocker_user_id', $b)->where('blocked_user_id', $a))
            ->exists();
    }
}
