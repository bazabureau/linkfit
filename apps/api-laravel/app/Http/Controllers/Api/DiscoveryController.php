<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class DiscoveryController extends ApiController
{
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
        $bookings = DB::table('bookings')->where('user_id', $user->id)->where('starts_at', '>=', now()->subDay())->orderBy('starts_at')->limit(50)->get();

        return response()->json(['games' => $games, 'bookings' => $bookings]);
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

        return response()->json([
            'items' => $events->slice($offset, $limit)->values(),
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
                    'ms.completed_at', 'ms.current_game_a', 'ms.current_game_b',
                    'ms.team_a_user_ids', 'ms.team_b_user_ids', 'ms.elo_delta_by_user',
                ])->all();
        }

        // Normalise each match into a small record.
        $matches = [];
        foreach ($rows as $r) {
            $teamA = $this->pgUuidArray($r->team_a_user_ids);
            $teamB = $this->pgUuidArray($r->team_b_user_ids);
            $userTeam = in_array($user->id, $teamA, true) ? 'a' : 'b';
            $winningTeam = ((int) $r->current_game_a >= (int) $r->current_game_b) ? 'a' : 'b';
            $deltas = json_decode($r->elo_delta_by_user ?? '{}', true) ?: [];
            $matches[] = [
                'at' => \Illuminate\Support\Carbon::parse($r->completed_at),
                'won' => $userTeam === $winningTeam,
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

        return response()->json([
            'sport_slug' => $slug,
            'days' => $days,
            'total_games' => count($windowMatches),
            'current_elo' => $currentElo,
            'current_reliability' => $currentReliability,
            'elo_series' => $eloSeries,
            'win_rate_series' => $winRateSeries,
            'games_per_week' => $gamesPerWeek,
            'opponents' => $opponents,
            'reliability_series' => [],
        ]);
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

    public function suggestedFollows(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $rows = DB::table('users as u')
            ->where('u.id', '!=', $user->id)
            ->whereNull('u.deleted_at')
            ->whereNotExists(function ($q) use ($user) {
                $q->selectRaw('1')->from('follows as f')->whereColumn('f.followed_user_id', 'u.id')->where('f.follower_user_id', $user->id);
            })
            ->orderByDesc('u.created_at')
            ->limit(20)
            ->get();

        // iOS `SuggestedFollowItem` (Endpoint+SuggestedFollows.swift) requires an
        // explicit shape — NON-optional user_id/display_name/shared_games_count/reason
        // — so we cannot reuse publicUser() (it emits `id`, omits the rest). The
        // `users` table has no `primary_elo` column (ELO lives in
        // player_sport_stats.elo_rating), so it is emitted as null to satisfy the
        // Swift `primary_elo: Int?` optional. shared_games_count is a 0 placeholder
        // until the mutual-games join is wired; reason is a non-null string.
        return response()->json(['items' => $rows->map(fn ($u) => [
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
            ->where('g.host_user_id', '!=', $user->id)
            ->where('g.status', 'open')
            ->where('g.visibility', 'public')
            ->where('g.starts_at', '>=', now())
            ->whereIn('s.slug', ['padel', 'tennis'])
            ->orderBy('g.starts_at')
            ->limit(50)
            ->get(['g.id', 'g.sport_id', 's.slug as sport_slug', 'g.starts_at', 'g.capacity', 'g.lat', 'g.lng']);

        return response()->json(['items' => $rows]);
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
            ->whereNotExists(function ($q) use ($user) {
                $q->selectRaw('1')->from('follows as f')
                    ->whereColumn('f.followed_user_id', 'u.id')
                    ->where('f.follower_user_id', $user->id);
            })
            ->orderByDesc('u.created_at')
            ->limit(20)
            ->get(['u.id', 'u.display_name', 'u.photo_url', 'ps.primary_sport_slug', 'ps.elo_rating', 'ps.reliability_score']);

        // People the viewer follows — used to count mutual followers per candidate.
        $viewerFollowing = DB::table('follows')->where('follower_user_id', $user->id)->pluck('followed_user_id')->all();

        // iOS `RecommendedPlayer` requires non-optional mutual_followers_count:Int,
        // score:Double and reasons:[String]; the rest are optional.
        return response()->json(['items' => $rows->map(function ($u) use ($viewerFollowing) {
            $mutual = empty($viewerFollowing) ? 0 : DB::table('follows')
                ->where('followed_user_id', $u->id)
                ->whereIn('follower_user_id', $viewerFollowing)
                ->count();
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
                'display_name' => $u->display_name,
                'photo_url' => $u->photo_url,
                'primary_sport_slug' => $u->primary_sport_slug,
                'elo_rating' => $elo,
                'reliability_score' => $u->reliability_score !== null ? (int) $u->reliability_score : null,
                'distance_km' => null,
                'mutual_followers_count' => (int) $mutual,
                'score' => (float) ($mutual * 2 + ($elo !== null ? 1 : 0)),
                'reasons' => $reasons,
                'reason_codes' => null,
            ];
        })]);
    }

    public function challenges(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $today = now()->toDateString();
        $codes = ['follow_one', 'join_a_game', 'comment_on_feed'];
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
        DB::table('user_challenges')
            ->where('user_id', $user->id)
            ->where('date', now()->toDateString())
            ->where('challenge_code', $code)
            ->whereNull('completed_at')
            ->update(['completed_at' => now()]);

        return response()->json(['ok' => true]);
    }

    private function publicUser(object $u): array
    {
        return [
            'id' => $u->id,
            'email' => $u->email,
            'display_name' => $u->display_name,
            'photo_url' => $u->photo_url,
            'home_lat' => $u->home_lat !== null ? (float) $u->home_lat : null,
            'home_lng' => $u->home_lng !== null ? (float) $u->home_lng : null,
            'created_at' => $this->iso($u->created_at),
            'email_verified_at' => $this->iso($u->email_verified_at ?? null),
            'admin_role' => $u->admin_role ?? null,
        ];
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
