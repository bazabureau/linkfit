<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\FiltersBlockedUsers;
use App\Http\Controllers\Api\Concerns\FiltersPublicPlayerDirectory;
use App\Services\Notifications\PushDispatcher;
use App\Support\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class SocialController extends ApiController
{
    use FiltersBlockedUsers;
    use FiltersPublicPlayerDirectory;

    public function players(Request $request): JsonResponse
    {
        $query = $this->validateQuery($request, [
            'q' => ['nullable', 'string', 'max:80'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        // Optional viewer (route may be public); used to resolve per-row follow state.
        $viewerId = $this->optionalViewerId($request);

        $rows = $this->playersBaseQuery($viewerId === null)
            ->when(! empty($query['q']), function ($q) use ($query) {
                $needle = '%'.$query['q'].'%';
                $q->where(function ($qq) use ($needle) {
                    $qq->where('u.display_name', 'ilike', $needle)
                        ->orWhere('u.username', 'ilike', $needle);
                });
            })
            ->when($viewerId !== null, fn ($q) => $this->whereNotBlocked($q, $viewerId, 'u.id'))
            ->orderBy('u.display_name')
            ->limit((int) ($query['limit'] ?? 50))
            ->get();

        $followedIds = $this->followedIds($viewerId, $rows->pluck('id')->all());

        return response()->json([
            'items' => $rows->map(fn ($u) => $this->playerPayload($u, $followedIds)),
        ]);
    }

    public function search(Request $request): JsonResponse
    {
        $q = (string) $request->query('q', '');
        $type = $request->query('type');
        $limit = min(max((int) $request->query('limit', 20), 1), 50);
        $viewerId = $this->optionalViewerId($request);

        $players = collect();
        if ($type === null || $type === 'players') {
            $players = $this->playersBaseQuery($viewerId === null)
                ->where('u.display_name', 'ilike', '%'.$q.'%')
                ->when($viewerId !== null, fn ($qq) => $this->whereNotBlocked($qq, $viewerId, 'u.id'))
                ->orderBy('u.display_name')
                ->limit($limit)
                ->get()
                ->map(fn ($u) => [
                    'id' => $u->id,
                    'display_name' => $u->display_name,
                    'photo_url' => $u->photo_url,
                    'primary_sport' => $u->primary_sport,
                    'primary_elo' => $u->primary_elo !== null ? (int) $u->primary_elo : null,
                ]);
        }

        $games = collect();
        if ($type === null || $type === 'games') {
            $games = DB::table('games as g')
                ->join('sports as s', 's.id', '=', 'g.sport_id')
                ->join('users as h', 'h.id', '=', 'g.host_user_id')
                ->leftJoin('courts as c', 'c.id', '=', 'g.court_id')
                ->leftJoin('venues as v', 'v.id', '=', 'c.venue_id')
                ->whereIn('s.slug', ['padel', 'tennis'])
                // A game search row leaks the host's identity (display_name) and
                // their hosted game. Anonymous viewers may only see games hosted by
                // the curated public directory (matching the players sub-query);
                // signed-in viewers see all except hosts blocked either way.
                ->when($viewerId === null, fn ($qq) => $this->wherePublicPlayerDirectoryAllowed($qq, 'h'))
                ->when($viewerId !== null, fn ($qq) => $this->whereNotBlocked($qq, $viewerId, 'h.id'))
                ->where(function ($builder) use ($q) {
                    $builder->where('h.display_name', 'ilike', '%'.$q.'%')
                        ->orWhere('v.name', 'ilike', '%'.$q.'%')
                        ->orWhere('g.notes', 'ilike', '%'.$q.'%');
                })
                ->orderBy('g.starts_at')
                ->limit($limit)
                ->get([
                    'g.id',
                    's.slug as sport_slug',
                    'h.display_name as host_display_name',
                    'v.name as venue_name',
                    'g.starts_at',
                    'g.notes',
                    'g.status',
                ])
                ->map(fn ($g) => [
                    'id' => $g->id,
                    'sport_slug' => $g->sport_slug,
                    'host_display_name' => $g->host_display_name,
                    'venue_name' => $g->venue_name,
                    'starts_at' => $this->iso($g->starts_at),
                    'notes' => $g->notes,
                    'status' => $g->status,
                ]);
        }

        $tournaments = collect();
        if ($type === null || $type === 'tournaments') {
            $tournaments = DB::table('tournaments as t')
                ->join('sports as s', 's.id', '=', 't.sport_id')
                ->leftJoin('venues as v', 'v.id', '=', 't.venue_id')
                ->whereIn('s.slug', ['padel', 'tennis'])
                ->where(function ($builder) use ($q) {
                    $builder->where('t.name', 'ilike', '%'.$q.'%')
                        ->orWhere('v.name', 'ilike', '%'.$q.'%');
                })
                ->orderBy('t.starts_at')
                ->limit($limit)
                ->get([
                    't.id',
                    't.name',
                    's.slug as sport_slug',
                    'v.name as venue_name',
                    't.starts_at',
                    't.status',
                ])
                ->map(fn ($t) => [
                    'id' => $t->id,
                    'name' => $t->name,
                    'sport_slug' => $t->sport_slug,
                    'venue_name' => $t->venue_name,
                    'starts_at' => $this->iso($t->starts_at),
                    'status' => $t->status,
                ]);
        }

        $venues = collect();
        if ($type === null || $type === 'venues') {
            $venues = DB::table('venues')
                ->where('name', 'ilike', '%'.$q.'%')
                ->orderBy('name')
                ->limit($limit)
                ->get(['id', 'name', 'address', 'is_partner'])
                ->map(fn ($v) => [
                    'id' => $v->id,
                    'name' => $v->name,
                    'address' => $v->address,
                    'is_partner' => (bool) $v->is_partner,
                ]);
        }

        return response()->json([
            'query' => $q,
            'players' => $players,
            'games' => $games,
            'tournaments' => $tournaments,
            'venues' => $venues,
        ]);
    }

    public function profile(Request $request, string $id): JsonResponse
    {
        // The route param may be either a UUID, an 8-char short id, or a
        // human-readable username.
        $isUuid = (bool) preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $id);
        $isShortId = (bool) preg_match('/^[0-9a-f]{8}$/i', $id);
        $user = DB::table('users')
            ->when($isUuid, fn ($q) => $q->where('id', $id))
            // Short id = the first 8 hex chars (4 bytes) of the uuid. Resolve via a
            // uuid range predicate the PK index can serve (id >= lo AND id <= hi),
            // instead of `id::text ilike 'x%'` which forces a full table scan on
            // this PUBLIC, unauthenticated deep-link route. UUIDs are stored
            // canonically lowercase, so lowercase the prefix.
            ->when($isShortId, function ($q) use ($id) {
                $prefix = strtolower($id);
                if (DB::connection()->getDriverName() === 'pgsql') {
                    $lo = $prefix.'-0000-0000-0000-000000000000';
                    $hi = $prefix.'-ffff-ffff-ffff-ffffffffffff';
                    $q->whereRaw('id >= ?::uuid AND id <= ?::uuid', [$lo, $hi]);
                } else {
                    // sqlite (tests): ids are plain strings; a case-insensitive
                    // prefix LIKE keeps the same matching behaviour.
                    $q->whereRaw('lower(id) like ?', [$prefix.'%']);
                }
            })
            ->when(! $isUuid && ! $isShortId, fn ($q) => $q->whereRaw('LOWER(username) = ?', [mb_strtolower($id)]))
            ->whereNull('deleted_at')
            ->first();
        if ($user === null) {
            throw ApiException::notFound('User not found');
        }
        // Downstream queries key off the resolved UUID, not the route param.
        $id = (string) $user->id;

        // Optional viewer (route is public; a Bearer token is read if present).
        $viewerId = $this->optionalViewerId($request);
        $this->assertProfileVisibleToViewer($user, $viewerId);
        // A blocked relationship (either direction) hides the profile entirely.
        if ($viewerId !== null && (string) $viewerId !== $id && $this->blockExistsBetween((string) $viewerId, $id)) {
            throw ApiException::notFound('User not found');
        }

        $followersCount = (int) DB::table('follows')->where('followed_user_id', $id)->count();
        $followingCount = (int) DB::table('follows')->where('follower_user_id', $id)->count();
        $isFollowedByMe = $viewerId !== null && (string) $viewerId !== (string) $id
            && DB::table('follows')
                ->where('follower_user_id', $viewerId)
                ->where('followed_user_id', $id)
                ->exists();

        // Primary sport stat (best of padel/tennis) for the header ELO/reliability.
        $primary = DB::table('player_sport_stats as ps')
            ->join('sports as s', 's.id', '=', 'ps.sport_id')
            ->where('ps.user_id', $id)
            ->whereIn('s.slug', ['padel', 'tennis'])
            ->orderByDesc('ps.games_played')
            ->orderByDesc('ps.elo_rating')
            ->first(['ps.elo_rating', 'ps.reliability_score']);

        return response()->json([
            ...$this->publicUser($user),
            'primary_elo' => $primary && $primary->elo_rating !== null ? (int) $primary->elo_rating : null,
            'reliability_score' => $primary && $primary->reliability_score !== null ? (int) $primary->reliability_score : null,
            'followers_count' => $followersCount,
            'following_count' => $followingCount,
            'is_followed_by_me' => $isFollowedByMe,
            // iOS `SportStats` requires `sport_slug` (non-optional) — it lives on
            // the `sports` table, so join it in. Selecting the exact fields the
            // client decodes (sport_id, sport_slug, elo_rating, games_played,
            // games_won, reliability_score) also drops the internal columns
            // (last_recalc_at, updated_at) the client doesn't expect.
            'stats' => DB::table('player_sport_stats as ps')
                ->join('sports as s', 's.id', '=', 'ps.sport_id')
                ->where('ps.user_id', $id)
                ->get([
                    'ps.sport_id',
                    's.slug as sport_slug',
                    'ps.elo_rating',
                    'ps.games_played',
                    'ps.games_won',
                    'ps.reliability_score',
                ]),
        ]);
    }

    public function follow(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        if ((string) $id === (string) $user->id) {
            throw ApiException::validation('You cannot follow yourself');
        }
        // Target must be a real, non-deleted user with no block either way
        // (you can't follow someone who blocked you, nor someone you blocked).
        if (! DB::table('users')->where('id', $id)->whereNull('deleted_at')->exists()) {
            throw ApiException::notFound('User not found');
        }
        if ($this->blockExistsBetween((string) $user->id, (string) $id)) {
            throw ApiException::forbidden('You cannot follow this user');
        }

        // Only a genuinely new follow edge should fire a notification — a
        // re-follow (idempotent updateOrInsert touching created_at) must not
        // re-spam the target.
        $alreadyFollowing = DB::table('follows')
            ->where('follower_user_id', $user->id)
            ->where('followed_user_id', $id)
            ->exists();

        DB::table('follows')->updateOrInsert([
            'follower_user_id' => $user->id,
            'followed_user_id' => $id,
        ], ['created_at' => now()]);

        if (! $alreadyFollowing) {
            // Best-effort: a notification failure must never fail the follow.
            $this->notifyFollow((string) $id, (string) $user->id, (string) ($user->display_name ?? ''));
        }

        return response()->json(['ok' => true]);
    }

    public function unfollow(Request $request, string $id): JsonResponse
    {
        DB::table('follows')
            ->where('follower_user_id', $this->authUser($request)->id)
            ->where('followed_user_id', $id)
            ->delete();

        return response()->json(null, 204);
    }

    public function followers(Request $request, string $id): JsonResponse
    {
        $limit = min(max((int) request()->query('limit', 30), 1), 100);
        $offset = max((int) request()->query('offset', 0), 0);
        $viewerId = $this->optionalViewerId($request);
        $this->assertSocialGraphVisibleToViewer($id, $viewerId);
        $rows = DB::table('follows as f')
            ->join('users as u', 'u.id', '=', 'f.follower_user_id')
            ->where('f.followed_user_id', $id)
            ->whereNull('u.deleted_at')
            ->when($viewerId !== null, fn ($q) => $this->whereNotBlocked($q, $viewerId, 'u.id'))
            ->orderByDesc('f.created_at')
            ->offset($offset)
            ->limit($limit + 1)
            ->get([
                'u.id',
                'u.username',
                'u.display_name',
                'u.photo_url',
                'u.is_vip',
                'u.vip_expires_at',
                'u.vip_badge_label',
                'u.is_verified',
                'u.is_ambassador',
                'f.created_at as followed_at',
            ]);

        return response()->json($this->followsPage($rows, $limit, $offset, $viewerId));
    }

    public function removeFollower(Request $request, string $id, string $followerId): JsonResponse
    {
        if ($this->authUser($request)->id !== $id) {
            throw ApiException::forbidden('Only the profile owner can remove followers');
        }
        DB::table('follows')
            ->where('follower_user_id', $followerId)
            ->where('followed_user_id', $id)
            ->delete();

        return response()->json(null, 204);
    }

    public function following(Request $request, string $id): JsonResponse
    {
        $limit = min(max((int) request()->query('limit', 30), 1), 100);
        $offset = max((int) request()->query('offset', 0), 0);
        $viewerId = $this->optionalViewerId($request);
        $this->assertSocialGraphVisibleToViewer($id, $viewerId);
        $rows = DB::table('follows as f')
            ->join('users as u', 'u.id', '=', 'f.followed_user_id')
            ->where('f.follower_user_id', $id)
            ->whereNull('u.deleted_at')
            ->when($viewerId !== null, fn ($q) => $this->whereNotBlocked($q, $viewerId, 'u.id'))
            ->orderByDesc('f.created_at')
            ->offset($offset)
            ->limit($limit + 1)
            ->get([
                'u.id',
                'u.username',
                'u.display_name',
                'u.photo_url',
                'u.is_vip',
                'u.vip_expires_at',
                'u.vip_badge_label',
                'u.is_verified',
                'u.is_ambassador',
                'f.created_at as followed_at',
            ]);

        return response()->json($this->followsPage($rows, $limit, $offset, $viewerId));
    }

    public function block(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        if ((string) $user->id === $id) {
            throw ApiException::validation('You cannot block yourself');
        }
        if (! DB::table('users')->where('id', $id)->whereNull('deleted_at')->exists()) {
            throw ApiException::notFound('User not found');
        }

        DB::transaction(function () use ($user, $id) {
            DB::table('user_blocks')->updateOrInsert([
                'blocker_user_id' => $user->id,
                'blocked_user_id' => $id,
            ], ['created_at' => now()]);

            DB::table('follows')
                ->where(fn ($q) => $q->where('follower_user_id', $user->id)->where('followed_user_id', $id))
                ->orWhere(fn ($q) => $q->where('follower_user_id', $id)->where('followed_user_id', $user->id))
                ->delete();

            $conversationIds = DB::table('conversation_participants as a')
                ->join('conversation_participants as b', 'b.conversation_id', '=', 'a.conversation_id')
                ->join('conversations as c', 'c.id', '=', 'a.conversation_id')
                ->where('a.user_id', $user->id)
                ->where('b.user_id', $id)
                ->where(fn ($q) => $q->where('c.kind', 'direct')->orWhereNull('c.kind'))
                ->pluck('a.conversation_id');

            if ($conversationIds->isNotEmpty()) {
                DB::table('conversation_participants')
                    ->whereIn('conversation_id', $conversationIds->all())
                    ->whereIn('user_id', [$user->id, $id])
                    ->update(['left_at' => now()]);
            }
        });

        return response()->json(['ok' => true]);
    }

    public function unblock(Request $request, string $id): JsonResponse
    {
        DB::table('user_blocks')
            ->where('blocker_user_id', $this->authUser($request)->id)
            ->where('blocked_user_id', $id)
            ->delete();

        return response()->json(null, 204);
    }

    public function blocks(Request $request): JsonResponse
    {
        return response()->json([
            'items' => DB::table('user_blocks as b')
                ->join('users as u', 'u.id', '=', 'b.blocked_user_id')
                ->where('b.blocker_user_id', $this->authUser($request)->id)
                ->orderByDesc('b.created_at')
                ->get(['u.id', 'u.display_name', 'u.photo_url', 'b.created_at as blocked_at'])
                ->map(fn ($u) => [
                    'user_id' => $u->id,
                    'display_name' => $u->display_name,
                    'photo_url' => $u->photo_url,
                    'blocked_at' => $this->iso($u->blocked_at),
                ]),
        ]);
    }

    /**
     * Enqueue a "new follower" notification for the followed user. Best-effort:
     * any failure (missing tables under a partial test schema, push hiccup) is
     * swallowed so it can never fail the follow action. Mirrors the
     * notifications + push_notification_jobs shape used by SquadsController.
     *
     * There is no dedicated `follow` value in the `notification_type` enum, so
     * the closest existing generic bucket — `system` — is used; the `kind`/
     * `route` payload lets the client route + badge it as a follow.
     */
    private function notifyFollow(string $followedUserId, string $actorUserId, string $actorName = ''): void
    {
        try {
            // A block either way short-circuits the notification. follow() already
            // rejects blocked pairs, so this is belt-and-suspenders for callers.
            if ($this->blockExistsBetween($actorUserId, $followedUserId)) {
                return;
            }

            // Resolve the actor's display name from the source of truth — the
            // auth model may not have it hydrated (e.g. token-only contexts).
            $name = trim($actorName) !== ''
                ? trim($actorName)
                : (string) (DB::table('users')->where('id', $actorUserId)->value('display_name') ?? 'Someone');
            $name = $name !== '' ? $name : 'Someone';

            $title = 'New follower';
            $body = "{$name} started following you.";
            $payload = [
                'kind' => 'follow',
                'route' => "/players/{$actorUserId}",
                'actor_user_id' => $actorUserId,
            ];

            DB::table('notifications')->insert([
                'id' => (string) Str::uuid(),
                'user_id' => $followedUserId,
                'type' => 'system',
                'title' => $title,
                'body' => $body,
                'payload' => json_encode($payload),
                'created_at' => now(),
            ]);

            $this->enqueuePush($followedUserId, 'system', $title, $body, $payload);
        } catch (\Throwable) {
            // Swallowed by design — a notification must never break the action.
        }
    }

    /**
     * Insert a pending push job mirroring the notification, then nudge the
     * dispatcher (fire-and-forget). Guarded so it no-ops when the push tables
     * aren't present (partial test schemas) and never throws into the caller.
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

    /**
     * Public badge flags shared by every user-shaped payload (profile, player
     * cards, leaderboards). VIP is "active" only while not expired; `is_verified`
     * is the admin-granted official badge (distinct from email verification).
     * Null-safe so it works whether or not the migration columns exist yet.
     *
     * @return array<string,mixed>
     */
    private function badgeFields(object $u): array
    {
        $vipActive = (bool) ($u->is_vip ?? false)
            && (empty($u->vip_expires_at) || strtotime((string) $u->vip_expires_at) > time());

        return [
            'is_vip' => $vipActive,
            'vip_label' => $vipActive ? (trim((string) ($u->vip_badge_label ?? '')) ?: 'VIP') : null,
            'is_verified' => (bool) ($u->is_verified ?? false),
            'is_ambassador' => (bool) ($u->is_ambassador ?? false),
        ];
    }

    private function publicUser(object $u): array
    {
        // PUBLIC profile (any caller, even unauthenticated) — must NOT leak PII.
        // Email, exact home coordinates and email-verification state are private;
        // the viewer gets their own from /me.
        return [
            'id' => $u->id,
            'username' => $u->username ?? null,
            'display_name' => $u->display_name,
            'photo_url' => $u->photo_url,
            'created_at' => $this->iso($u->created_at),
            ...$this->badgeFields($u),
        ];
    }

    private function playersBaseQuery(bool $publicOnly = true)
    {
        $primaryStats = DB::table('player_sport_stats as ps')
            ->join('sports as s', 's.id', '=', 'ps.sport_id')
            ->whereIn('s.slug', ['padel', 'tennis'])
            ->selectRaw('distinct on (ps.user_id) ps.user_id, s.slug as primary_sport, ps.elo_rating as primary_elo, ps.reliability_score')
            ->orderBy('ps.user_id')
            ->orderByDesc('ps.games_played')
            ->orderByDesc('ps.elo_rating');

        return DB::table('users as u')
            ->leftJoinSub($primaryStats, 'primary_stats', 'primary_stats.user_id', '=', 'u.id')
            ->whereNull('u.deleted_at')
            ->whereNull('u.admin_role')
            // Curated public directory only applies to anonymous viewers; signed-in
            // users see every real player.
            ->when($publicOnly, fn ($q) => $this->wherePublicPlayerDirectoryAllowed($q, 'u'))
            ->select([
                'u.id',
                'u.username',
                'u.display_name',
                'u.photo_url',
                'u.last_seen_at',
                'u.is_vip',
                'u.vip_expires_at',
                'u.vip_badge_label',
                'u.is_verified',
                'u.is_ambassador',
                'primary_stats.primary_sport',
                'primary_stats.primary_elo',
                'primary_stats.reliability_score',
            ])
            ->selectSub(
                DB::table('follows')->selectRaw('count(*)')->whereColumn('followed_user_id', 'u.id'),
                'followers_count',
            );
    }

    private function assertProfileVisibleToViewer(object $user, ?string $viewerId): void
    {
        if ($viewerId === null && ! $this->isPublicPlayerDirectoryUser($user)) {
            throw ApiException::notFound('User not found');
        }
    }

    private function assertSocialGraphVisibleToViewer(string $profileUserId, ?string $viewerId): void
    {
        $user = DB::table('users')
            ->where('id', $profileUserId)
            ->whereNull('deleted_at')
            ->first(['id', 'username']);

        if ($user === null) {
            throw ApiException::notFound('User not found');
        }

        if ($viewerId === null && ! $this->isPublicPlayerDirectoryUser($user)) {
            throw ApiException::notFound('User not found');
        }

        if ($viewerId !== null && (string) $viewerId !== (string) $profileUserId && $this->blockExistsBetween((string) $viewerId, (string) $profileUserId)) {
            throw ApiException::notFound('User not found');
        }
    }

    /**
     * @param  array<string,bool>  $followedIds  Map of user_id => true for users the viewer follows.
     */
    private function playerPayload(object $u, array $followedIds = []): array
    {
        return [
            'id' => $u->id,
            'username' => $u->username ?? null,
            'display_name' => $u->display_name,
            'photo_url' => $u->photo_url,
            'primary_sport' => $u->primary_sport,
            'primary_elo' => $u->primary_elo !== null ? (int) $u->primary_elo : null,
            'reliability_score' => $u->reliability_score !== null ? (int) $u->reliability_score : null,
            'distance_km' => null,
            'is_followed_by_me' => isset($followedIds[$u->id]),
            'followers_count' => (int) $u->followers_count,
            'last_seen_at' => $this->iso($u->last_seen_at ?? null),
            'is_online' => $this->isOnline($u->last_seen_at ?? null),
            ...$this->badgeFields($u),
        ];
    }

    private function isOnline(mixed $lastSeenAt): bool
    {
        if ($lastSeenAt === null) {
            return false;
        }

        $timestamp = strtotime((string) $lastSeenAt);

        return $timestamp !== false && $timestamp >= now()->subMinutes(2)->getTimestamp();
    }

    /**
     * Resolve which of the given user ids the viewer follows.
     *
     * @param  array<int,string>  $userIds
     * @return array<string,bool>
     */
    private function followedIds(?string $viewerId, array $userIds): array
    {
        if ($viewerId === null || $userIds === []) {
            return [];
        }

        return DB::table('follows')
            ->where('follower_user_id', $viewerId)
            ->whereIn('followed_user_id', $userIds)
            ->pluck('followed_user_id')
            ->mapWithKeys(fn ($id) => [(string) $id => true])
            ->all();
    }

    private function followsPage($rows, int $limit, int $offset, ?string $viewerId = null): array
    {
        $hasMore = $rows->count() > $limit;
        $page = $rows->take($limit);
        // Resolve the viewer's follow state for each listed user so follow
        // buttons render correctly (clients read `is_followed_by_me`).
        $followedIds = $this->followedIds($viewerId, $page->pluck('id')->all());
        $nextOffset = $hasMore ? $offset + $limit : null;

        return [
            'items' => $page->map(fn ($u) => [
                'id' => $u->id,
                'username' => $u->username ?? null,
                'display_name' => $u->display_name,
                'photo_url' => $u->photo_url,
                'followed_at' => $this->iso($u->followed_at),
                'is_following' => isset($followedIds[(string) $u->id]) ?: null,
                'is_followed_by_me' => isset($followedIds[(string) $u->id]),
                ...$this->badgeFields($u),
            ])->values(),
            'next_offset' => $nextOffset,
            // Alias as a string cursor for clients that page via `next_cursor`.
            'next_cursor' => $nextOffset !== null ? (string) $nextOffset : null,
        ];
    }
}
