<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\AuthorizesAdminPermissions;
use App\Http\Controllers\Api\Concerns\FiltersBlockedUsers;
use App\Http\Controllers\Api\Concerns\FiltersPublicPlayerDirectory;
use App\Support\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class EngagementController extends ApiController
{
    use AuthorizesAdminPermissions;
    use FiltersBlockedUsers;
    use FiltersPublicPlayerDirectory;

    public function achievements(Request $request, string $id): JsonResponse
    {
        $this->assertPublicProfileMetricVisible($request, $id);

        $catalog = DB::table('achievements')->orderBy('created_at')->get();
        $unlocked = DB::table('user_achievements')->where('user_id', $id)->pluck('unlocked_at', 'achievement_slug');

        return response()->json([
            'items' => $catalog->map(fn ($a) => [
                'slug' => $a->slug,
                'name' => $a->name,
                // Alias for clients that read `title` (mobile Achievement model).
                'title' => $a->name,
                'description' => $a->description,
                'icon_name' => $a->icon_name,
                // iOS `Achievement` requires a non-optional `unlocked` Bool.
                'unlocked' => isset($unlocked[$a->slug]),
                'unlocked_at' => isset($unlocked[$a->slug]) ? $this->iso($unlocked[$a->slug]) : null,
                // Alias for clients that read the earned timestamp as `earned_at`.
                'earned_at' => isset($unlocked[$a->slug]) ? $this->iso($unlocked[$a->slug]) : null,
            ])->values(),
            // iOS `AchievementsResponse` requires both counts (non-optional Int).
            'unlocked_count' => $unlocked->count(),
            'total_count' => $catalog->count(),
        ]);
    }

    public function streaks(Request $request, string $id): JsonResponse
    {
        $this->assertPublicProfileMetricVisible($request, $id);

        // iOS `StreaksResponse` expects a 26-week heatmap: exactly 26
        // Monday-anchored buckets, oldest first, ending at the current ISO
        // week, plus the current trailing streak and the longest streak of
        // consecutive weeks that have at least one played/confirmed game.
        // Lower-bound the fetch to the rendered 26-week window (was unbounded
        // below, pulling a user's entire game history into PHP). Only games from
        // the oldest visible Monday-anchored week onward affect the heatmap.
        $windowStart = now()->startOfWeek(\Carbon\Carbon::MONDAY)->subWeeks(25);
        $playedAt = DB::table('game_participants as gp')
            ->join('games as g', 'g.id', '=', 'gp.game_id')
            ->where('gp.user_id', $id)
            ->whereIn('gp.status', ['played', 'confirmed'])
            ->where('g.starts_at', '<=', now())
            ->where('g.starts_at', '>=', $windowStart)
            ->pluck('g.starts_at')
            ->map(fn ($t) => \Illuminate\Support\Carbon::parse($t));

        $weeks = [];
        $cursor = now()->startOfWeek(\Carbon\Carbon::MONDAY)->subWeeks(25);
        for ($i = 0; $i < 26; $i++) {
            $start = $cursor->copy();
            $end = $start->copy()->addWeek();
            $count = $playedAt->filter(fn ($t) => $t >= $start && $t < $end)->count();
            $weeks[] = ['week_start' => $start->toDateString(), 'games_count' => $count];
            $cursor->addWeek();
        }

        // Current streak: trailing weeks (from the most recent) with games > 0.
        $current = 0;
        for ($i = count($weeks) - 1; $i >= 0; $i--) {
            if ($weeks[$i]['games_count'] > 0) {
                $current++;
            } else {
                break;
            }
        }

        // Longest run of consecutive non-empty weeks across the window.
        $longest = 0;
        $run = 0;
        foreach ($weeks as $week) {
            if ($week['games_count'] > 0) {
                $run++;
                $longest = max($longest, $run);
            } else {
                $run = 0;
            }
        }

        return response()->json([
            'current_streak_weeks' => $current,
            'longest_streak_weeks' => $longest,
            'weeks' => $weeks,
        ]);
    }

    private function assertPublicProfileMetricVisible(Request $request, string $userId): void
    {
        $viewerId = $this->optionalViewerId($request);

        // An authenticated viewer reading someone else's metrics is hidden by a
        // block in EITHER direction — mirroring SocialController's profile
        // visibility contract so a blocked caller can't read the achievements/
        // streaks the profile route already conceals. Reading your own metrics
        // is always allowed.
        if ($viewerId !== null) {
            if ((string) $viewerId !== $userId && $this->blockExistsBetween((string) $viewerId, $userId)) {
                throw ApiException::notFound('User not found');
            }

            return;
        }

        $query = DB::table('users as u')
            ->where('u.id', $userId)
            ->whereNull('u.deleted_at');

        $this->wherePublicPlayerDirectoryAllowed($query, 'u');

        if (! $query->exists()) {
            throw ApiException::notFound('User not found');
        }
    }

    public function leaderboards(Request $request): JsonResponse
    {
        $query = $this->validateQuery($request, [
            'sport' => ['nullable', 'string', 'max:80'],
            'q' => ['nullable', 'string', 'max:120'],
            'sort' => ['nullable', 'in:elo,points,wins,played'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
            'offset' => ['nullable', 'integer', 'min:0'],
        ]);

        $sport = $query['sport'] ?? null;
        $search = trim((string) ($query['q'] ?? ''));
        $sort = $query['sort'] ?? 'elo';
        $limit = min(max((int) ($query['limit'] ?? 50), 1), 100);
        $offset = max((int) ($query['offset'] ?? 0), 0);
        // Anonymous viewers see only the curated public directory; signed-in users
        // see the full leaderboard.
        $viewerId = $this->optionalViewerId($request);

        $base = DB::table('player_sport_stats as p')
            ->join('users as u', 'u.id', '=', 'p.user_id')
            ->join('sports as s', 's.id', '=', 'p.sport_id')
            ->whereNull('u.deleted_at')
            ->whereNull('u.admin_role')
            ->when($viewerId === null, fn ($q) => $this->wherePublicPlayerDirectoryAllowed($q, 'u'));
        if ($sport) {
            $base->where('s.slug', $sport);
        }
        if ($search !== '') {
            // Escape LIKE wildcards; search only public display_name/username —
            // NOT email (a public leaderboard must not let anyone enumerate emails).
            $needle = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], mb_strtolower($search)).'%';
            $base->where(function ($q) use ($needle) {
                $q->whereRaw('LOWER(u.display_name) LIKE ?', [$needle])
                    ->orWhereRaw('LOWER(u.username) LIKE ?', [$needle]);
            });
        }

        // iOS `LeaderboardPage` requires `total_count` (the global size, before
        // the page window) so the client can show "X of Y" + stop paging.
        $total = (clone $base)->count();

        $rowsQuery = (clone $base);
        if ($sort === 'points') {
            $rowsQuery->orderByDesc('p.games_won')->orderByDesc('p.elo_rating');
        } elseif ($sort === 'wins') {
            $rowsQuery->orderByDesc('p.games_won')->orderByDesc('p.games_played');
        } elseif ($sort === 'played') {
            $rowsQuery->orderByDesc('p.games_played')->orderByDesc('p.elo_rating');
        } else {
            $rowsQuery->orderByDesc('p.elo_rating')->orderByDesc('p.games_won');
        }

        $rows = $rowsQuery
            ->orderBy('u.display_name')
            // Final, fully-deterministic tiebreaker on the (user_id, sport)
            // composite PK so offset pagination can't duplicate/skip rows when
            // the sort columns + display_name collide across two players.
            ->orderBy('p.user_id')
            ->orderBy('s.slug')
            ->offset($offset)
            ->limit($limit)
            ->get([
                'p.user_id',
                'u.username',
                'u.display_name',
                'u.photo_url',
                'u.is_verified',
                'u.is_vip',
                'u.vip_badge_label as vip_label',
                'u.is_ambassador',
                's.slug as sport_slug',
                'p.elo_rating',
                'p.games_played',
                'p.games_won',
                'p.reliability_score',
            ])
            ->values()
            ->map(function ($r, $i) use ($offset) {
                $played = (int) $r->games_played;
                $won = (int) $r->games_won;
                $elo = (int) ($r->elo_rating ?? 0);

                return [
                    // iOS `LeaderboardEntry` requires rank:Int, elo_rating:Int
                    // (non-null) and win_rate:Double (0..1).
                    'rank' => $offset + $i + 1,
                    'user_id' => $r->user_id,
                    'id' => $r->user_id,
                    'username' => $r->username,
                    'display_name' => $r->display_name,
                    'name' => $r->display_name,
                    'photo_url' => $r->photo_url,
                    'is_verified' => (bool) ($r->is_verified ?? false),
                    'is_vip' => (bool) ($r->is_vip ?? false),
                    'vip_label' => $r->vip_label ?? null,
                    'is_ambassador' => (bool) ($r->is_ambassador ?? false),
                    'sport_slug' => $r->sport_slug,
                    'elo_rating' => $elo,
                    'games_played' => $played,
                    'games_won' => $won,
                    'win_rate' => $played > 0 ? round($won / $played, 4) : 0.0,
                    'reliability_score' => $r->reliability_score !== null ? (int) $r->reliability_score : null,
                    // Aliases consumed by the web rankings page.
                    'elo' => $elo,
                    // Alias for the mobile PlayerProfile model (reads `primary_elo`).
                    'primary_elo' => $elo,
                    'played' => $played,
                    'wins' => $won,
                    'points' => $won,
                ];
            });

        return response()->json([
            'items' => $rows,
            'total_count' => (int) $total,
            'pagination' => [
                'limit' => $limit,
                'offset' => $offset,
                'total' => (int) $total,
            ],
        ]);
    }

    public function announcements(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $locale = $request->query('locale', 'az');
        $row = DB::table('announcements as a')
            ->where('a.starts_at', '<=', now())
            ->where(function ($q) {
                $q->whereNull('a.ends_at')->orWhere('a.ends_at', '>', now());
            })
            ->whereIn('a.audience', ['all', $locale])
            ->whereNotExists(function ($q) use ($user) {
                $q->selectRaw('1')
                    ->from('user_dismissed_announcements as d')
                    ->whereColumn('d.announcement_id', 'a.id')
                    ->where('d.user_id', $user->id);
            })
            ->orderBy('a.priority')
            ->orderByDesc('a.starts_at')
            ->first();

        return response()->json(['announcement' => $row]);
    }

    public function dismissAnnouncement(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);

        // Guard before touching user_dismissed_announcements: a malformed (non-uuid)
        // or unknown id would otherwise hit the announcement_id uuid cast / FK and
        // surface as a 500 instead of a clean 404, and would let callers seed orphan
        // dismissal rows for arbitrary ids.
        if (! Str::isUuid($id) || ! DB::table('announcements')->where('id', $id)->exists()) {
            throw ApiException::notFound('Announcement not found');
        }

        DB::table('user_dismissed_announcements')->updateOrInsert([
            'user_id' => $user->id,
            'announcement_id' => $id,
        ], ['dismissed_at' => now()]);

        return response()->json(['ok' => true]);
    }

    public function createAnnouncement(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $this->requireAnnouncementAdmin($user);

        $data = $this->validateBody($request, [
            'title_az' => ['required', 'string', 'max:200'],
            'title_en' => ['required', 'string', 'max:200'],
            'title_ru' => ['required', 'string', 'max:200'],
            'body_az' => ['nullable', 'string'],
            'body_en' => ['nullable', 'string'],
            'body_ru' => ['nullable', 'string'],
            'cta_label_az' => ['nullable', 'string', 'max:80'],
            'cta_label_en' => ['nullable', 'string', 'max:80'],
            'cta_label_ru' => ['nullable', 'string', 'max:80'],
            // Banners reach every user; a CTA must be an external http(s) link or
            // the `linkfit://` deep-link scheme (the only documented values).
            // Reject javascript:/data:/protocol-relative payloads (stored XSS on
            // web). An empty string is tolerated as "no CTA" for client parity.
            'cta_url' => ['nullable', 'string', 'max:2048', 'regex:#^($|https?://|linkfit://)#i'],
            'starts_at' => ['nullable', 'date'],
            'ends_at' => ['nullable', 'date'],
            'audience' => ['nullable', 'in:all,az,en,ru'],
            'priority' => ['nullable', 'integer'],
        ]);
        $this->assertAnnouncementWindow($data);

        $id = (string) Str::uuid();
        DB::table('announcements')->insert([
            ...$data,
            'id' => $id,
            'audience' => $data['audience'] ?? 'all',
            'priority' => $data['priority'] ?? 100,
            'created_by_user_id' => $user->id,
            'created_at' => now(),
        ]);
        $this->auditWrite($user->id, 'announcement.create', $id, [
            'audience' => $data['audience'] ?? 'all',
            'priority' => $data['priority'] ?? 100,
        ]);

        return response()->json($this->announcementPayload($this->announcementRow($id)), 201);
    }

    public function adminAnnouncements(Request $request): JsonResponse
    {
        $this->requireAnnouncementAdmin($this->authUser($request));
        $query = $this->validateQuery($request, [
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
            'offset' => ['nullable', 'integer', 'min:0'],
            'audience' => ['nullable', 'in:all,az,en,ru'],
            'status' => ['nullable', 'in:all,active,scheduled,expired'],
            'q' => ['nullable', 'string', 'max:120'],
        ]);

        $base = $this->announcementBaseQuery();
        if (! empty($query['audience'])) {
            $base->where('a.audience', $query['audience']);
        }
        if (! empty($query['q'])) {
            // Escape LIKE wildcards so a literal `%`/`_`/`\` in the admin search
            // term matches itself instead of acting as a wildcard (parity with
            // the leaderboards search escaping).
            $needle = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], mb_strtolower($query['q'])).'%';
            $base->where(function ($q) use ($needle) {
                $q->whereRaw('LOWER(a.title_az) LIKE ?', [$needle])
                    ->orWhereRaw('LOWER(a.title_en) LIKE ?', [$needle])
                    ->orWhereRaw('LOWER(a.title_ru) LIKE ?', [$needle])
                    ->orWhereRaw('LOWER(COALESCE(a.body_az, \'\')) LIKE ?', [$needle])
                    ->orWhereRaw('LOWER(COALESCE(a.body_en, \'\')) LIKE ?', [$needle])
                    ->orWhereRaw('LOWER(COALESCE(a.body_ru, \'\')) LIKE ?', [$needle]);
            });
        }

        $status = $query['status'] ?? 'all';
        if ($status === 'active') {
            $base->where('a.starts_at', '<=', now())
                ->where(function ($q) {
                    $q->whereNull('a.ends_at')->orWhere('a.ends_at', '>', now());
                });
        } elseif ($status === 'scheduled') {
            $base->where('a.starts_at', '>', now());
        } elseif ($status === 'expired') {
            $base->whereNotNull('a.ends_at')->where('a.ends_at', '<=', now());
        }

        $total = (clone $base)->count('a.id');
        $limit = (int) ($query['limit'] ?? 30);
        $offset = (int) ($query['offset'] ?? 0);
        $items = $base
            ->orderBy('a.priority')
            ->orderByDesc('a.starts_at')
            ->offset($offset)
            ->limit($limit)
            ->get()
            ->map(fn ($row) => $this->announcementPayload($row))
            ->values();

        return response()->json([
            'items' => $items,
            'pagination' => [
                'limit' => $limit,
                'offset' => $offset,
                'total' => $total,
            ],
        ]);
    }

    public function adminAnnouncement(Request $request, string $id): JsonResponse
    {
        $this->requireAnnouncementAdmin($this->authUser($request));

        return response()->json($this->announcementPayload($this->announcementRow($id)));
    }

    public function updateAnnouncement(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        $this->requireAnnouncementAdmin($user);
        $this->announcementRow($id);

        $data = $this->validateBody($request, [
            'title_az' => ['sometimes', 'required', 'string', 'max:200'],
            'title_en' => ['sometimes', 'required', 'string', 'max:200'],
            'title_ru' => ['sometimes', 'required', 'string', 'max:200'],
            'body_az' => ['sometimes', 'nullable', 'string'],
            'body_en' => ['sometimes', 'nullable', 'string'],
            'body_ru' => ['sometimes', 'nullable', 'string'],
            'cta_label_az' => ['sometimes', 'nullable', 'string', 'max:80'],
            'cta_label_en' => ['sometimes', 'nullable', 'string', 'max:80'],
            'cta_label_ru' => ['sometimes', 'nullable', 'string', 'max:80'],
            // Same safe-scheme guard as create (block stored-XSS CTA payloads).
            'cta_url' => ['sometimes', 'nullable', 'string', 'max:2048', 'regex:#^($|https?://|linkfit://)#i'],
            'starts_at' => ['sometimes', 'nullable', 'date'],
            'ends_at' => ['sometimes', 'nullable', 'date'],
            'audience' => ['sometimes', 'required', 'in:all,az,en,ru'],
            'priority' => ['sometimes', 'required', 'integer'],
        ]);
        if ($data === []) {
            return response()->json($this->announcementPayload($this->announcementRow($id)));
        }

        $merged = array_merge((array) DB::table('announcements')->where('id', $id)->first(), $data);
        $this->assertAnnouncementWindow($merged);
        DB::table('announcements')->where('id', $id)->update($data);
        $this->auditWrite($user->id, 'announcement.update', $id, [
            'fields' => array_keys($data),
        ]);

        return response()->json($this->announcementPayload($this->announcementRow($id)));
    }

    public function expireAnnouncement(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        $this->requireAnnouncementAdmin($user);
        $this->announcementRow($id);

        DB::table('announcements')->where('id', $id)->update(['ends_at' => now()]);
        $this->auditWrite($user->id, 'announcement.expire', $id);

        return response()->json($this->announcementPayload($this->announcementRow($id)));
    }

    public function deleteAnnouncement(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        $this->requireAnnouncementAdmin($user);
        $row = $this->announcementRow($id);

        DB::table('announcements')->where('id', $id)->delete();
        $this->auditWrite($user->id, 'announcement.delete', $id, [
            'title_az' => $row->title_az,
            'audience' => $row->audience,
        ]);

        return response()->json(['ok' => true]);
    }

    private function announcementBaseQuery()
    {
        $dismissals = DB::table('user_dismissed_announcements')
            ->select('announcement_id', DB::raw('COUNT(*) as dismissals_count'))
            ->groupBy('announcement_id');

        return DB::table('announcements as a')
            ->leftJoin('users as u', 'u.id', '=', 'a.created_by_user_id')
            ->leftJoinSub($dismissals, 'd', 'd.announcement_id', '=', 'a.id')
            ->select([
                'a.*',
                'u.display_name as creator_name',
                'u.email as creator_email',
                DB::raw('COALESCE(d.dismissals_count, 0) as dismissals_count'),
            ]);
    }

    private function announcementRow(string $id): object
    {
        $row = $this->announcementBaseQuery()->where('a.id', $id)->first();
        if (! $row) {
            throw ApiException::notFound('Announcement not found');
        }

        return $row;
    }

    private function announcementPayload(object $row): array
    {
        $startsAt = $row->starts_at ? strtotime((string) $row->starts_at) : null;
        $endsAt = $row->ends_at ? strtotime((string) $row->ends_at) : null;
        $now = time();

        return [
            'id' => $row->id,
            'title_az' => $row->title_az,
            'title_en' => $row->title_en,
            'title_ru' => $row->title_ru,
            'body_az' => $row->body_az,
            'body_en' => $row->body_en,
            'body_ru' => $row->body_ru,
            'cta_label_az' => $row->cta_label_az,
            'cta_label_en' => $row->cta_label_en,
            'cta_label_ru' => $row->cta_label_ru,
            'cta_url' => $row->cta_url,
            'audience' => $row->audience,
            'priority' => (int) $row->priority,
            'starts_at' => $this->iso($row->starts_at),
            'ends_at' => $this->iso($row->ends_at),
            'created_at' => $this->iso($row->created_at),
            'created_by_user_id' => $row->created_by_user_id,
            'creator' => $row->created_by_user_id ? [
                'id' => $row->created_by_user_id,
                'display_name' => $row->creator_name,
                'email' => $row->creator_email,
            ] : null,
            'dismissals_count' => (int) ($row->dismissals_count ?? 0),
            'is_scheduled' => $startsAt !== null && $startsAt > $now,
            'is_expired' => $endsAt !== null && $endsAt <= $now,
            'is_active' => ($startsAt === null || $startsAt <= $now) && ($endsAt === null || $endsAt > $now),
        ];
    }

    private function requireAnnouncementAdmin(object $user): void
    {
        if (! in_array($user->admin_role, ['admin', 'moderator'], true)) {
            throw ApiException::forbidden('Admin access required');
        }
        if ($user->admin_role === 'moderator' && ! $this->hasAdminPermission($user, 'operations')) {
            throw ApiException::forbidden('Admin permission required: operations');
        }
    }

    private function assertAnnouncementWindow(array $data): void
    {
        if (empty($data['starts_at']) || empty($data['ends_at'])) {
            return;
        }
        if (strtotime((string) $data['ends_at']) <= strtotime((string) $data['starts_at'])) {
            throw ApiException::validation('Announcement end time must be after start time');
        }
    }

    private function auditWrite(?string $actorUserId, string $action, string $entityId, array $metadata = []): void
    {
        DB::table('audit_log')->insert([
            'id' => (string) Str::uuid(),
            'actor_user_id' => $actorUserId,
            'action' => $action,
            'entity' => 'announcements',
            'entity_id' => $entityId,
            'metadata' => json_encode($metadata),
            'created_at' => now(),
        ]);
    }
}
