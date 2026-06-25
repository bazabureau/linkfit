<?php

namespace App\Http\Controllers\Api;

use App\Support\ApiException;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class WebController extends ApiController
{
    public function bootstrap(): JsonResponse
    {
        $sports = DB::table('sports')
            ->whereIn('slug', ['padel', 'tennis'])
            ->orderByRaw("case when slug = 'padel' then 0 when slug = 'tennis' then 1 else 2 end")
            ->get(['id', 'slug', 'name', 'min_players', 'max_players']);

        $venueRows = DB::table('venues as v')
            ->where(fn ($q) => $q->whereNull('v.status')->orWhere('v.status', 'published'))
            ->orderBy('v.name')
            ->limit(12)
            ->get(['v.id', 'v.name', 'v.address', 'v.lat', 'v.lng', 'v.photo_url', 'v.photo_urls', 'v.rating_avg', 'v.rating_count']);

        // Single grouped active-court count keyed by venue_id (was one COUNT per
        // venue — up to 12 extra queries on this public, uncached hot path).
        $venueIds = $venueRows->pluck('id')->all();
        $courtsCountByVenue = $venueIds === []
            ? collect()
            : DB::table('courts')
                ->whereIn('venue_id', $venueIds)
                ->where(fn ($q) => $q->whereNull('status')->orWhere('status', 'active'))
                ->groupBy('venue_id')
                ->selectRaw('venue_id, count(*) as cnt')
                ->pluck('cnt', 'venue_id');

        $venues = $venueRows
            ->map(fn ($venue) => [
                ...((array) $venue),
                'lat' => (float) $venue->lat,
                'lng' => (float) $venue->lng,
                'photo_urls' => $this->arrayPayload($venue->photo_urls ?? null),
                'rating_avg' => $venue->rating_avg !== null ? (float) $venue->rating_avg : null,
                'rating_count' => (int) ($venue->rating_count ?? 0),
                'courts_count' => (int) ($courtsCountByVenue[$venue->id] ?? 0),
            ])
            ->values();

        $gameRows = DB::table('games as g')
            ->join('sports as s', 's.id', '=', 'g.sport_id')
            ->join('users as hu', 'hu.id', '=', 'g.host_user_id')
            ->leftJoin('courts as c', 'c.id', '=', 'g.court_id')
            ->leftJoin('venues as v', 'v.id', '=', 'c.venue_id')
            ->leftJoin('player_sport_stats as hps', function ($join) {
                $join->on('hps.user_id', '=', 'g.host_user_id')
                    ->on('hps.sport_id', '=', 'g.sport_id');
            })
            ->whereNull('g.deleted_at')
            ->whereNull('hu.deleted_at')
            ->whereIn('g.status', ['open', 'full'])
            ->where('g.visibility', 'public')
            ->where('g.starts_at', '>=', now())
            ->whereIn('s.slug', ['padel', 'tennis'])
            ->orderBy('g.starts_at')
            ->limit(8)
            ->get([
                'g.id',
                'g.host_user_id',
                'hu.display_name as host_display_name',
                'hu.photo_url as host_photo_url',
                'hps.elo_rating as host_elo',
                'g.starts_at',
                'g.duration_minutes',
                'g.capacity',
                'g.status',
                'g.court_id',
                'g.visibility',
                's.slug as sport_slug',
                'c.name as court_name',
                'c.hourly_price_minor',
                'c.currency',
                'v.id as venue_id',
                'v.name as venue_name',
                'v.address as venue_address',
            ]);

        // Batch all confirmed participants for the page's games into ONE query
        // (was a per-game lookup — up to 8 extra round trips per public load),
        // then group by game_id in memory. Response shape is unchanged.
        $gameIds = $gameRows->pluck('id')->all();
        $participantsByGame = $gameIds === []
            ? collect()
            : DB::table('game_participants as gp')
                ->join('users as u', 'u.id', '=', 'gp.user_id')
                ->whereIn('gp.game_id', $gameIds)
                ->where('gp.status', 'confirmed')
                ->whereNull('u.deleted_at')
                ->orderBy('gp.joined_at')
                ->get(['gp.game_id', 'gp.user_id', 'u.display_name', 'u.photo_url', 'gp.status'])
                ->groupBy('game_id');

        $games = $gameRows
            ->map(function ($game) use ($participantsByGame) {
                $participants = $participantsByGame->get($game->id) ?? collect();
                $totalMinor = $game->hourly_price_minor !== null
                    ? (int) round(((int) $game->hourly_price_minor) * ((int) ($game->duration_minutes ?? 60)) / 60)
                    : null;

                return [
                    'id' => $game->id,
                    'starts_at' => $this->iso($game->starts_at),
                    'duration_minutes' => (int) ($game->duration_minutes ?? 60),
                    'capacity' => (int) $game->capacity,
                    'status' => $game->status,
                    'visibility' => $game->visibility ?? 'public',
                    'sport_slug' => $game->sport_slug,
                    'court_id' => $game->court_id,
                    'court_name' => $game->court_name,
                    'venue_id' => $game->venue_id ?? null,
                    'venue_name' => $game->venue_name,
                    'venue_address' => $game->venue_address ?? null,
                    // Nested host object consumed by the web home/discover cards.
                    'host' => [
                        'id' => $game->host_user_id,
                        'display_name' => $game->host_display_name,
                        'photo_url' => $game->host_photo_url ?? null,
                        'elo' => isset($game->host_elo) && $game->host_elo !== null ? (int) $game->host_elo : null,
                    ],
                    'participants_count' => $participants->count(),
                    'participants' => $participants->map(fn ($participant) => [
                        'user_id' => $participant->user_id,
                        'display_name' => $participant->display_name,
                        'photo_url' => $participant->photo_url,
                        'status' => $participant->status,
                    ])->values(),
                    'price_minor' => $totalMinor !== null && (int) $game->capacity > 0 ? (int) ceil($totalMinor / (int) $game->capacity) : null,
                    'total_minor' => $totalMinor,
                    'currency' => $game->currency ?? 'AZN',
                ];
            })
            ->values();

        $tournaments = DB::table('tournaments as t')
            ->join('sports as s', 's.id', '=', 't.sport_id')
            ->leftJoin('venues as v', 'v.id', '=', 't.venue_id')
            ->where('t.starts_at', '>=', now()->subDay())
            ->whereNotIn('t.status', ['cancelled', 'completed'])
            ->whereIn('s.slug', ['padel', 'tennis'])
            ->orderBy('t.starts_at')
            ->limit(8)
            ->get(['t.id', 't.name', 't.status', 't.starts_at', 't.entry_fee_minor', 't.currency', 's.slug as sport_slug', 'v.name as venue_name'])
            ->map(fn ($tournament) => [
                ...((array) $tournament),
                'starts_at' => $this->iso($tournament->starts_at),
            ])
            ->values();

        return response()->json([
            'sports' => $sports,
            'venues' => $venues,
            'games' => $games,
            'tournaments' => $tournaments,
            'stats' => [
                'venues' => DB::table('venues')->where(fn ($q) => $q->whereNull('status')->orWhere('status', 'published'))->count(),
                'courts' => DB::table('courts as c')
                    ->join('sports as s', 's.id', '=', 'c.sport_id')
                    ->whereIn('s.slug', ['padel', 'tennis'])
                    ->where(fn ($q) => $q->whereNull('c.status')->orWhere('c.status', 'active'))
                    ->count(),
                'open_games' => DB::table('games as g')
                    ->join('sports as s', 's.id', '=', 'g.sport_id')
                    ->whereIn('s.slug', ['padel', 'tennis'])
                    ->whereNull('g.deleted_at')
                    ->where('g.status', 'open')
                    ->where('g.starts_at', '>=', now())
                    ->count(),
            ],
        ]);
    }

    /**
     * Public platform stats for the marketing/about page — real counts, no
     * hardcoded numbers. Cheap aggregate, no auth.
     */
    public function publicStats(): JsonResponse
    {
        return response()->json([
            'active_players' => DB::table('users')->whereNull('deleted_at')->count(),
            'partner_clubs' => DB::table('venues')
                ->where(fn ($q) => $q->whereNull('status')->orWhere('status', 'published'))
                ->count(),
            'weekly_matches' => DB::table('games as g')
                ->join('sports as s', 's.id', '=', 'g.sport_id')
                ->whereIn('s.slug', ['padel', 'tennis'])
                ->whereNull('g.deleted_at')
                ->where('g.starts_at', '>=', now()->subDays(7))
                ->count(),
            'tournaments' => DB::table('tournaments')->count(),
        ]);
    }

    public function dashboard(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $now = now();

        $bookings = DB::table('bookings as b')
            ->join('courts as c', 'c.id', '=', 'b.court_id')
            ->join('venues as v', 'v.id', '=', 'c.venue_id')
            ->where('b.user_id', $user->id)
            ->orderByDesc('b.starts_at')
            ->limit(50)
            ->get(['b.*', 'c.name as court_name', 'v.id as venue_id', 'v.name as venue_name'])
            ->map(fn ($booking) => $this->bookingPayload($booking))
            ->values();

        $games = DB::table('game_participants as gp')
            ->join('games as g', 'g.id', '=', 'gp.game_id')
            ->join('sports as s', 's.id', '=', 'g.sport_id')
            ->leftJoin('courts as c', 'c.id', '=', 'g.court_id')
            ->leftJoin('venues as v', 'v.id', '=', 'c.venue_id')
            ->where('gp.user_id', $user->id)
            ->where('gp.status', 'confirmed')
            ->where('g.starts_at', '>=', $now->copy()->subDay())
            ->whereIn('s.slug', ['padel', 'tennis'])
            ->orderBy('g.starts_at')
            ->limit(50)
            // Inline correlated subquery for the confirmed participant count
            // (was a per-row COUNT — up to 50 extra queries). Mirrors
            // DiscoveryController::nearbyGamesData / GamesController.
            ->get([
                'g.id', 'g.starts_at', 'g.status', 'g.capacity',
                's.slug as sport_slug', 'c.name as court_name', 'v.name as venue_name',
                DB::raw("(select count(*) from game_participants gp2 where gp2.game_id = g.id and gp2.status = 'confirmed') as participants_count"),
            ])
            ->map(fn ($game) => [
                ...((array) $game),
                'starts_at' => $this->iso($game->starts_at),
                'participants_count' => (int) $game->participants_count,
            ])
            ->values();

        $notifications = DB::table('notifications')
            ->where('user_id', $user->id)
            ->orderByDesc('created_at')
            ->limit(10)
            ->get()
            ->map(fn ($notification) => [
                ...((array) $notification),
                'payload' => $this->jsonPayload($notification->payload ?? null),
                'created_at' => $this->iso($notification->created_at),
                'read_at' => $this->iso($notification->read_at ?? null),
            ])
            ->values();

        return response()->json([
            'user' => $user->toPublicUser(),
            'bookings' => [
                'upcoming' => $bookings->filter(fn ($b) => $b['starts_at'] >= $now->toIso8601ZuluString('millisecond'))->values(),
                'past' => $bookings->filter(fn ($b) => $b['starts_at'] < $now->toIso8601ZuluString('millisecond'))->values(),
            ],
            'games' => $games,
            'notifications' => [
                'items' => $notifications,
                'unread_count' => DB::table('notifications')->where('user_id', $user->id)->whereNull('read_at')->count(),
            ],
            'stats' => [
                'bookings_total' => $bookings->count(),
                'bookings_upcoming' => $bookings->filter(fn ($b) => $b['starts_at'] >= $now->toIso8601ZuluString('millisecond'))->count(),
                'games_total' => DB::table('game_participants')->where('user_id', $user->id)->whereIn('status', ['confirmed', 'played', 'no_show'])->count(),
                'tournament_entries_total' => DB::table('tournament_entries')
                    ->where(fn ($q) => $q
                        ->where('captain_user_id', $user->id)
                        ->orWhereRaw('player_ids @> ARRAY[?]::uuid[]', [$user->id]))
                    ->count(),
            ],
        ]);
    }

    public function checkout(Request $request, string $courtId): JsonResponse
    {
        $query = $this->validateQuery($request, [
            'date' => ['nullable', 'regex:/^\d{4}-\d{2}-\d{2}$/'],
        ]);
        $date = $query['date'] ?? now('Asia/Baku')->format('Y-m-d');
        $court = DB::table('courts as c')
            ->join('venues as v', 'v.id', '=', 'c.venue_id')
            ->join('sports as s', 's.id', '=', 'c.sport_id')
            ->where('c.id', $courtId)
            ->whereIn('s.slug', ['padel', 'tennis'])
            ->first([
                'c.*',
                's.slug as sport_slug',
                's.name as sport_name',
                'v.id as venue_id',
                'v.name as venue_name',
                'v.address as venue_address',
                'v.opening_hours',
                'v.booking_slot_minutes',
                'v.min_booking_minutes',
                'v.max_booking_minutes',
                'v.cancellation_window_minutes',
            ]);
        if ($court === null) {
            throw ApiException::notFound('Court not found');
        }

        return response()->json([
            'court' => [
                'id' => $court->id,
                'name' => $court->name,
                'sport_slug' => $court->sport_slug,
                'sport_name' => $court->sport_name,
                'hourly_price_minor' => (int) $court->hourly_price_minor,
                'currency' => $court->currency,
                'photo_url' => $court->photo_url ?? null,
                'photo_urls' => $this->arrayPayload($court->photo_urls ?? null),
            ],
            'venue' => [
                'id' => $court->venue_id,
                'name' => $court->venue_name,
                'address' => $court->venue_address,
            ],
            'policy' => [
                'date' => $date,
                'opening_hours' => $this->openingHoursForDate($court, $date),
                'slot_minutes' => (int) ($court->booking_slot_minutes ?? 30),
                'min_booking_minutes' => (int) ($court->min_booking_minutes ?? 60),
                'max_booking_minutes' => (int) ($court->max_booking_minutes ?? 120),
                'cancellation_window_minutes' => (int) ($court->cancellation_window_minutes ?? 120),
                'payment_methods' => ['onsite', 'cash', 'bank_transfer'],
            ],
            'availability_endpoint' => '/api/v1/courts/'.$courtId.'/availability?date='.$date,
            'suggested_slots_endpoint' => '/api/v1/courts/'.$courtId.'/suggested-slots?starts_at=ISO8601&duration_minutes=60',
            'quote_endpoint' => '/api/v1/bookings/quote',
            'promo_code_validate_endpoint' => '/api/v1/promo-codes/validate',
            'create_hold_endpoint' => '/api/v1/booking-holds',
            'release_hold_endpoint' => '/api/v1/booking-holds/{id}',
            'hold_ttl_seconds' => 300,
            'create_booking_endpoint' => '/api/v1/bookings',
        ]);
    }

    private function bookingPayload(object $booking): array
    {
        $starts = CarbonImmutable::parse($booking->starts_at);

        return [
            'id' => $booking->id,
            'court_id' => $booking->court_id,
            'court_name' => $booking->court_name ?? '',
            'venue_id' => $booking->venue_id ?? null,
            'venue_name' => $booking->venue_name ?? '',
            'starts_at' => $starts->toIso8601ZuluString('millisecond'),
            'ends_at' => $starts->addMinutes((int) $booking->duration_minutes)->toIso8601ZuluString('millisecond'),
            'duration_minutes' => (int) $booking->duration_minutes,
            'total_minor' => (int) $booking->total_minor,
            'currency' => $booking->currency,
            'status' => $booking->status,
            'payment_method' => $booking->payment_method ?? null,
            'created_at' => $this->iso($booking->created_at),
            'cancelled_at' => $this->iso($booking->cancelled_at ?? null),
            'paid_at' => $this->iso($booking->paid_at ?? null),
        ];
    }

    private function openingHoursForDate(object $court, string $date): ?array
    {
        $hours = $this->jsonPayload($court->opening_hours ?? null);
        $day = (string) CarbonImmutable::parse($date, 'Asia/Baku')->dayOfWeekIso;
        $rule = $hours[$day] ?? $hours[strtolower(CarbonImmutable::parse($date, 'Asia/Baku')->englishDayOfWeek)] ?? null;
        if (is_array($rule) && ($rule['closed'] ?? false)) {
            return null;
        }

        return [
            'open' => is_array($rule) ? ($rule['open'] ?? '07:00') : '07:00',
            'close' => is_array($rule) ? ($rule['close'] ?? '23:00') : '23:00',
        ];
    }

    private function jsonPayload(mixed $value): array
    {
        if (is_array($value)) {
            return $value;
        }
        $decoded = json_decode((string) ($value ?? ''), true);

        return is_array($decoded) ? $decoded : [];
    }

    private function arrayPayload(mixed $value): array
    {
        if ($value === null || $value === '{}') {
            return [];
        }
        if (is_array($value)) {
            return array_values($value);
        }
        $string = trim((string) $value);
        $decoded = json_decode($string, true);
        if (is_array($decoded)) {
            return array_values($decoded);
        }
        if ($string === '') {
            return [];
        }
        if ($string[0] === '{' && substr($string, -1) === '}') {
            $string = substr($string, 1, -1);
        }

        return $string === '' ? [] : str_getcsv($string, ',', '"', '\\');
    }
}
