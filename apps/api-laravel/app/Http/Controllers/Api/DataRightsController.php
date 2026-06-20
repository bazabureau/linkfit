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

        return response()->json($this->deletionPayload(DB::table('account_deletion_requests')->where('user_id', $user->id)->first()), 202);
    }

    public function cancelDeletion(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        // Guard: a user who never scheduled a deletion has no row, so update()
        // touches 0 rows and ->first() returns null. Passing null into the
        // non-nullable deletionPayload() would 500. Return a clean 404 instead.
        if (! DB::table('account_deletion_requests')->where('user_id', $user->id)->exists()) {
            throw ApiException::notFound('No account deletion request to cancel');
        }
        DB::table('account_deletion_requests')->where('user_id', $user->id)->update([
            'status' => 'cancelled',
            'cancelled_at' => now(),
        ]);

        return response()->json($this->deletionPayload(DB::table('account_deletion_requests')->where('user_id', $user->id)->first()));
    }

    public function deletionStatus(Request $request): JsonResponse
    {
        $row = DB::table('account_deletion_requests')->where('user_id', $this->authUser($request)->id)->first();

        return response()->json($row ? $this->deletionPayload($row) : null);
    }

    public function requestExport(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $id = (string) Str::uuid();
        DB::table('data_export_requests')->insert([
            'id' => $id,
            'user_id' => $user->id,
            'status' => 'queued',
            'expires_at' => now()->addDays(7),
            'created_at' => now(),
        ]);

        return response()->json($this->exportPayload(DB::table('data_export_requests')->where('id', $id)->first()));
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
            'scheduled_at' => $this->iso($r->requested_at),
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
