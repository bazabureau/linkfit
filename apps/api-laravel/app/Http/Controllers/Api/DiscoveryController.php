<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\FiltersBlockedUsers;
use App\Http\Controllers\Api\Concerns\FiltersPublicPlayerDirectory;
use App\Services\Membership\MembershipService;
use App\Support\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class DiscoveryController extends ApiController
{
    use FiltersBlockedUsers;
    use FiltersPublicPlayerDirectory;

    /**
     * Canonical daily-challenge codes — single source of truth for both the
     * seed (challenges) and the completion check (checkChallenge), so an
     * arbitrary `{code}` path segment can't silently no-op against the DB.
     *
     * @var list<string>
     */
    private const CHALLENGE_CODES = ['follow_one', 'join_a_game', 'comment_on_feed'];

    public function agenda(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $games = DB::table('game_participants as gp')
            ->join('games as g', 'g.id', '=', 'gp.game_id')
            ->join('sports as s', 's.id', '=', 'g.sport_id')
            ->where('gp.user_id', $user->id)
            ->where('gp.status', 'confirmed')
            ->where('g.starts_at', '>=', now()->subDay())
            ->whereIn('s.slug', ['padel', 'tennis'])
            ->orderBy('g.starts_at')
            ->limit(50)
            ->get(['g.id', 'g.starts_at', 'g.status', 's.slug as sport_slug']);
        // Keep every legacy `bookings.*` column (existing consumers may read
        // any of them) and add joined court/venue names for the new `items[]`.
        $bookings = DB::table('bookings as b')
            ->leftJoin('courts as c', 'c.id', '=', 'b.court_id')
            ->leftJoin('venues as v', 'v.id', '=', 'c.venue_id')
            ->where('b.user_id', $user->id)
            ->where('b.starts_at', '>=', now()->subDay())
            ->orderBy('b.starts_at')
            ->limit(50)
            ->get(['b.*', 'c.name as court_name', 'v.name as venue_name']);

        // Flat, normalized agenda list for clients that read a single ordered
        // stream (e.g. the mobile "Up next" card). The legacy `games`/`bookings`
        // keys are kept for existing consumers.
        $items = collect();
        foreach ($games as $g) {
            $items->push([
                'kind' => 'game',
                'id' => $g->id,
                'starts_at' => $this->iso($g->starts_at),
                'status' => $g->status,
                'title' => ucfirst((string) $g->sport_slug).' game',
                'venue_name' => null,
                'sport_slug' => $g->sport_slug,
            ]);
        }
        foreach ($bookings as $b) {
            $items->push([
                'kind' => 'booking',
                'id' => $b->id,
                'starts_at' => $this->iso($b->starts_at),
                'status' => $b->status,
                'title' => $b->venue_name ?: $b->court_name,
                'venue_name' => $b->venue_name,
                'court_name' => $b->court_name,
            ]);
        }
        $items = $items->sortBy('starts_at')->values();

        return response()->json(['items' => $items, 'games' => $games, 'bookings' => $bookings]);
    }

    public function activity(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $query = $this->validateQuery($request, [
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
            'offset' => ['nullable', 'integer', 'min:0'],
            'type' => ['nullable', 'in:all,booking,game,tournament'],
            'timeframe' => ['nullable', 'in:all,upcoming,past'],
        ]);

        $type = $query['type'] ?? 'all';
        $events = collect();
        if ($type === 'all' || $type === 'booking') {
            $events = $events->merge($this->bookingActivity($user->id));
        }
        if ($type === 'all' || $type === 'game') {
            $events = $events->merge($this->gameActivity($user->id));
        }
        if ($type === 'all' || $type === 'tournament') {
            $events = $events->merge($this->tournamentActivity($user->id));
        }

        $now = now()->toIso8601ZuluString('millisecond');
        $timeframe = $query['timeframe'] ?? 'all';
        if ($timeframe === 'upcoming') {
            $events = $events->filter(fn ($event) => $event['event_at'] >= $now);
        } elseif ($timeframe === 'past') {
            $events = $events->filter(fn ($event) => $event['event_at'] < $now);
        }

        $events = $events->sortByDesc('event_at')->values();
        $total = $events->count();
        $limit = (int) ($query['limit'] ?? 30);
        $offset = (int) ($query['offset'] ?? 0);

        // Alias the timestamp as `created_at` too: some clients (mobile) read the
        // activity time from `created_at`/`at`/`timestamp`, not `event_at`.
        $page = $events->slice($offset, $limit)->values()->map(function ($event) {
            $event['created_at'] = $event['event_at'] ?? null;

            return $event;
        });

        return response()->json([
            'items' => $page,
            'pagination' => [
                'limit' => $limit,
                'offset' => $offset,
                'total' => $total,
            ],
            'summary' => [
                'bookings' => $events->where('type', 'booking')->count(),
                'games' => $events->where('type', 'game')->count(),
                'tournaments' => $events->where('type', 'tournament')->count(),
            ],
        ]);
    }

    /**
     * GET /api/v1/me/insights?sport=<slug>&days=<n>
     *
     * Rich performance analytics for the "Statistika" screen. Built from
     * completed `match_scores` (the source of truth for played matches):
     *   - elo_series — reconstructed by anchoring the latest point at the
     *     player's current ELO and unwinding the per-match `elo_delta_by_user`
     *     deltas backwards, so the curve always lands exactly on today's rating.
     *   - win_rate_series — cumulative win % after each match in the window.
     *   - games_per_week — matches bucketed by ISO-week Monday.
     *   - opponents — who you've faced, with your W/L against each.
     * reliability_series is left empty: reliability has no per-match history
     * table to reconstruct from (only the current snapshot exists).
     */
    public function insights(Request $request): JsonResponse
    {
        $user = $this->authUser($request);

        $slug = (string) ($request->query('sport') ?: 'padel');
        // Constrain to the supported sports (mirrors the padel/tennis whitelist used
        // across discovery/games) so an arbitrary client string can't be reflected
        // back as `sport_slug`; fall back to the default rather than 422 so existing
        // clients keep getting the headline snapshot.
        if (! in_array($slug, ['padel', 'tennis'], true)) {
            $slug = 'padel';
        }
        $days = (int) ($request->query('days') ?: 30);
        $days = max(1, min($days, 1825));
        $windowStart = now()->subDays($days);

        $sport = DB::table('sports')->where('slug', $slug)->first(['id']);
        $sportId = $sport->id ?? null;

        // Current snapshot (defaults for a player who hasn't played this sport).
        $stat = $sportId
            ? DB::table('player_sport_stats')->where('user_id', $user->id)->where('sport_id', $sportId)->first()
            : null;
        $currentElo = (int) ($stat->elo_rating ?? 1200);
        $currentReliability = (int) ($stat->reliability_score ?? 100);

        // All completed matches for this player in this sport, oldest first.
        // We pull the full history (not just the window) so the ELO curve can
        // be anchored correctly before slicing to the requested window.
        $rows = [];
        if ($sportId) {
            $rows = DB::table('match_scores as ms')
                ->join('games as g', 'g.id', '=', 'ms.game_id')
                ->where('g.sport_id', $sportId)
                ->where('ms.status', 'completed')
                ->whereRaw('(ms.team_a_user_ids @> ARRAY[?]::uuid[] OR ms.team_b_user_ids @> ARRAY[?]::uuid[])', [$user->id, $user->id])
                ->orderBy('ms.completed_at')
                ->get([
                    'ms.completed_at', 'ms.sets',
                    'ms.team_a_user_ids', 'ms.team_b_user_ids', 'ms.elo_delta_by_user',
                ])->all();
        }

        // Normalise each match into a small record.
        $matches = [];
        foreach ($rows as $r) {
            $teamA = $this->pgUuidArray($r->team_a_user_ids);
            $teamB = $this->pgUuidArray($r->team_b_user_ids);
            $userTeam = in_array($user->id, $teamA, true) ? 'a' : 'b';
            // Winner is decided by sets won (matches MatchController), not by a
            // single game tally — the old current_game_a>=b defaulted to 'a'.
            $winningTeam = $this->winnerFromSets($r->sets);
            $deltas = json_decode($r->elo_delta_by_user ?? '{}', true) ?: [];
            $matches[] = [
                'at' => \Illuminate\Support\Carbon::parse($r->completed_at),
                'won' => $winningTeam !== null && $userTeam === $winningTeam,
                'delta' => (int) ($deltas[$user->id] ?? 0),
                'opponents' => $userTeam === 'a' ? $teamB : $teamA,
            ];
        }

        // ELO series — anchor the end at currentElo and walk forward from the
        // reconstructed pre-history baseline so the last point == current ELO.
        $totalDelta = array_sum(array_column($matches, 'delta'));
        $running = $currentElo - $totalDelta;
        $eloSeries = [];
        foreach ($matches as $m) {
            $running += $m['delta'];
            if ($m['at']->greaterThanOrEqualTo($windowStart)) {
                $eloSeries[] = ['date' => $m['at']->toIso8601String(), 'elo' => (int) $running];
            }
        }

        // Window-scoped matches drive the remaining series.
        $windowMatches = array_values(array_filter($matches, fn ($m) => $m['at']->greaterThanOrEqualTo($windowStart)));

        // Cumulative win-rate after each match.
        $winRateSeries = [];
        $wins = 0;
        foreach ($windowMatches as $i => $m) {
            if ($m['won']) {
                $wins++;
            }
            $played = $i + 1;
            $winRateSeries[] = [
                'date' => $m['at']->toIso8601String(),
                'win_rate' => round($wins * 100 / $played, 2),
                'games' => $played,
            ];
        }

        // Games per ISO week (Monday-anchored).
        $weekCounts = [];
        foreach ($windowMatches as $m) {
            $monday = $m['at']->copy()->startOfWeek(\Illuminate\Support\Carbon::MONDAY)->toDateString();
            $weekCounts[$monday] = ($weekCounts[$monday] ?? 0) + 1;
        }
        ksort($weekCounts);
        $gamesPerWeek = [];
        foreach ($weekCounts as $week => $count) {
            $gamesPerWeek[] = ['week_start' => $week, 'games' => $count];
        }

        // Opponents faced, with your record against each.
        $opp = [];
        foreach ($windowMatches as $m) {
            foreach ($m['opponents'] as $oid) {
                if (! isset($opp[$oid])) {
                    $opp[$oid] = ['games_count' => 0, 'wins' => 0, 'losses' => 0];
                }
                $opp[$oid]['games_count']++;
                $m['won'] ? $opp[$oid]['wins']++ : $opp[$oid]['losses']++;
            }
        }
        $opponents = [];
        if (! empty($opp)) {
            $names = DB::table('users')->whereIn('id', array_keys($opp))->whereNull('deleted_at')
                ->get(['id', 'display_name', 'photo_url'])->keyBy('id');
            foreach ($opp as $oid => $rec) {
                $u = $names->get($oid);
                if (! $u) {
                    continue;
                }
                $opponents[] = [
                    'user_id' => $oid,
                    'display_name' => $u->display_name,
                    'photo_url' => $u->photo_url,
                    'games_count' => $rec['games_count'],
                    'wins' => $rec['wins'],
                    'losses' => $rec['losses'],
                ];
            }
            usort($opponents, fn ($a, $b) => $b['games_count'] <=> $a['games_count']);
            $opponents = array_slice($opponents, 0, 12);
        }

        // Free vs premium: headline stats + ELO/win-rate curves stay free; the
        // deeper analytics (rival breakdown, weekly volume) are premium-only.
        $membership = app(MembershipService::class);
        $hasAdvancedInsights = $membership->canUseFeature($user->id, 'advanced_insights');

        // Scalar win-rate (0..1) and games-won, derived from the window so simpler
        // clients (e.g. the mobile home stats strip) don't have to read the series.
        $totalGames = count($windowMatches);
        $winRate = $totalGames > 0 ? round($wins / $totalGames, 4) : null;

        $payload = [
            'sport_slug' => $slug,
            'days' => $days,
            'total_games' => $totalGames,
            'games_won' => $wins,
            'win_rate' => $winRate,
            'current_elo' => $currentElo,
            // Aliases for clients that read `elo`/`reliability` (mobile home strip).
            'elo' => $currentElo,
            'current_reliability' => $currentReliability,
            'reliability' => $currentReliability,
            'elo_series' => $eloSeries,
            'win_rate_series' => $winRateSeries,
            'games_per_week' => $hasAdvancedInsights ? $gamesPerWeek : [],
            'opponents' => $hasAdvancedInsights ? $opponents : [],
            'reliability_series' => [],
        ];

        return response()->json(array_merge(
            $payload,
            $this->featureAccessPayload($membership, (string) $user->id, 'advanced_insights', $hasAdvancedInsights)
        ));
    }

    /** Parse a Postgres `uuid[]` literal (`{a,b}`) or array into a string[]. */
    private function pgUuidArray(mixed $value): array
    {
        if (is_array($value)) {
            return array_values(array_filter(array_map('strval', $value)));
        }
        $raw = trim((string) $value, '{}');
        if ($raw === '') {
            return [];
        }

        return array_values(array_filter(array_map(fn ($s) => trim($s, '"'), explode(',', $raw))));
    }

    /** Winner by sets won; null on a genuine tie (never a false 'a' default). */
    private function winnerFromSets(mixed $setsJson): ?string
    {
        $sets = is_array($setsJson) ? $setsJson : (json_decode((string) ($setsJson ?? '[]'), true) ?: []);
        $a = 0;
        $b = 0;
        foreach ($sets as $s) {
            if ((int) ($s['a'] ?? 0) > (int) ($s['b'] ?? 0)) {
                $a++;
            } elseif ((int) ($s['b'] ?? 0) > (int) ($s['a'] ?? 0)) {
                $b++;
            }
        }

        return $a === $b ? null : ($a > $b ? 'a' : 'b');
    }

    /**
     * GET /api/v1/me/home — one round-trip aggregate for the home screen. Each
     * sub-block reuses the SAME query logic + item shapes as its standalone
     * endpoint and is independently fail-open (→ null/[]) so one failing query
     * can never blank the whole screen.
     */
    public function home(Request $request): JsonResponse
    {
        $user = $this->authUser($request);

        $me = null;
        try {
            $me = $user->toPublicUser();
        } catch (\Throwable $e) {
            report($e);
        }

        $access = null;
        try {
            $membership = app(MembershipService::class);
            $m = $membership
                ->resolve($user->id, optional($user->created_at)->toIso8601String());
            $access = [
                'full_access' => $m->is_premium,
                'features' => $membership->publicFeaturesForUser((string) $user->id),
            ];
        } catch (\Throwable $e) {
            report($e);
        }

        $unread = null;
        try {
            $unread = $this->unreadCountsFor((string) $user->id);
        } catch (\Throwable $e) {
            report($e);
        }

        $agenda = null;
        try {
            $agenda = $this->agendaData((string) $user->id);
        } catch (\Throwable $e) {
            report($e);
        }

        $nearbyGames = [];
        try {
            $nearbyGames = $this->nearbyGamesData((string) $user->id);
        } catch (\Throwable $e) {
            report($e);
            $nearbyGames = [];
        }

        $suggestedFollows = [];
        try {
            $suggestedFollows = $this->suggestedFollowsData((string) $user->id);
        } catch (\Throwable $e) {
            report($e);
            $suggestedFollows = [];
        }

        $insightsSummary = null;
        try {
            $insightsSummary = $this->insightsSummaryData((string) $user->id);
        } catch (\Throwable $e) {
            report($e);
        }

        return response()->json([
            'me' => $me,
            'access' => $access,
            'unread' => $unread,
            'agenda' => $agenda,
            'nearby_games' => $nearbyGames,
            'suggested_follows' => $suggestedFollows,
            'insights_summary' => $insightsSummary,
            'server_time' => now()->toIso8601ZuluString('millisecond'),
        ]);
    }

    /** Mirrors MessagingController::unreadCounts — {messages, notifications, invites, total}. */
    private function unreadCountsFor(string $userId): array
    {
        $messages = DB::table('conversation_participants as me')
            ->join('conversations as c', 'c.id', '=', 'me.conversation_id')
            ->where('me.user_id', $userId)
            ->whereNull('me.left_at')
            ->whereNotNull('c.last_message_at')
            // Mirror MessagingController::unreadCounts(): a 1:1 thread with a
            // blocked counterpart (either direction) is hidden from the inbox, so
            // it must NOT inflate the badge. Group threads are shared context and
            // always count.
            ->where(function ($q) use ($userId) {
                $q->where('c.kind', 'group')
                    ->orWhereNotExists(function ($sq) use ($userId) {
                        $sq->selectRaw('1')
                            ->from('conversation_participants as other_cp')
                            ->join('user_blocks as ub', function ($join) use ($userId) {
                                $join->where(fn ($w) => $w->where('ub.blocker_user_id', $userId)->whereColumn('ub.blocked_user_id', 'other_cp.user_id'))
                                    ->orWhere(fn ($w) => $w->where('ub.blocked_user_id', $userId)->whereColumn('ub.blocker_user_id', 'other_cp.user_id'));
                            })
                            ->whereColumn('other_cp.conversation_id', 'c.id')
                            ->whereColumn('other_cp.user_id', '!=', 'me.user_id');
                    });
            })
            ->where(function ($q) {
                $q->whereNull('me.last_read_at')
                    ->orWhereColumn('c.last_message_at', '>', 'me.last_read_at');
            })
            ->count();

        $notifications = DB::table('notifications')
            ->where('user_id', $userId)
            ->whereNull('read_at')
            ->count();

        $invites = DB::table('game_invitations')
            ->where('invitee_user_id', $userId)
            ->where('status', 'pending')
            ->count();

        return [
            'messages' => $messages,
            'notifications' => $notifications,
            'invites' => $invites,
            'total' => $messages + $notifications + $invites,
        ];
    }

    /** Mirrors agenda() — confirmed upcoming games + upcoming bookings. */
    private function agendaData(string $userId): array
    {
        $games = DB::table('game_participants as gp')
            ->join('games as g', 'g.id', '=', 'gp.game_id')
            ->join('sports as s', 's.id', '=', 'g.sport_id')
            ->where('gp.user_id', $userId)
            ->where('gp.status', 'confirmed')
            ->where('g.starts_at', '>=', now()->subDay())
            ->whereIn('s.slug', ['padel', 'tennis'])
            ->orderBy('g.starts_at')
            ->limit(50)
            ->get(['g.id', 'g.starts_at', 'g.status', 's.slug as sport_slug'])
            // Emit timestamps as ISO8601 Zulu (like the standalone agenda) so the
            // client doesn't discard zoneless values.
            ->map(fn ($g) => [
                'id' => $g->id,
                'starts_at' => $this->iso($g->starts_at),
                'status' => $g->status,
                'sport_slug' => $g->sport_slug,
            ])
            ->all();
        $bookings = DB::table('bookings')
            ->where('user_id', $userId)
            ->where('starts_at', '>=', now()->subDay())
            ->orderBy('starts_at')
            ->limit(50)
            ->get()
            ->map(function ($b) {
                foreach (['starts_at', 'ends_at', 'created_at', 'cancelled_at', 'paid_at'] as $f) {
                    if (isset($b->{$f})) {
                        $b->{$f} = $this->iso($b->{$f});
                    }
                }

                return $b;
            })
            ->all();

        return ['games' => $games, 'bookings' => $bookings];
    }

    /** Mirrors matchmakingGames() — open public upcoming games not hosted/blocked. */
    private function nearbyGamesData(string $userId): array
    {
        return DB::table('games as g')
            ->join('sports as s', 's.id', '=', 'g.sport_id')
            ->leftJoin('courts as c', 'c.id', '=', 'g.court_id')
            ->leftJoin('venues as v', 'v.id', '=', 'c.venue_id')
            ->leftJoin('users as h', 'h.id', '=', 'g.host_user_id')
            ->where('g.host_user_id', '!=', $userId)
            ->where('g.status', 'open')
            ->where('g.visibility', 'public')
            ->where('g.starts_at', '>=', now())
            ->whereIn('s.slug', ['padel', 'tennis'])
            ->when(true, fn ($q) => $this->whereNotBlocked($q, $userId, 'g.host_user_id'))
            ->orderBy('g.starts_at')
            ->limit(50)
            ->select([
                'g.id', 'g.sport_id', 's.slug as sport_slug', 'g.starts_at', 'g.status', 'g.visibility',
                'g.capacity', 'g.lat', 'g.lng', 'g.court_id', 'c.name as court_name',
                'v.id as venue_id', 'v.name as venue_name', 'g.host_user_id',
                'h.display_name as host_display_name', 'h.photo_url as host_photo_url',
            ])
            // participants_count inline (no N+1) — the client treats a game with
            // no status as ended and filters it out, so status + a full payload
            // make the home aggregate's nearby_games actually usable.
            ->selectRaw("(select count(*) from game_participants gp where gp.game_id = g.id and gp.status = 'confirmed')::int as participants_count")
            ->get()
            ->map(fn ($g) => [
                'id' => $g->id,
                'sport_id' => $g->sport_id,
                'sport_slug' => $g->sport_slug,
                'starts_at' => $this->iso($g->starts_at),
                'status' => $g->status,
                'visibility' => $g->visibility,
                'capacity' => (int) $g->capacity,
                'participants_count' => (int) $g->participants_count,
                'lat' => $g->lat,
                'lng' => $g->lng,
                'court_id' => $g->court_id,
                'court_name' => $g->court_name,
                'venue_id' => $g->venue_id,
                'venue_name' => $g->venue_name,
                'host' => $g->host_user_id ? [
                    'id' => $g->host_user_id,
                    'display_name' => $g->host_display_name,
                    'photo_url' => $g->host_photo_url,
                ] : null,
            ])
            ->all();
    }

    /** Mirrors suggestedFollows() item shape exactly. */
    private function suggestedFollowsData(string $userId): array
    {
        // Resolve each candidate's primary (best padel/tennis) sport stat so the
        // card shows a real ELO — consistent with matchmakingPlayers() / players.
        $primaryStats = DB::table('player_sport_stats as ps')
            ->join('sports as s', 's.id', '=', 'ps.sport_id')
            ->whereIn('s.slug', ['padel', 'tennis'])
            ->selectRaw('distinct on (ps.user_id) ps.user_id, ps.elo_rating as primary_elo')
            ->orderBy('ps.user_id')
            ->orderByDesc('ps.games_played')
            ->orderByDesc('ps.elo_rating');

        $rows = DB::table('users as u')
            ->leftJoinSub($primaryStats, 'primary_stats', 'primary_stats.user_id', '=', 'u.id')
            ->where('u.id', '!=', $userId)
            ->whereNull('u.deleted_at')
            // Suggestions are signed-in-only — surface all real players, not just the curated public set.
            ->whereNotExists(function ($q) use ($userId) {
                $q->selectRaw('1')->from('follows as f')
                    ->whereColumn('f.followed_user_id', 'u.id')
                    ->where('f.follower_user_id', $userId);
            })
            ->when(true, fn ($q) => $this->whereNotBlocked($q, $userId, 'u.id'))
            ->orderByDesc('u.created_at')
            ->limit(20)
            ->get(['u.id', 'u.display_name', 'u.photo_url', 'primary_stats.primary_elo']);

        return $rows->map(fn ($u) => [
            'id' => $u->id,
            'user_id' => $u->id,
            'display_name' => $u->display_name,
            'photo_url' => $u->photo_url,
            'primary_elo' => isset($u->primary_elo) ? (int) $u->primary_elo : null,
            'shared_games_count' => 0,
            'reason' => 'suggested',
        ])->all();
    }

    /** Small free-tier subset of insights() headline stats for the home card. */
    private function insightsSummaryData(string $userId): array
    {
        $slug = 'padel';
        $days = 30;
        $windowStart = now()->subDays($days);

        $sport = DB::table('sports')->where('slug', $slug)->first(['id']);
        $sportId = $sport->id ?? null;

        $stat = $sportId
            ? DB::table('player_sport_stats')->where('user_id', $userId)->where('sport_id', $sportId)->first()
            : null;
        $currentElo = (int) ($stat->elo_rating ?? 1200);
        $currentReliability = (int) ($stat->reliability_score ?? 100);

        $totalGames = 0;
        if ($sportId) {
            $totalGames = DB::table('match_scores as ms')
                ->join('games as g', 'g.id', '=', 'ms.game_id')
                ->where('g.sport_id', $sportId)
                ->where('ms.status', 'completed')
                ->where('ms.completed_at', '>=', $windowStart)
                ->whereRaw('(ms.team_a_user_ids @> ARRAY[?]::uuid[] OR ms.team_b_user_ids @> ARRAY[?]::uuid[])', [$userId, $userId])
                ->count();
        }

        return [
            'sport_slug' => $slug,
            'days' => $days,
            'total_games' => $totalGames,
            'current_elo' => $currentElo,
            'current_reliability' => $currentReliability,
        ];
    }

    public function suggestedFollows(Request $request): JsonResponse
    {
        $user = $this->authUser($request);

        // Resolve each candidate's primary (best padel/tennis) sport stat so the
        // card shows a real ELO — consistent with matchmakingPlayers() / players.
        $primaryStats = DB::table('player_sport_stats as ps')
            ->join('sports as s', 's.id', '=', 'ps.sport_id')
            ->whereIn('s.slug', ['padel', 'tennis'])
            ->selectRaw('distinct on (ps.user_id) ps.user_id, ps.elo_rating as primary_elo')
            ->orderBy('ps.user_id')
            ->orderByDesc('ps.games_played')
            ->orderByDesc('ps.elo_rating');

        $rows = DB::table('users as u')
            ->leftJoinSub($primaryStats, 'primary_stats', 'primary_stats.user_id', '=', 'u.id')
            ->where('u.id', '!=', $user->id)
            ->whereNull('u.deleted_at')
            // Suggestions are signed-in-only — surface all real players, not just the curated public set.
            ->whereNotExists(function ($q) use ($user) {
                $q->selectRaw('1')->from('follows as f')->whereColumn('f.followed_user_id', 'u.id')->where('f.follower_user_id', $user->id);
            })
            ->when(true, fn ($q) => $this->whereNotBlocked($q, (string) $user->id, 'u.id'))
            ->orderByDesc('u.created_at')
            ->limit(20)
            ->get(['u.id', 'u.display_name', 'u.photo_url', 'primary_stats.primary_elo']);

        // iOS `SuggestedFollowItem` (Endpoint+SuggestedFollows.swift) requires an
        // explicit shape — NON-optional user_id/display_name/shared_games_count/reason
        // — so we cannot reuse publicUser() (it emits `id`, omits the rest). ELO
        // lives in player_sport_stats.elo_rating (joined above as primary_elo) and
        // is null when the player has no padel/tennis stat yet, satisfying the
        // Swift `primary_elo: Int?` optional. shared_games_count is a 0 placeholder
        // until the mutual-games join is wired; reason is a non-null string.
        return response()->json(['items' => $rows->map(fn ($u) => [
            'id' => $u->id,
            'user_id' => $u->id,
            'display_name' => $u->display_name,
            'photo_url' => $u->photo_url,
            'primary_elo' => isset($u->primary_elo) ? (int) $u->primary_elo : null,
            'shared_games_count' => 0,
            'reason' => 'suggested',
        ])]);
    }

    public function matchmakingGames(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $rows = DB::table('games as g')
            ->join('sports as s', 's.id', '=', 'g.sport_id')
            ->join('users as h', 'h.id', '=', 'g.host_user_id')
            ->leftJoin('courts as c', 'c.id', '=', 'g.court_id')
            ->leftJoin('venues as v', 'v.id', '=', 'c.venue_id')
            ->where('g.host_user_id', '!=', $user->id)
            ->where('g.status', 'open')
            ->where('g.visibility', 'public')
            ->where('g.starts_at', '>=', now())
            ->whereIn('s.slug', ['padel', 'tennis'])
            ->when(true, fn ($q) => $this->whereNotBlocked($q, (string) $user->id, 'g.host_user_id'))
            ->orderBy('g.starts_at')
            ->limit(50)
            ->selectRaw("
                g.id, g.sport_id, s.slug as sport_slug, g.host_user_id,
                h.display_name as host_display_name, g.court_id,
                c.name as court_name, v.id as venue_id, v.name as venue_name,
                v.address as venue_address, v.photo_url as venue_photo_url,
                g.lat, g.lng, g.starts_at, g.duration_minutes, g.capacity,
                g.status, g.visibility, g.match_type, g.skill_min_elo,
                g.skill_max_elo, g.notes,
                (
                    select count(*)
                    from game_participants gp
                    where gp.game_id = g.id and gp.status = 'confirmed'
                )::int as participants_count
            ")
            ->get();

        $membership = app(MembershipService::class);
        $hasPriorityMatchmaking = $membership->canUseFeature($user->id, 'priority_matchmaking');

        return response()->json(array_merge([
            'items' => $rows,
        ], $this->featureAccessPayload($membership, (string) $user->id, 'priority_matchmaking', $hasPriorityMatchmaking)));
    }

    public function matchmakingPlayers(Request $request): JsonResponse
    {
        $user = $this->authUser($request);

        // Primary sport stat (best of padel/tennis) per candidate, for the
        // sport slug + ELO the iOS RecommendedPlayer card shows.
        $primary = DB::table('player_sport_stats as ps')
            ->join('sports as s', 's.id', '=', 'ps.sport_id')
            ->whereIn('s.slug', ['padel', 'tennis'])
            ->selectRaw('distinct on (ps.user_id) ps.user_id, s.slug as primary_sport_slug, ps.elo_rating, ps.reliability_score')
            ->orderBy('ps.user_id')
            ->orderByDesc('ps.games_played')
            ->orderByDesc('ps.elo_rating');

        $rows = DB::table('users as u')
            ->leftJoinSub($primary, 'ps', 'ps.user_id', '=', 'u.id')
            ->where('u.id', '!=', $user->id)
            ->whereNull('u.deleted_at')
            ->whereNull('u.admin_role')
            // Suggestions are signed-in-only — surface all real players, not just the curated public set.
            ->whereNotExists(function ($q) use ($user) {
                $q->selectRaw('1')->from('follows as f')
                    ->whereColumn('f.followed_user_id', 'u.id')
                    ->where('f.follower_user_id', $user->id);
            })
            ->when(true, fn ($q) => $this->whereNotBlocked($q, (string) $user->id, 'u.id'))
            ->orderByDesc('u.created_at')
            ->limit(20)
            ->get(['u.id', 'u.display_name', 'u.photo_url', 'ps.primary_sport_slug', 'ps.elo_rating', 'ps.reliability_score']);

        // People the viewer follows — used to count mutual followers per candidate.
        $viewerFollowing = DB::table('follows')->where('follower_user_id', $user->id)->pluck('followed_user_id')->all();

        // Batch the mutual-follower count for ALL listed candidates in ONE query
        // (replaces the prior per-candidate COUNT(*), an N+1 over the result set).
        $candidateIds = $rows->pluck('id')->all();
        $mutualCounts = (empty($viewerFollowing) || empty($candidateIds))
            ? collect()
            : DB::table('follows')
                ->whereIn('followed_user_id', $candidateIds)
                ->whereIn('follower_user_id', $viewerFollowing)
                ->groupBy('followed_user_id')
                ->selectRaw('followed_user_id, count(*) as mutual')
                ->pluck('mutual', 'followed_user_id');

        // iOS `RecommendedPlayer` requires non-optional mutual_followers_count:Int,
        // score:Double and reasons:[String]; the rest are optional.
        $membership = app(MembershipService::class);
        $hasPriorityMatchmaking = $membership->canUseFeature($user->id, 'priority_matchmaking');

        return response()->json(array_merge([
            'items' => $rows->map(function ($u) use ($mutualCounts) {
                $mutual = (int) ($mutualCounts[$u->id] ?? 0);
                $elo = $u->elo_rating !== null ? (int) $u->elo_rating : null;

                $reasons = [];
                if ($mutual > 0) {
                    $reasons[] = $mutual === 1 ? '1 ortaq izləyici' : $mutual.' ortaq izləyici';
                }
                if ($u->primary_sport_slug !== null) {
                    $reasons[] = 'Eyni idman növü';
                }
                if ($reasons === []) {
                    $reasons[] = 'Yeni oyunçu';
                }

                return [
                    'user_id' => $u->id,
                    // Aliases so web clients that read id/primary_sport/primary_elo
                    // get populated values (consistent with players & suggested-follows).
                    'id' => $u->id,
                    'display_name' => $u->display_name,
                    'photo_url' => $u->photo_url,
                    'primary_sport_slug' => $u->primary_sport_slug,
                    'primary_sport' => $u->primary_sport_slug,
                    'elo_rating' => $elo,
                    'primary_elo' => $elo,
                    'reliability_score' => $u->reliability_score !== null ? (int) $u->reliability_score : null,
                    'distance_km' => null,
                    'mutual_followers_count' => (int) $mutual,
                    'score' => (float) ($mutual * 2 + ($elo !== null ? 1 : 0)),
                    'reasons' => $reasons,
                    'reason_codes' => null,
                ];
            }),
        ], $this->featureAccessPayload($membership, (string) $user->id, 'priority_matchmaking', $hasPriorityMatchmaking)));
    }

    protected function featureAccessPayload(MembershipService $membership, string $userId, string $feature, bool $allowed): array
    {
        $state = $membership->resolve($userId);
        $payload = [
            'access' => [
                'full_access' => $state->is_premium,
                'features' => $membership->publicFeaturesForUser($userId),
            ],
            'feature_locks' => $allowed ? [] : [[
                'feature' => $feature,
                'locked' => true,
            ]],
        ];

        if ((bool) config('membership.public_subscriptions_enabled', false)) {
            $payload['is_premium'] = $state->is_premium;
            $payload['premium_locked'] = ! $allowed;
            $payload['locked_features'] = $allowed ? [] : [$feature];
        }

        return $payload;
    }

    public function challenges(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $today = now()->toDateString();
        $codes = self::CHALLENGE_CODES;
        foreach ($codes as $code) {
            DB::table('user_challenges')->updateOrInsert(
                ['user_id' => $user->id, 'challenge_code' => $code, 'date' => $today],
                ['created_at' => now()],
            );
        }

        return response()->json(['items' => DB::table('user_challenges')->where('user_id', $user->id)->where('date', $today)->get()]);
    }

    public function checkChallenge(Request $request, string $code): JsonResponse
    {
        $user = $this->authUser($request);
        // Reject an unknown `{code}` rather than silently running a 0-row UPDATE
        // and returning ok:true. Valid clients only ever submit a code surfaced
        // by challenges(), so this never breaks a legitimate request.
        if (! in_array($code, self::CHALLENGE_CODES, true)) {
            throw ApiException::validation('Unknown challenge code', [
                'issues' => ['code' => ['The selected challenge code is invalid.']],
            ]);
        }
        $today = now()->toDateString();
        DB::table('user_challenges')
            ->where('user_id', $user->id)
            ->where('date', $today)
            ->where('challenge_code', $code)
            ->whereNull('completed_at')
            ->update(['completed_at' => now()]);

        // Return the refreshed challenge set so the client can update its UI
        // without issuing a second GET /challenges.
        return response()->json([
            'ok' => true,
            'items' => DB::table('user_challenges')->where('user_id', $user->id)->where('date', $today)->get(),
        ]);
    }

    private function bookingActivity(string $userId)
    {
        return DB::table('bookings as b')
            ->join('courts as c', 'c.id', '=', 'b.court_id')
            ->join('venues as v', 'v.id', '=', 'c.venue_id')
            ->leftJoin('sports as s', 's.id', '=', 'c.sport_id')
            ->where('b.user_id', $userId)
            ->whereIn('s.slug', ['padel', 'tennis'])
            ->orderByDesc('b.starts_at')
            ->limit(200)
            ->get([
                'b.id',
                'b.starts_at',
                'b.duration_minutes',
                'b.status',
                'b.total_minor',
                'b.currency',
                'c.id as court_id',
                'c.name as court_name',
                'v.id as venue_id',
                'v.name as venue_name',
                's.slug as sport_slug',
            ])
            ->map(fn ($booking) => [
                'id' => 'booking:'.$booking->id,
                'type' => 'booking',
                'target_id' => $booking->id,
                'event_at' => $this->iso($booking->starts_at),
                'status' => $booking->status,
                'title' => $booking->venue_name,
                'subtitle' => $booking->court_name,
                'sport_slug' => $booking->sport_slug,
                'venue_id' => $booking->venue_id,
                'venue_name' => $booking->venue_name,
                'court_id' => $booking->court_id,
                'court_name' => $booking->court_name,
                'duration_minutes' => (int) $booking->duration_minutes,
                'amount_minor' => (int) $booking->total_minor,
                'currency' => $booking->currency,
            ]);
    }

    private function gameActivity(string $userId)
    {
        return DB::table('game_participants as gp')
            ->join('games as g', 'g.id', '=', 'gp.game_id')
            ->join('sports as s', 's.id', '=', 'g.sport_id')
            ->leftJoin('courts as c', 'c.id', '=', 'g.court_id')
            ->leftJoin('venues as v', 'v.id', '=', 'c.venue_id')
            ->where('gp.user_id', $userId)
            ->whereNull('g.deleted_at')
            ->whereIn('s.slug', ['padel', 'tennis'])
            ->orderByDesc('g.starts_at')
            ->limit(200)
            ->get([
                'g.id',
                'g.starts_at',
                'g.duration_minutes',
                'g.status',
                'g.capacity',
                'gp.status as participant_status',
                's.slug as sport_slug',
                'c.id as court_id',
                'c.name as court_name',
                'v.id as venue_id',
                'v.name as venue_name',
            ])
            ->map(fn ($game) => [
                'id' => 'game:'.$game->id,
                'type' => 'game',
                'target_id' => $game->id,
                'event_at' => $this->iso($game->starts_at),
                'status' => $game->status,
                'participant_status' => $game->participant_status,
                'title' => ucfirst((string) $game->sport_slug).' game',
                'subtitle' => $game->venue_name ?: $game->court_name,
                'sport_slug' => $game->sport_slug,
                'venue_id' => $game->venue_id,
                'venue_name' => $game->venue_name,
                'court_id' => $game->court_id,
                'court_name' => $game->court_name,
                'duration_minutes' => (int) $game->duration_minutes,
                'capacity' => (int) $game->capacity,
            ]);
    }

    private function tournamentActivity(string $userId)
    {
        return DB::table('tournament_entries as e')
            ->join('tournaments as t', 't.id', '=', 'e.tournament_id')
            ->join('sports as s', 's.id', '=', 't.sport_id')
            ->leftJoin('venues as v', 'v.id', '=', 't.venue_id')
            ->whereIn('s.slug', ['padel', 'tennis'])
            ->where(function ($q) use ($userId) {
                $q->where('e.captain_user_id', $userId)
                    ->orWhereRaw('e.player_ids @> ARRAY[?]::uuid[]', [$userId]);
            })
            ->orderByDesc('t.starts_at')
            ->limit(200)
            ->get([
                'e.id',
                'e.tournament_id',
                'e.status as entry_status',
                'e.squad_name',
                't.name',
                't.starts_at',
                't.ends_at',
                't.status',
                't.entry_fee_minor',
                't.currency',
                's.slug as sport_slug',
                'v.id as venue_id',
                'v.name as venue_name',
            ])
            ->map(fn ($entry) => [
                'id' => 'tournament:'.$entry->id,
                'type' => 'tournament',
                'target_id' => $entry->tournament_id,
                'entry_id' => $entry->id,
                'event_at' => $this->iso($entry->starts_at),
                'ends_at' => $this->iso($entry->ends_at),
                'status' => $entry->status,
                'entry_status' => $entry->entry_status,
                'title' => $entry->name,
                'subtitle' => $entry->venue_name,
                'sport_slug' => $entry->sport_slug,
                'venue_id' => $entry->venue_id,
                'venue_name' => $entry->venue_name,
                'squad_name' => $entry->squad_name,
                'amount_minor' => (int) $entry->entry_fee_minor,
                'currency' => $entry->currency,
            ]);
    }
}
