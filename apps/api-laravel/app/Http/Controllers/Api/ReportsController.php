<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\AuthorizesAdminPermissions;
use App\Support\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class ReportsController extends ApiController
{
    use AuthorizesAdminPermissions;

    public function store(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $data = $this->validateBody($request, [
            'target_kind' => ['required', 'in:user,game,message,story,feed_event,feed_comment,venue_review,media'],
            'target_id' => ['required', 'uuid'],
            'reason' => ['required', 'in:spam,harassment,no_show,fake_profile,inappropriate_content,other'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ]);
        if ($data['target_kind'] === 'user' && (string) $user->id === (string) $data['target_id']) {
            throw ApiException::validation('You cannot report yourself');
        }
        if (! $this->targetExists($data['target_kind'], $data['target_id'])) {
            throw ApiException::notFound('Report target not found');
        }
        $id = (string) Str::uuid();
        DB::table('reports')->insert([
            'id' => $id,
            'reporter_user_id' => $user->id,
            'target_kind' => $data['target_kind'],
            'target_id' => $data['target_id'],
            'reason' => $data['reason'],
            'notes' => $data['notes'] ?? null,
            'status' => 'pending',
            'created_at' => now(),
        ]);

        return response()->json($this->reportPayload(DB::table('reports')->where('id', $id)->first()), 201);
    }

    public function mine(Request $request): JsonResponse
    {
        $reports = DB::table('reports')
            ->where('reporter_user_id', $this->authUser($request)->id)
            ->orderByDesc('created_at')
            ->limit(100)
            ->get();
        $users = $this->prefetchReportUsers($reports);

        return response()->json([
            'reports' => $reports->map(fn ($r) => $this->reportPayload($r, false, $users))->values(),
            'next_cursor' => null,
        ]);
    }

    public function adminIndex(Request $request): JsonResponse
    {
        $this->requireAdminPermission($request, 'reports');
        $limit = min(max((int) $request->query('limit', 25), 1), 100);
        $offset = max((int) $request->query('offset', 0), 0);
        $status = $request->query('status');
        $kind = $request->query('target_kind');
        $reason = $request->query('reason');
        $term = trim((string) $request->query('q', ''));
        $query = DB::table('reports')
            ->when($status, fn ($q) => $q->where('status', $status))
            ->when($kind, fn ($q) => $q->where('target_kind', $kind))
            ->when($reason, fn ($q) => $q->where('reason', $reason))
            ->when($term !== '', function ($q) use ($term) {
                $like = '%'.$term.'%';
                $q->where(function ($qq) use ($like) {
                    $qq->where('notes', 'ilike', $like)
                        ->orWhereExists(function ($sub) use ($like) {
                            $sub->selectRaw('1')
                                ->from('users')
                                ->whereColumn('users.id', 'reports.reporter_user_id')
                                ->where(function ($userQuery) use ($like) {
                                    $userQuery->where('users.email', 'ilike', $like)
                                        ->orWhere('users.display_name', 'ilike', $like);
                                });
                        });
                });
            });
        $total = (clone $query)->count();

        $reports = $query
            ->orderByDesc('created_at')
            ->offset($offset)
            ->limit($limit)
            ->get();
        $users = $this->prefetchReportUsers($reports);

        return response()->json([
            'items' => $reports->map(fn ($r) => $this->reportPayload($r, false, $users))->values(),
            'total' => $total,
        ]);
    }

    public function adminShow(Request $request, string $id): JsonResponse
    {
        $this->requireAdminPermission($request, 'reports');
        $row = DB::table('reports')->where('id', $id)->first();
        if ($row === null) {
            throw ApiException::notFound('Report not found');
        }

        return response()->json([
            ...$this->reportPayload($row, true),
            'same_target_pending_count' => DB::table('reports')
                ->where('target_kind', $row->target_kind)
                ->where('target_id', $row->target_id)
                ->where('status', 'pending')
                ->count(),
            'recent_same_target_reports' => DB::table('reports')
                ->where('target_kind', $row->target_kind)
                ->where('target_id', $row->target_id)
                ->orderByDesc('created_at')
                ->limit(20)
                ->get()
                ->map(fn ($report) => $this->reportPayload($report)),
            'audit' => DB::table('audit_log as a')
                ->leftJoin('users as u', 'u.id', '=', 'a.actor_user_id')
                ->where('a.entity', 'reports')
                ->where('a.entity_id', $id)
                ->orderByDesc('a.created_at')
                ->limit(20)
                ->get(['a.*', 'u.display_name as actor_display_name', 'u.email as actor_email'])
                ->map(fn ($event) => [
                    'id' => (string) $event->id,
                    'actor_user_id' => $event->actor_user_id ? (string) $event->actor_user_id : null,
                    'actor_display_name' => $event->actor_display_name,
                    'actor_email' => $event->actor_email,
                    'action' => $event->action,
                    'metadata' => json_decode((string) $event->metadata, true) ?: [],
                    'created_at' => $this->iso($event->created_at),
                ]),
        ]);
    }

    public function adminUpdate(Request $request, string $id): JsonResponse
    {
        $user = $this->requireAdminPermission($request, 'reports');
        $data = $this->validateBody($request, [
            'status' => ['required', 'in:reviewed,dismissed'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:4000'],
        ]);
        $before = DB::table('reports')->where('id', $id)->first();
        if ($before === null) {
            throw ApiException::notFound('Report not found');
        }
        DB::table('reports')->where('id', $id)->update([
            'status' => $data['status'],
            'notes' => $data['notes'] ?? null,
            'reviewed_by_user_id' => $user->id,
            'reviewed_at' => now(),
        ]);
        $row = DB::table('reports')->where('id', $id)->first();
        if ($row === null) {
            throw ApiException::notFound('Report not found');
        }
        $this->auditWrite((string) $user->id, 'report.review', $id, [
            'from_status' => $before->status,
            'to_status' => $data['status'],
            'target_kind' => $before->target_kind,
            'target_id' => $before->target_id,
        ]);

        return response()->json($this->reportPayload($row, true));
    }

    /**
     * @param  array<string,object>|null  $users  prefetched users map for list callers
     */
    private function reportPayload(object $r, bool $includeTarget = false, ?array $users = null): array
    {
        $payload = [
            'id' => $r->id,
            'reporter_user_id' => $r->reporter_user_id,
            'reporter' => $this->userSummary($r->reporter_user_id, $users),
            'target_kind' => $r->target_kind,
            'target_id' => $r->target_id,
            'reason' => $r->reason,
            'status' => $r->status,
            'notes' => $r->notes,
            'reviewed_by_user_id' => $r->reviewed_by_user_id,
            'reviewed_by' => $r->reviewed_by_user_id ? $this->userSummary($r->reviewed_by_user_id, $users) : null,
            'reviewed_at' => $this->iso($r->reviewed_at),
            'created_at' => $this->iso($r->created_at),
        ];

        if ($includeTarget) {
            $payload['target'] = $this->targetSummary($r->target_kind, $r->target_id);
        }

        return $payload;
    }

    private function targetExists(string $kind, string $id): bool
    {
        return $this->targetSummary($kind, $id) !== null;
    }

    private function targetSummary(string $kind, string $id): ?array
    {
        if ($kind === 'user') {
            return $this->userSummary($id);
        }
        if ($kind === 'game') {
            $row = DB::table('games as g')
                ->leftJoin('users as u', 'u.id', '=', 'g.host_user_id')
                ->leftJoin('courts as c', 'c.id', '=', 'g.court_id')
                ->where('g.id', $id)
                ->first(['g.id', 'g.host_user_id', 'g.starts_at', 'g.status', 'g.notes', 'u.display_name as host_display_name', 'u.email as host_email', 'c.name as court_name']);
            if ($row === null) {
                return null;
            }

            return [
                'id' => (string) $row->id,
                'kind' => 'game',
                'status' => $row->status,
                'starts_at' => $this->iso($row->starts_at),
                'notes' => $row->notes,
                'court_name' => $row->court_name,
                'host' => [
                    'id' => (string) $row->host_user_id,
                    'display_name' => $row->host_display_name,
                    'email' => $row->host_email,
                ],
            ];
        }
        if ($kind === 'message') {
            $row = DB::table('messages as m')
                ->leftJoin('users as u', 'u.id', '=', 'm.sender_user_id')
                ->where('m.id', $id)
                ->first(['m.id', 'm.conversation_id', 'm.sender_user_id', 'm.body', 'm.created_at', 'u.display_name as sender_display_name', 'u.email as sender_email']);
            if ($row === null) {
                return null;
            }

            return [
                'id' => (string) $row->id,
                'kind' => 'message',
                'conversation_id' => (string) $row->conversation_id,
                'body' => mb_substr((string) $row->body, 0, 500),
                'sender' => [
                    'id' => (string) $row->sender_user_id,
                    'display_name' => $row->sender_display_name,
                    'email' => $row->sender_email,
                ],
                'created_at' => $this->iso($row->created_at),
            ];
        }
        if ($kind === 'story') {
            $row = DB::table('stories as s')
                ->leftJoin('users as u', 'u.id', '=', 's.user_id')
                ->where('s.id', $id)
                ->first(['s.id', 's.user_id', 's.media_url', 's.media_type', 's.caption', 's.created_at', 's.expires_at', 'u.display_name as author_display_name', 'u.email as author_email']);
            if ($row === null) {
                return null;
            }

            return [
                'id' => (string) $row->id,
                'kind' => 'story',
                'media_url' => $row->media_url,
                'media_type' => $row->media_type,
                'caption' => $row->caption,
                'author' => [
                    'id' => (string) $row->user_id,
                    'display_name' => $row->author_display_name,
                    'email' => $row->author_email,
                ],
                'created_at' => $this->iso($row->created_at),
                'expires_at' => $this->iso($row->expires_at),
            ];
        }
        if ($kind === 'feed_event') {
            $row = DB::table('feed_events as f')
                ->leftJoin('users as u', 'u.id', '=', 'f.actor_user_id')
                ->where('f.id', $id)
                ->first(['f.id', 'f.type', 'f.actor_user_id', 'f.payload', 'f.visibility', 'f.created_at', 'u.display_name as actor_display_name', 'u.email as actor_email']);
            if ($row === null) {
                return null;
            }

            return [
                'id' => (string) $row->id,
                'kind' => 'feed_event',
                'type' => $row->type,
                'visibility' => $row->visibility,
                'payload' => json_decode((string) $row->payload, true) ?: null,
                'actor' => [
                    'id' => (string) $row->actor_user_id,
                    'display_name' => $row->actor_display_name,
                    'email' => $row->actor_email,
                ],
                'created_at' => $this->iso($row->created_at),
            ];
        }
        if ($kind === 'feed_comment') {
            $row = DB::table('feed_comments as fc')
                ->leftJoin('users as u', 'u.id', '=', 'fc.user_id')
                ->where('fc.id', $id)
                ->first(['fc.id', 'fc.event_id', 'fc.user_id', 'fc.body', 'fc.created_at', 'u.display_name as author_display_name', 'u.email as author_email']);
            if ($row === null) {
                return null;
            }

            return [
                'id' => (string) $row->id,
                'kind' => 'feed_comment',
                'event_id' => (string) $row->event_id,
                'body' => mb_substr((string) $row->body, 0, 500),
                'author' => [
                    'id' => (string) $row->user_id,
                    'display_name' => $row->author_display_name,
                    'email' => $row->author_email,
                ],
                'created_at' => $this->iso($row->created_at),
            ];
        }
        if ($kind === 'venue_review') {
            $row = DB::table('venue_reviews as vr')
                ->leftJoin('users as u', 'u.id', '=', 'vr.author_user_id')
                ->leftJoin('venues as v', 'v.id', '=', 'vr.venue_id')
                ->where('vr.id', $id)
                ->first(['vr.id', 'vr.venue_id', 'vr.author_user_id', 'vr.rating', 'vr.body', 'vr.created_at', 'u.display_name as author_display_name', 'u.email as author_email', 'v.name as venue_name']);
            if ($row === null) {
                return null;
            }

            return [
                'id' => (string) $row->id,
                'kind' => 'venue_review',
                'venue' => [
                    'id' => (string) $row->venue_id,
                    'name' => $row->venue_name,
                ],
                'rating' => (int) $row->rating,
                'body' => mb_substr((string) $row->body, 0, 500),
                'author' => [
                    'id' => (string) $row->author_user_id,
                    'display_name' => $row->author_display_name,
                    'email' => $row->author_email,
                ],
                'created_at' => $this->iso($row->created_at),
            ];
        }
        if ($kind === 'media') {
            $row = DB::table('media_assets as m')
                ->leftJoin('users as u', 'u.id', '=', 'm.user_id')
                ->where('m.id', $id)
                ->first(['m.id', 'm.user_id', 'm.url', 'm.mime', 'm.purpose', 'm.created_at', 'm.deleted_at', 'u.display_name as owner_display_name', 'u.email as owner_email']);
            if ($row === null) {
                return null;
            }

            return [
                'id' => (string) $row->id,
                'kind' => 'media',
                'url' => $row->url,
                'mime' => $row->mime,
                'purpose' => $row->purpose,
                'deleted_at' => $this->iso($row->deleted_at),
                'owner' => $row->user_id ? [
                    'id' => (string) $row->user_id,
                    'display_name' => $row->owner_display_name,
                    'email' => $row->owner_email,
                ] : null,
                'created_at' => $this->iso($row->created_at),
            ];
        }

        return null;
    }

    /**
     * @param  array<string,object>|null  $prefetched  keyed users map; when given,
     *                                                  reads from it instead of querying per id
     */
    private function userSummary(?string $id, ?array $prefetched = null): ?array
    {
        if ($id === null) {
            return null;
        }
        $user = $prefetched !== null
            ? ($prefetched[$id] ?? null)
            : DB::table('users')->where('id', $id)->first(['id', 'email', 'display_name', 'photo_url', 'admin_role', 'deleted_at']);
        if ($user === null) {
            return null;
        }

        return [
            'id' => (string) $user->id,
            'email' => $user->email,
            'display_name' => $user->display_name,
            'photo_url' => $user->photo_url,
            'admin_role' => $user->admin_role,
            'deleted_at' => $this->iso($user->deleted_at),
        ];
    }

    /**
     * Fetch the reporter + reviewer users referenced by a page of reports in ONE
     * query, keyed by id, so reportPayload() reads from the map instead of
     * issuing two userSummary() queries per report.
     *
     * @param  iterable<int,object>  $reports
     * @return array<string,object>
     */
    private function prefetchReportUsers(iterable $reports): array
    {
        $ids = [];
        foreach ($reports as $r) {
            if (! empty($r->reporter_user_id)) {
                $ids[$r->reporter_user_id] = true;
            }
            if (! empty($r->reviewed_by_user_id)) {
                $ids[$r->reviewed_by_user_id] = true;
            }
        }
        if ($ids === []) {
            return [];
        }

        return DB::table('users')
            ->whereIn('id', array_keys($ids))
            ->get(['id', 'email', 'display_name', 'photo_url', 'admin_role', 'deleted_at'])
            ->keyBy('id')
            ->all();
    }

    private function auditWrite(string $actorUserId, string $action, string $entityId, array $metadata = []): void
    {
        DB::table('audit_log')->insert([
            'id' => (string) Str::uuid(),
            'actor_user_id' => $actorUserId,
            'action' => $action,
            'entity' => 'reports',
            'entity_id' => $entityId,
            'metadata' => json_encode($metadata),
            'created_at' => now(),
        ]);
    }
}
