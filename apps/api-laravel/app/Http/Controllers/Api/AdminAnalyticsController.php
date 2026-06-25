<?php

namespace App\Http\Controllers\Api;

use App\Support\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Deeper admin analytics / dashboard reports — headline KPIs, growth time
 * series, revenue, club performance, engagement and the activation funnel.
 * Admin/moderator only. Computed live from the operational tables.
 */
class AdminAnalyticsController extends ApiController
{
    /** GET /admin/analytics/overview — headline KPIs + revenue. */
    public function overview(Request $request): JsonResponse
    {
        $this->staff($request);
        $d30 = now()->subDays(30);

        return response()->json([
            'currency' => 'AZN',
            'users' => [
                'total' => DB::table('users')->whereNull('deleted_at')->count(),
                'new_30d' => DB::table('users')->whereNull('deleted_at')->where('created_at', '>=', $d30)->count(),
                'active_30d' => DB::table('users')->whereNull('deleted_at')->where('last_seen_at', '>=', $d30)->count(),
                'vip' => DB::table('users')->whereNull('deleted_at')->where('is_vip', true)->count(),
                'verified' => DB::table('users')->whereNull('deleted_at')->where('is_verified', true)->count(),
            ],
            'venues' => [
                'total' => DB::table('venues')->count(),
                // The venues.status enum is draft/pending/published/suspended (see
                // lookups()); 'published' is the live/active state, not 'active'.
                'active' => DB::table('venues')->where('status', 'published')->count(),
            ],
            'games' => [
                'total' => DB::table('games')->whereNull('deleted_at')->count(),
                'new_30d' => DB::table('games')->whereNull('deleted_at')->where('created_at', '>=', $d30)->count(),
            ],
            'bookings' => [
                'total' => DB::table('bookings')->count(),
                'new_30d' => DB::table('bookings')->where('created_at', '>=', $d30)->count(),
                'paid' => DB::table('bookings')->whereNotNull('paid_at')->count(),
                'cancelled' => DB::table('bookings')->where('status', 'cancelled')->count(),
            ],
            'learn' => [
                'coaches' => DB::table('coaches')->where('is_active', true)->count(),
                'lessons' => DB::table('lessons')->count(),
                'lesson_bookings' => DB::table('lesson_bookings')->where('status', 'booked')->count(),
            ],
            'revenue' => [
                // Gross = all non-cancelled bookings; paid = actually collected.
                'gross_booking_minor' => (int) DB::table('bookings')->where('status', '<>', 'cancelled')->sum('total_minor'),
                'paid_booking_minor' => (int) DB::table('bookings')->whereNotNull('paid_at')->sum('total_minor'),
                'gross_booking_30d_minor' => (int) DB::table('bookings')->where('status', '<>', 'cancelled')->where('created_at', '>=', $d30)->sum('total_minor'),
            ],
        ]);
    }

    /** GET /admin/analytics/growth?days=30 — per-day time series. */
    public function growth(Request $request): JsonResponse
    {
        $this->staff($request);
        $days = min(max((int) $request->query('days', 30), 1), 365);
        $from = now()->subDays($days)->startOfDay();

        $perDay = fn (string $table, ?callable $extra = null) => DB::table($table)
            ->where('created_at', '>=', $from)
            ->when($extra, $extra)
            ->selectRaw('created_at::date as date, count(*) as count')
            ->groupBy('date')->orderBy('date')->get();

        return response()->json([
            'days' => $days,
            'new_users' => $perDay('users', fn ($q) => $q->whereNull('deleted_at')),
            'new_games' => $perDay('games', fn ($q) => $q->whereNull('deleted_at')),
            'new_bookings' => $perDay('bookings'),
            'revenue' => DB::table('bookings')
                ->where('created_at', '>=', $from)->where('status', '<>', 'cancelled')
                ->selectRaw('created_at::date as date, sum(total_minor)::bigint as amount_minor')
                ->groupBy('date')->orderBy('date')->get(),
        ]);
    }

    /** GET /admin/analytics/clubs — top venues by bookings + revenue. */
    public function clubs(Request $request): JsonResponse
    {
        $this->staff($request);
        $rows = DB::table('venues as v')
            ->leftJoin('courts as c', 'c.venue_id', '=', 'v.id')
            ->leftJoin('bookings as b', 'b.court_id', '=', 'c.id')
            ->groupBy('v.id', 'v.name', 'v.status')
            ->selectRaw("
                v.id, v.name, v.status,
                count(distinct c.id) as courts,
                count(b.id) as bookings,
                coalesce(sum(b.total_minor) filter (where b.status <> 'cancelled'), 0)::bigint as revenue_minor,
                coalesce(sum(b.total_minor) filter (where b.paid_at is not null), 0)::bigint as paid_revenue_minor
            ")
            ->orderByDesc('bookings')->limit(25)->get();

        return response()->json(['currency' => 'AZN', 'items' => $rows]);
    }

    /** GET /admin/analytics/engagement — activity over the last 30 days. */
    public function engagement(Request $request): JsonResponse
    {
        $this->staff($request);
        $d30 = now()->subDays(30);
        $gamesTotal = DB::table('games')->whereNull('deleted_at')->count();

        return response()->json([
            'games_created_30d' => DB::table('games')->whereNull('deleted_at')->where('created_at', '>=', $d30)->count(),
            'game_joins_30d' => DB::table('game_participants')->where('joined_at', '>=', $d30)->count(),
            'lesson_bookings_30d' => DB::table('lesson_bookings')->where('created_at', '>=', $d30)->count(),
            'messages_30d' => DB::table('messages')->where('created_at', '>=', $d30)->count(),
            'follows_30d' => DB::table('follows')->where('created_at', '>=', $d30)->count(),
            'follows_total' => DB::table('follows')->count(),
            'avg_participants_per_game' => round(
                DB::table('game_participants')->where('status', 'confirmed')->count() / max(1, $gamesTotal),
                2
            ),
            'by_match_type' => DB::table('games')->whereNull('deleted_at')
                ->selectRaw('coalesce(match_type, \'casual\') as match_type, count(*) as count')
                ->groupBy('match_type')->get(),
        ]);
    }

    /** GET /admin/analytics/funnel — registration → activation → retention. */
    public function funnel(Request $request): JsonResponse
    {
        $this->staff($request);
        $registered = DB::table('users')->whereNull('deleted_at')->count();
        $playedGame = DB::table('users as u')->whereNull('u.deleted_at')
            ->whereExists(fn ($q) => $q->select(DB::raw(1))->from('game_participants as gp')->whereColumn('gp.user_id', 'u.id'))
            ->count();
        $bookedCourt = DB::table('users as u')->whereNull('u.deleted_at')
            ->whereExists(fn ($q) => $q->select(DB::raw(1))->from('bookings as b')->whereColumn('b.user_id', 'u.id'))
            ->count();
        $referred = DB::table('users')->whereNull('deleted_at')->whereNotNull('referred_by_user_id')->count();

        return response()->json([
            'registered' => $registered,
            'played_a_game' => $playedGame,
            'booked_a_court' => $bookedCourt,
            'came_via_referral' => $referred,
        ]);
    }

    private function staff(Request $request): object
    {
        $user = $this->authUser($request);
        if (! in_array($user->admin_role, ['admin', 'moderator'], true)) {
            throw ApiException::forbidden('Admin access required');
        }

        return $user;
    }
}
