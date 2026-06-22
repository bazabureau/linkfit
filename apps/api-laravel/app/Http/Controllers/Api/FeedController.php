<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\AuthorizesAdminPermissions;
use App\Http\Controllers\Api\Concerns\FiltersBlockedUsers;
use App\Services\Feed\FeedService;
use App\Services\Notifications\PushDispatcher;
use App\Support\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class FeedController extends ApiController
{
    use AuthorizesAdminPermissions;
    use FiltersBlockedUsers;

    public function __construct(private readonly FeedService $feed) {}

    public function index(Request $request): JsonResponse
    {
        $query = $this->validateQuery($request, [
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
            'cursor' => ['nullable', 'string', 'max:500'],
        ]);
        $viewerId = $this->optionalViewerId($request);
        $limit = (int) ($query['limit'] ?? 50);
        $cursor = $this->decodeCursor($query['cursor'] ?? null);

        // Fold the per-row like/comment counts + the viewer's own "liked_by_me"
        // into the main query (was 3 queries PER ROW in eventPayload). Aggregates
        // are grouped subqueries COALESCE'd to 0; liked_by_me is a correlated
        // EXISTS bound to the viewer (a non-matching sentinel when anonymous, so
        // it's always false — matching the old short-circuit).
        $likeAgg = DB::table('feed_event_reactions')
            ->selectRaw('feed_event_id, count(*) as like_count')
            ->groupBy('feed_event_id');
        $commentAgg = DB::table('feed_comments')
            ->selectRaw('event_id, count(*) as comment_count')
            ->groupBy('event_id');
        $likedByMeId = $viewerId ?? '00000000-0000-0000-0000-000000000000';

        $rows = DB::table('feed_events as f')
            ->join('users as u', 'u.id', '=', 'f.actor_user_id')
            ->leftJoinSub($likeAgg, 'lc', 'lc.feed_event_id', '=', 'f.id')
            ->leftJoinSub($commentAgg, 'cc', 'cc.event_id', '=', 'f.id')
            ->whereNull('u.deleted_at')
            ->where(function ($q) use ($viewerId) {
                $q->where('f.visibility', 'public');
                if ($viewerId !== null) {
                    $q->orWhere('f.actor_user_id', $viewerId)
                        ->orWhereExists(function ($sq) use ($viewerId) {
                            $sq->selectRaw('1')
                                ->from('follows')
                                ->whereColumn('followed_user_id', 'f.actor_user_id')
                                ->where('follower_user_id', $viewerId);
                        });
                }
            })
            ->when($viewerId !== null, fn ($q) => $this->whereNotBlocked($q, $viewerId, 'f.actor_user_id'))
            // Keyset pagination: rows strictly older than the cursor (created_at,
            // id) so the client can actually page past the first screen.
            ->when($cursor !== null, fn ($q) => $q->where(function ($w) use ($cursor) {
                $w->where('f.created_at', '<', $cursor['ts'])
                    ->orWhere(fn ($x) => $x->where('f.created_at', $cursor['ts'])->where('f.id', '<', $cursor['id']));
            }))
            ->orderByDesc('f.created_at')
            ->orderByDesc('f.id')
            ->limit($limit + 1)
            ->selectRaw('exists (select 1 from feed_event_reactions r where r.feed_event_id = f.id and r.user_id = ?) as liked_by_me', [$likedByMeId])
            ->addSelect([
                'f.id',
                'f.type',
                'f.actor_user_id',
                'u.display_name',
                'u.photo_url',
                'f.payload',
                'f.visibility',
                'f.created_at',
                DB::raw('coalesce(lc.like_count, 0) as like_count'),
                DB::raw('coalesce(cc.comment_count, 0) as comment_count'),
            ])
            ->get();

        $hasMore = $rows->count() > $limit;
        $pageRows = $rows->take($limit)->values();
        $items = $pageRows->map(fn ($r) => $this->eventPayload($r, $viewerId))->values();

        return response()->json([
            'items' => $items,
            'next_cursor' => $hasMore ? $this->encodeCursor($pageRows->last()) : null,
        ]);
    }

    public function like(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        $event = DB::table('feed_events')->where('id', $id)->first(['id', 'actor_user_id']);
        if ($event === null) {
            throw ApiException::validation('Unknown feed event');
        }

        // Only a NEW like notifies the author — an idempotent re-like (the
        // updateOrInsert just refreshing created_at) must not re-spam them.
        $alreadyLiked = DB::table('feed_event_reactions')
            ->where('feed_event_id', $id)
            ->where('user_id', $user->id)
            ->exists();

        DB::table('feed_event_reactions')->updateOrInsert(
            ['feed_event_id' => $id, 'user_id' => $user->id],
            ['created_at' => now()],
        );

        if (! $alreadyLiked) {
            // Best-effort: a notification failure must never fail the like.
            $this->notifyFeedAuthor(
                'like',
                (string) $event->actor_user_id,
                (string) $user->id,
                (string) ($user->display_name ?? ''),
                (string) $id,
            );
        }

        return response()->json(['likes_count' => $this->likesCount($id)]);
    }

    public function unlike(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        // Align with like(): validate the event exists before mutating, so a
        // bogus id returns a consistent validation error instead of silently
        // reporting a zero count for an event that never existed. Removing a
        // like that isn't there stays an idempotent no-op.
        if (! DB::table('feed_events')->where('id', $id)->exists()) {
            throw ApiException::validation('Unknown feed event');
        }
        DB::table('feed_event_reactions')
            ->where('feed_event_id', $id)
            ->where('user_id', $user->id)
            ->delete();

        return response()->json(['likes_count' => $this->likesCount($id)]);
    }

    public function comments(Request $request, string $eventId): JsonResponse
    {
        $limit = min(max((int) $request->query('limit', 50), 1), 100);
        $viewerId = $this->optionalViewerId($request);
        // Keyset pagination: the previously-emitted next_cursor was never read,
        // so callers could never page past the first screen. Consume it here via
        // the same (created_at, id) keyset used by index() / decodeCursor().
        $cursor = $this->decodeCursor((string) $request->query('cursor', ''));
        $rows = DB::table('feed_comments as c')
            ->join('users as u', 'u.id', '=', 'c.user_id')
            ->where('c.event_id', $eventId)
            ->when($viewerId !== null, fn ($q) => $this->whereNotBlocked($q, $viewerId, 'c.user_id'))
            ->when($cursor !== null, fn ($q) => $q->where(function ($w) use ($cursor) {
                $w->where('c.created_at', '<', $cursor['ts'])
                    ->orWhere(fn ($x) => $x->where('c.created_at', $cursor['ts'])->where('c.id', '<', $cursor['id']));
            }))
            ->orderByDesc('c.created_at')
            ->orderByDesc('c.id')
            ->limit($limit + 1)
            ->get(['c.id', 'c.user_id', 'u.display_name', 'u.photo_url', 'c.body', 'c.created_at']);

        $hasMore = $rows->count() > $limit;
        $pageRows = $rows->take($limit)->values();

        return response()->json([
            'comments' => $pageRows->map(fn ($r) => [
                'id' => $r->id,
                'user_id' => $r->user_id,
                'user_display_name' => $r->display_name,
                'user_avatar_url' => $r->photo_url,
                'body' => $r->body,
                'created_at' => $this->iso($r->created_at),
            ])->values(),
            'next_cursor' => $hasMore ? $this->encodeCursor($pageRows->last()) : null,
            'total' => DB::table('feed_comments')->where('event_id', $eventId)->count(),
        ]);
    }

    public function storeComment(Request $request, string $eventId): JsonResponse
    {
        $user = $this->authUser($request);
        $data = $this->validateBody($request, [
            'body' => ['required', 'string', 'min:1', 'max:500'],
        ]);
        $event = DB::table('feed_events')->where('id', $eventId)->first(['id', 'actor_user_id']);
        if ($event === null) {
            throw ApiException::notFound('Feed event not found');
        }

        $id = (string) Str::uuid();
        DB::table('feed_comments')->insert([
            'id' => $id,
            'event_id' => $eventId,
            'user_id' => $user->id,
            'body' => trim($data['body']),
            'created_at' => now(),
        ]);

        // Best-effort: a notification failure must never fail the comment.
        $this->notifyFeedAuthor(
            'comment',
            (string) $event->actor_user_id,
            (string) $user->id,
            (string) ($user->display_name ?? ''),
            (string) $eventId,
        );

        $row = DB::table('feed_comments as c')
            ->join('users as u', 'u.id', '=', 'c.user_id')
            ->where('c.id', $id)
            ->first(['c.id', 'c.user_id', 'u.display_name', 'u.photo_url', 'c.body', 'c.created_at']);

        return response()->json([
            'id' => $row->id,
            'user_id' => $row->user_id,
            'user_display_name' => $row->display_name,
            'user_avatar_url' => $row->photo_url,
            'body' => $row->body,
            'created_at' => $this->iso($row->created_at),
        ], 201);
    }

    public function deleteComment(Request $request, string $commentId): JsonResponse
    {
        $user = $this->authUser($request);
        $comment = DB::table('feed_comments')->where('id', $commentId)->first();
        if ($comment === null) {
            throw ApiException::notFound('Comment not found');
        }
        $adminAction = $comment->user_id !== $user->id;
        if ($adminAction) {
            $this->requireAdminPermission($request, 'reports');
        }
        DB::table('feed_comments')->where('id', $commentId)->delete();
        if ($adminAction) {
            $this->auditWrite($user->id, 'feed_comment.delete', 'feed_comments', $commentId, [
                'comment_user_id' => $comment->user_id,
                'event_id' => $comment->event_id,
            ]);
        }

        return response()->json(null, 204);
    }

    private function eventPayload(object $r, ?string $viewerId): array
    {
        $data = json_decode($r->payload ?? '{}', true) ?: [];
        // Counts + liked_by_me are folded into index()'s query (no per-row queries).
        $likeCount = (int) ($r->like_count ?? 0);
        $commentCount = (int) ($r->comment_count ?? 0);

        // Server-rendered copy (P2#61): every client renders identical wording
        // for a given event without re-implementing the template. `title` is
        // the bold lead-in, `summary` the one-line card text, `body` the longer
        // detail variant. Templates can change here without an app release.
        $copy = $this->feed->summarize((string) $r->type, $data, (string) $r->display_name);

        return [
            'id' => $r->id,
            'type' => $r->type,
            // Flat actor fields consumed by the web client.
            'actor_user_id' => $r->actor_user_id,
            'actor_display_name' => $r->display_name,
            'actor_photo_url' => $r->photo_url,
            // Nested actor retained for existing (iOS / older) consumers.
            'actor' => [
                'id' => $r->actor_user_id,
                'display_name' => $r->display_name,
                'photo_url' => $r->photo_url,
            ],
            // Server-rendered copy — additive fields, existing fields unchanged.
            'title' => $copy['title'],
            'summary' => $copy['summary'],
            'body' => $copy['body'],
            // Web reads `data`; `payload` retained for backwards compatibility.
            'data' => $data,
            'payload' => $data,
            'visibility' => $r->visibility,
            'created_at' => $this->iso($r->created_at),
            // Web reads `like_count`/`comment_count`; `likes_count` retained.
            'like_count' => $likeCount,
            'comment_count' => $commentCount,
            'likes_count' => $likeCount,
            'liked_by_me' => $viewerId !== null && (bool) ($r->liked_by_me ?? false),
        ];
    }

    private function likesCount(string $eventId): int
    {
        return DB::table('feed_event_reactions')->where('feed_event_id', $eventId)->count();
    }

    /**
     * Enqueue a "like"/"comment" notification for the feed event's author.
     * Best-effort: any failure is swallowed so it can never fail the action.
     * Skips self-interaction and either-direction blocks. Mirrors the
     * notifications + push_notification_jobs shape used elsewhere.
     *
     * The `notification_type` enum has no `like`/`comment` value, so the closest
     * existing generic bucket — `system` — is used; the `kind`/`route` payload
     * lets the client route + badge it distinctly.
     */
    private function notifyFeedAuthor(string $kind, string $authorUserId, string $actorUserId, string $actorName, string $eventId): void
    {
        try {
            // Never notify yourself, and never across a block (either direction).
            if ($authorUserId === '' || $authorUserId === $actorUserId) {
                return;
            }
            if ($this->blockExistsBetween($actorUserId, $authorUserId)) {
                return;
            }

            // Resolve the actor's display name from the source of truth — the
            // auth model may not have it hydrated.
            $name = trim($actorName) !== ''
                ? trim($actorName)
                : (string) (DB::table('users')->where('id', $actorUserId)->value('display_name') ?? 'Someone');
            $name = $name !== '' ? $name : 'Someone';

            $title = $kind === 'comment' ? 'New comment' : 'New like';
            $body = $kind === 'comment'
                ? "{$name} commented on your post."
                : "{$name} liked your post.";
            $payload = [
                'kind' => $kind === 'comment' ? 'feed_comment' : 'feed_like',
                'route' => "/feed/{$eventId}",
                'event_id' => $eventId,
                'actor_user_id' => $actorUserId,
            ];

            DB::table('notifications')->insert([
                'id' => (string) Str::uuid(),
                'user_id' => $authorUserId,
                'type' => 'system',
                'title' => $title,
                'body' => $body,
                'payload' => json_encode($payload),
                'created_at' => now(),
            ]);

            $this->enqueuePush($authorUserId, 'system', $title, $body, $payload);
        } catch (\Throwable) {
            // Swallowed by design — a notification must never break the action.
        }
    }

    /**
     * Insert a pending push job mirroring the notification, then nudge the
     * dispatcher (fire-and-forget). No-ops when the push tables aren't present
     * (partial test schemas) and never throws into the caller.
     *
     * @param  array<string,mixed>  $payload
     */
    private function enqueuePush(string $userId, string $type, string $title, string $body, array $payload): void
    {
        if (! Schema::hasTable('push_notification_jobs')) {
            return;
        }

        DB::table('push_notification_jobs')->insert([
            'id' => (string) Str::uuid(),
            'user_id' => $userId,
            'type' => $type,
            'title' => $title,
            'body' => $body,
            'payload' => json_encode($payload),
            'status' => 'pending',
            'available_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        try {
            app(PushDispatcher::class)->process(50);
        } catch (\Throwable) {
            // The queued job is the source of truth; the worker retries.
        }
    }

    private function auditWrite(?string $actorUserId, string $action, string $entity, ?string $entityId = null, array $metadata = []): void
    {
        DB::table('audit_log')->insert([
            'id' => (string) Str::uuid(),
            'actor_user_id' => $actorUserId,
            'action' => $action,
            'entity' => $entity,
            'entity_id' => $entityId,
            'metadata' => json_encode($metadata),
            'created_at' => now(),
        ]);
    }
}
