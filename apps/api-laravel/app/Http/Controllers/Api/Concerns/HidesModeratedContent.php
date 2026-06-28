<?php

namespace App\Http\Controllers\Api\Concerns;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Helpers for honouring the moderation_hides ledger across public read paths.
 * A target is "actively hidden" when it has a moderation_hides row whose
 * cleared_at IS NULL — such content must be excluded from (or redacted in)
 * list/feed responses so reported UGC disappears for everyone while a
 * moderator reviews it (Apple Guideline 1.2).
 *
 * Every method is a no-op when the moderation_hides table is absent (older
 * test schemas that don't create it), so wiring these into a controller never
 * breaks a test that hasn't opted into the table.
 */
trait HidesModeratedContent
{
    /**
     * Active-hidden target ids for a given target_kind. When $candidateIds is
     * provided, the result is scoped to that set (cheaper for paginated reads
     * where only a handful of ids are on the current page).
     *
     * @param  array<int,string>|null  $candidateIds
     * @return array<int,string>
     */
    protected function activeHiddenTargetIds(string $targetKind, ?array $candidateIds = null): array
    {
        if (! Schema::hasTable('moderation_hides')) {
            return [];
        }

        return DB::table('moderation_hides')
            ->where('target_kind', $targetKind)
            ->whereNull('cleared_at')
            ->when($candidateIds !== null, fn ($q) => $q->whereIn('target_id', $candidateIds))
            ->pluck('target_id')
            ->map(fn ($v) => (string) $v)
            ->all();
    }

    /** True when an ACTIVE (cleared_at IS NULL) hide exists for this target. */
    protected function isTargetActivelyHidden(string $targetKind, string $targetId): bool
    {
        if (! Schema::hasTable('moderation_hides')) {
            return false;
        }

        return DB::table('moderation_hides')
            ->where('target_kind', $targetKind)
            ->where('target_id', $targetId)
            ->whereNull('cleared_at')
            ->exists();
    }
}
