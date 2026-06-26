<?php

namespace App\Http\Controllers\Api;

use App\Support\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class DataRightsController extends ApiController
{
    public function requestDeletion(Request $request): JsonResponse
    {
        $user = $this->authUser($request);

        // Soft-delete the account and revoke sessions atomically with the
        // scheduling row. PII is intentionally NOT anonymized here so the
        // 30-day cancellation window can cleanly restore the account; the
        // hard purge is a separate scheduled sweep (not yet wired).
        DB::transaction(function () use ($user): void {
            DB::table('account_deletion_requests')->updateOrInsert(
                ['user_id' => $user->id],
                [
                    'requested_at' => now(),
                    'hard_delete_at' => now()->addDays(30),
                    'status' => 'scheduled',
                    'cancelled_at' => null,
                    'completed_at' => null,
                ],
            );

            // Soft-delete: login does whereNull('deleted_at'), so this blocks
            // any further sign-in immediately.
            DB::table('users')->where('id', $user->id)->update(['deleted_at' => now()]);

            // Revoke every live refresh token for this user (same columns the
            // TokenService uses) so existing sessions can no longer refresh.
            DB::table('refresh_tokens')
                ->where('user_id', $user->id)
                ->whereNull('revoked_at')
                ->update(['revoked_at' => now()]);
        });

        // Re-read after commit. If a concurrent purge removed the row in the
        // window, first() is null — fail clean instead of passing null into the
        // non-nullable deletionPayload() and surfacing a raw TypeError 500
        // (mirrors the same guard in cancelDeletion()).
        $row = DB::table('account_deletion_requests')->where('user_id', $user->id)->first();
        if ($row === null) {
            throw ApiException::internal('Failed to schedule account deletion');
        }

        return response()->json($this->deletionPayload($row), 202);
    }

    public function cancelDeletion(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        // Guard: a user who never scheduled a deletion has no row, so update()
        // touches 0 rows and ->first() returns null. Passing null into the
        // non-nullable deletionPayload() would 500. Return a clean 404 instead.
        // Only a still-scheduled request is cancellable — once it is already
        // cancelled or completed there is nothing to undo.
        $existing = DB::table('account_deletion_requests')->where('user_id', $user->id)->first();
        if ($existing === null || $existing->status !== 'scheduled') {
            throw ApiException::notFound('No account deletion request to cancel');
        }

        // Re-activate the account atomically with marking the request cancelled.
        // PII was never destroyed, so clearing deleted_at fully restores access.
        DB::transaction(function () use ($user): void {
            DB::table('account_deletion_requests')->where('user_id', $user->id)->update([
                'status' => 'cancelled',
                'cancelled_at' => now(),
            ]);

            DB::table('users')->where('id', $user->id)->update(['deleted_at' => null]);
        });

        // Re-read after commit. If a concurrent purge removed the row between the
        // transaction and this read, first() is null — fail clean instead of
        // passing null into the non-nullable deletionPayload() and 500-ing.
        $row = DB::table('account_deletion_requests')->where('user_id', $user->id)->first();
        if ($row === null) {
            throw ApiException::internal('Failed to cancel deletion');
        }

        return response()->json($this->deletionPayload($row));
    }

    public function deletionStatus(Request $request): JsonResponse
    {
        $row = DB::table('account_deletion_requests')->where('user_id', $this->authUser($request)->id)->first();

        return response()->json($row ? $this->deletionPayload($row) : null);
    }

    public function requestExport(Request $request): JsonResponse
    {
        $user = $this->authUser($request);

        // This route is not throttled and each request fans out into a
        // background PII-export job, so a blind insert lets a user spam
        // unbounded export rows/jobs. Coalesce onto any still-in-flight
        // request (queued/processing) instead of creating a duplicate — the
        // client polls latestExport() for the same row either way, so the
        // wire shape is unchanged.
        $pending = DB::table('data_export_requests')
            ->where('user_id', $user->id)
            ->whereIn('status', ['queued', 'processing'])
            ->orderByDesc('created_at')
            ->first();
        if ($pending !== null) {
            return response()->json($this->exportPayload($pending));
        }

        $id = (string) Str::uuid();
        DB::table('data_export_requests')->insert([
            'id' => $id,
            'user_id' => $user->id,
            'status' => 'queued',
            'expires_at' => now()->addDays(7),
            'created_at' => now(),
        ]);

        // Read back the row we just inserted. A null here can only mean a
        // concurrent purge removed it — fail clean rather than 500-ing on a
        // TypeError from passing null into the non-nullable exportPayload().
        $row = DB::table('data_export_requests')->where('id', $id)->first();
        if ($row === null) {
            throw ApiException::internal('Failed to create export request');
        }

        return response()->json($this->exportPayload($row));
    }

    public function latestExport(Request $request): JsonResponse
    {
        $row = DB::table('data_export_requests')
            ->where('user_id', $this->authUser($request)->id)
            ->orderByDesc('created_at')
            ->first();

        return response()->json($row ? $this->exportPayload($row) : null);
    }

    private function deletionPayload(object $r): array
    {
        return [
            'id' => $r->user_id,
            'user_id' => $r->user_id,
            'status' => $r->status,
            'requested_at' => $this->iso($r->requested_at),
            'scheduled_at' => $this->iso($r->hard_delete_at),
            'hard_delete_at' => $this->iso($r->hard_delete_at),
            'cancelled_at' => $this->iso($r->cancelled_at),
            'completed_at' => $this->iso($r->completed_at),
        ];
    }

    private function exportPayload(object $r): array
    {
        return [
            'id' => $r->id,
            'user_id' => $r->user_id,
            'status' => $r->status,
            'download_url' => $r->download_url,
            'expires_at' => $this->iso($r->expires_at),
            'created_at' => $this->iso($r->created_at),
            'completed_at' => $this->iso($r->completed_at),
        ];
    }
}
