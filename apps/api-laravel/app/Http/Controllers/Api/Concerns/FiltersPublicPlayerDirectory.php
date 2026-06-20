<?php

namespace App\Http\Controllers\Api\Concerns;

use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

trait FiltersPublicPlayerDirectory
{
    /** @var list<string> */
    private const PUBLIC_PLAYER_USERNAMES = [
        'hisrosie',
        'iamkamilismailov',
        'kamran-namazov',
    ];

    /** @var list<string> */
    private const PUBLIC_PLAYER_IDS = [
        '019edbc3-a5fb-7123-9e6f-cc5d6d897393',
    ];

    protected function wherePublicPlayerDirectoryAllowed(Builder $query, string $alias = 'u'): Builder
    {
        return $query->where(function ($q) use ($alias) {
            $q->whereIn(DB::raw("LOWER({$alias}.username)"), self::PUBLIC_PLAYER_USERNAMES)
                ->orWhereIn("{$alias}.id", self::PUBLIC_PLAYER_IDS);
        });
    }
}
