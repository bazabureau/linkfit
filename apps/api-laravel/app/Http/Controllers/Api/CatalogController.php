<?php

namespace App\Http\Controllers\Api;

use App\Support\ApiException;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class CatalogController extends ApiController
{
    public function sports(): JsonResponse
    {
        $rows = DB::table('sports')
            ->select('id', 'slug', 'name', 'min_players', 'max_players')
            ->whereIn('slug', ['padel', 'tennis'])
            ->orderByRaw("case when slug = 'padel' then 0 when slug = 'tennis' then 1 else 2 end")
            ->orderBy('slug')
            ->get();

        return response()->json(['items' => $rows]);
    }

    public function venues(Request $request): JsonResponse
    {
        $query = $this->validateQuery($request, [
            'lat' => ['nullable', 'numeric', 'between:-90,90'],
            'lng' => ['nullable', 'numeric', 'between:-180,180'],
            'radius_km' => ['nullable', 'numeric', 'min:0.1', 'max:200'],
            'q' => ['nullable', 'string', 'max:120'],
            'sport' => ['nullable', 'string', 'max:80'],
            'partner' => ['nullable', 'boolean'],
            'sort' => ['nullable', 'in:name,rating,distance'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
            'offset' => ['nullable', 'integer', 'min:0'],
        ]);

        $limit = (int) ($query['limit'] ?? 50);
        $offset = (int) ($query['offset'] ?? 0);
        $base = DB::table('venues as v')
            ->leftJoinSub($this->venueCourtAggregates(), 'agg', 'agg.venue_id', '=', 'v.id')
            ->where(fn ($q) => $q->whereNull('v.status')->orWhere('v.status', 'published'))
            ->selectRaw('v.id, v.name, v.address, v.lat, v.lng, v.is_partner, v.phone, v.description, v.description_i18n, v.logo_url, v.photo_url, v.photo_urls, v.rating_avg, v.rating_count, agg.courts_count, agg.from_price_minor');

        if (! empty($query['sport'])) {
            $base->whereExists(function ($q) use ($query) {
                $q->selectRaw('1')
                    ->from('courts as c')
                    ->join('sports as s', 's.id', '=', 'c.sport_id')
                    ->whereColumn('c.venue_id', 'v.id')
                    ->where('s.slug', $query['sport']);
            });
        }
        if (! empty($query['q'])) {
            $needle = '%'.mb_strtolower($query['q']).'%';
            $base->where(function ($q) use ($needle) {
                $q->whereRaw('LOWER(v.name) LIKE ?', [$needle])
                    ->orWhereRaw('LOWER(v.address) LIKE ?', [$needle])
                    ->orWhereRaw('LOWER(COALESCE(v.description, \'\')) LIKE ?', [$needle]);
            });
        }
        if (array_key_exists('partner', $query)) {
            $base->where('v.is_partner', filter_var($query['partner'], FILTER_VALIDATE_BOOLEAN));
        }

        if (isset($query['lat'], $query['lng'], $query['radius_km'])) {
            $lat = (float) $query['lat'];
            $lng = (float) $query['lng'];
            $meters = (float) $query['radius_km'] * 1000;
            $base->selectRaw(
                'earth_distance(ll_to_earth(?::float8, ?::float8), ll_to_earth(v.lat::float8, v.lng::float8))::text as distance_m',
                [$lat, $lng],
            )
                ->whereRaw('earth_box(ll_to_earth(?::float8, ?::float8), ?) @> ll_to_earth(v.lat::float8, v.lng::float8)', [$lat, $lng, $meters])
                ->whereRaw('earth_distance(ll_to_earth(?::float8, ?::float8), ll_to_earth(v.lat::float8, v.lng::float8)) <= ?', [$lat, $lng, $meters]);
        } else {
            $base->selectRaw('null::text as distance_m');
        }

        $total = (clone $base)->count('v.id');
        $sort = $query['sort'] ?? (isset($query['lat'], $query['lng'], $query['radius_km']) ? 'distance' : 'name');
        if ($sort === 'rating') {
            $base->orderByDesc('v.rating_avg')->orderByDesc('v.rating_count')->orderBy('v.name');
        } elseif ($sort === 'distance' && isset($query['lat'], $query['lng'], $query['radius_km'])) {
            $base->orderByRaw('distance_m::float asc')->orderBy('v.name');
        } else {
            $base->orderBy('v.name');
        }

        $rows = $base->offset($offset)->limit($limit)->get()->map(fn ($r) => $this->venuePayload($r));

        return response()->json([
            'items' => $rows,
            'pagination' => [
                'limit' => $limit,
                'offset' => $offset,
                'total' => $total,
            ],
        ]);
    }

    public function venue(string $id): JsonResponse
    {
        // A short hex prefix is a valid lookup form; anything else must be a full
        // UUID. Reject other shapes up front so a malformed id resolves to a clean
        // 404 instead of a Postgres uuid-cast 500.
        $isPrefix = preg_match('/^[0-9a-f]{8}$/i', $id) === 1;
        if (! $isPrefix && ! $this->isUuid($id)) {
            throw ApiException::notFound('Venue not found');
        }

        $venue = DB::table('venues')
            ->when(
                $isPrefix,
                fn ($q) => $q->whereRaw('id::text ilike ?', [$id.'%']),
                fn ($q) => $q->where('id', $id),
            )
            ->where(fn ($q) => $q->whereNull('status')->orWhere('status', 'published'))
            ->first();
        if ($venue === null) {
            throw ApiException::notFound('Venue not found');
        }

        $courts = DB::table('courts as c')
            ->join('venues as v', 'v.id', '=', 'c.venue_id')
            ->join('sports as s', 's.id', '=', 'c.sport_id')
            ->where('c.venue_id', $venue->id)
            ->orderBy('c.name')
            ->get([
                'c.id',
                'c.venue_id',
                'v.name as venue_name',
                'v.address as venue_address',
                'c.sport_id',
                's.slug as sport_slug',
                's.name as sport_name',
                'c.name',
                'c.hourly_price_minor',
                'c.currency',
                'c.status',
                'c.photo_url',
                'c.photo_urls',
            ])
            ->map(fn ($court) => $this->courtPayload($court));

        $payload = $this->venuePayload($venue);
        $payload['courts'] = $courts;

        return response()->json($payload);
    }

    public function courts(Request $request): JsonResponse
    {
        $query = $this->validateQuery($request, [
            'venue_id' => ['nullable', 'uuid'],
            'q' => ['nullable', 'string', 'max:120'],
            'sport' => ['nullable', 'string', 'max:80'],
            'status' => ['nullable', 'in:active,inactive,maintenance,all'],
            'min_price_minor' => ['nullable', 'integer', 'min:0'],
            'max_price_minor' => ['nullable', 'integer', 'min:0'],
            'sort' => ['nullable', 'in:venue,name,price_low,price_high'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:200'],
            'offset' => ['nullable', 'integer', 'min:0'],
        ]);

        $limit = (int) ($query['limit'] ?? 100);
        $offset = (int) ($query['offset'] ?? 0);
        $base = DB::table('courts as c')
            ->join('venues as v', 'v.id', '=', 'c.venue_id')
            ->join('sports as s', 's.id', '=', 'c.sport_id')
            ->when(! empty($query['venue_id']), fn ($q) => $q->where('c.venue_id', $query['venue_id']))
            ->when(! empty($query['q']), function ($q) use ($query) {
                $needle = '%'.mb_strtolower($query['q']).'%';
                $q->where(function ($w) use ($needle) {
                    $w->whereRaw('LOWER(c.name) LIKE ?', [$needle])
                        ->orWhereRaw('LOWER(v.name) LIKE ?', [$needle])
                        ->orWhereRaw('LOWER(v.address) LIKE ?', [$needle]);
                });
            })
            ->when(! empty($query['sport']), fn ($q) => $q->where('s.slug', $query['sport']))
            ->when(($query['status'] ?? null) !== 'all', fn ($q) => $q->where(fn ($w) => $w->whereNull('c.status')->orWhere('c.status', $query['status'] ?? 'active')))
            ->when(array_key_exists('min_price_minor', $query), fn ($q) => $q->where('c.hourly_price_minor', '>=', (int) $query['min_price_minor']))
            ->when(array_key_exists('max_price_minor', $query), fn ($q) => $q->where('c.hourly_price_minor', '<=', (int) $query['max_price_minor']))
            ->whereIn('s.slug', ['padel', 'tennis'])
            ->where(fn ($q) => $q->whereNull('v.status')->orWhere('v.status', 'published'));

        $total = (clone $base)->count('c.id');
        $sort = $query['sort'] ?? 'venue';
        if ($sort === 'price_low') {
            $base->orderBy('c.hourly_price_minor')->orderBy('v.name')->orderBy('c.name');
        } elseif ($sort === 'price_high') {
            $base->orderByDesc('c.hourly_price_minor')->orderBy('v.name')->orderBy('c.name');
        } elseif ($sort === 'name') {
            $base->orderBy('c.name')->orderBy('v.name');
        } else {
            $base->orderBy('v.name')->orderBy('c.name');
        }

        $rows = $base
            ->offset($offset)
            ->limit($limit)
            ->get([
                'c.id',
                'c.venue_id',
                'v.name as venue_name',
                'v.address as venue_address',
                'c.sport_id',
                's.slug as sport_slug',
                's.name as sport_name',
                'c.name',
                'c.hourly_price_minor',
                'c.currency',
                'c.status',
                'c.photo_url',
                'c.photo_urls',
            ])
            ->map(fn ($court) => $this->courtPayload($court));

        return response()->json([
            'items' => $rows,
            'pagination' => [
                'limit' => $limit,
                'offset' => $offset,
                'total' => $total,
            ],
        ]);
    }

    public function court(string $id): JsonResponse
    {
        $isPrefix = preg_match('/^[0-9a-f]{8}$/i', $id) === 1;
        if (! $isPrefix && ! $this->isUuid($id)) {
            throw ApiException::notFound('Court not found');
        }

        $court = DB::table('courts as c')
            ->join('venues as v', 'v.id', '=', 'c.venue_id')
            ->join('sports as s', 's.id', '=', 'c.sport_id')
            ->when(
                $isPrefix,
                fn ($q) => $q->whereRaw('c.id::text ilike ?', [$id.'%']),
                fn ($q) => $q->where('c.id', $id),
            )
            ->whereIn('s.slug', ['padel', 'tennis'])
            ->where(fn ($q) => $q->whereNull('v.status')->orWhere('v.status', 'published'))
            ->where(fn ($q) => $q->whereNull('c.status')->orWhere('c.status', 'active'))
            ->first([
                'c.id',
                'c.venue_id',
                'v.name as venue_name',
                'v.address as venue_address',
                'c.sport_id',
                's.slug as sport_slug',
                's.name as sport_name',
                'c.name',
                'c.hourly_price_minor',
                'c.currency',
                'c.status',
                'c.photo_url',
                'c.photo_urls',
            ]);

        if ($court === null) {
            throw ApiException::notFound('Court not found');
        }

        return response()->json($this->courtPayload($court));
    }

    public function venueAvailability(Request $request, string $id): JsonResponse
    {
        $query = $this->validateQuery($request, [
            // date_format (not a loose regex) so an impossible calendar date like
            // 2026-13-45 is rejected with a 422 here instead of blowing up later
            // in CarbonImmutable::parse() with an unhandled 500.
            'date' => ['required', 'date_format:Y-m-d'],
            'sport' => ['nullable', 'string', 'max:80'],
        ]);

        // Reject a malformed id up front so it 404s cleanly rather than hitting a
        // Postgres uuid-cast 500 on the lookup below.
        if (! $this->isUuid($id)) {
            throw ApiException::notFound('Venue not found');
        }

        // Match every other public catalog read (venue/venues/court/courts):
        // only PUBLISHED venues are exposed. Without this filter a draft/hidden
        // venue's details + slot availability leak on this public endpoint.
        $venue = DB::table('venues')
            ->where('id', $id)
            ->where(fn ($q) => $q->whereNull('status')->orWhere('status', 'published'))
            ->first();
        if ($venue === null) {
            throw ApiException::notFound('Venue not found');
        }

        $policy = $this->bookingPolicy($venue);
        $window = $this->openingWindowForDate($policy, $query['date']);
        $courts = DB::table('courts as c')
            ->join('sports as s', 's.id', '=', 'c.sport_id')
            ->where('c.venue_id', $id)
            ->whereIn('s.slug', ['padel', 'tennis'])
            ->when(! empty($query['sport']), fn ($q) => $q->where('s.slug', $query['sport']))
            ->where(fn ($q) => $q->whereNull('c.status')->orWhere('c.status', 'active'))
            ->orderByRaw("case when s.slug = 'padel' then 0 when s.slug = 'tennis' then 1 else 2 end")
            ->orderBy('c.name')
            ->get([
                'c.id',
                'c.venue_id',
                'c.sport_id',
                's.slug as sport_slug',
                's.name as sport_name',
                'c.name',
                'c.hourly_price_minor',
                'c.currency',
                'c.status',
                'c.photo_url',
                'c.photo_urls',
            ]);

        if ($window === null) {
            return response()->json([
                'venue' => $this->venuePayload($venue),
                'date' => $query['date'],
                'open_hour' => null,
                'close_hour' => null,
                'slot_minutes' => $policy['slot_minutes'],
                'courts' => $courts->map(fn ($court) => [
                    ...$this->courtPayload($court),
                    'slots' => [],
                    'free_slots_count' => 0,
                    'next_free_slot' => null,
                ]),
            ]);
        }

        [$start, $end] = $window;
        $courtIds = $courts->pluck('id')->all();
        $bookings = DB::table('bookings')
            ->whereIn('court_id', $courtIds)
            ->whereIn('status', ['pending_payment', 'partially_paid', 'paid'])
            ->where('starts_at', '<', $end->utc())
            ->whereRaw("(starts_at + (duration_minutes || ' minutes')::interval) > ?", [$start->utc()])
            ->get()
            ->groupBy('court_id');
        $blocks = DB::table('court_blocks')
            ->whereIn('court_id', $courtIds)
            ->where('starts_at', '<', $end->utc())
            ->where('ends_at', '>', $start->utc())
            ->get()
            ->groupBy('court_id');
        // Active (unexpired) holds occupy a slot too — without this, the public
        // availability view shows a held slot as "free" and the user only finds
        // out it's taken when the booking 409s.
        $holds = DB::table('booking_holds')
            ->whereIn('court_id', $courtIds)
            ->where('expires_at', '>', now())
            ->where('starts_at', '<', $end->utc())
            ->whereRaw("(starts_at + (duration_minutes || ' minutes')::interval) > ?", [$start->utc()])
            ->get()
            ->groupBy('court_id');

        $items = $courts->map(function ($court) use ($bookings, $blocks, $holds, $policy, $start, $end) {
            $slots = [];
            for ($slot = $start; $slot < $end; $slot = $slot->addMinutes($policy['slot_minutes'])) {
                $slotEnd = $slot->addMinutes($policy['slot_minutes']);
                $match = ($bookings->get($court->id) ?? collect())->first(function ($booking) use ($slot, $slotEnd) {
                    $bookingStart = CarbonImmutable::parse($booking->starts_at);
                    $bookingEnd = $bookingStart->addMinutes((int) $booking->duration_minutes);

                    return $bookingStart < $slotEnd && $bookingEnd > $slot;
                });
                $block = ($blocks->get($court->id) ?? collect())->first(function ($blocked) use ($slot, $slotEnd) {
                    $blockedStart = CarbonImmutable::parse($blocked->starts_at);
                    $blockedEnd = CarbonImmutable::parse($blocked->ends_at);

                    return $blockedStart < $slotEnd && $blockedEnd > $slot;
                });
                $hold = ($holds->get($court->id) ?? collect())->first(function ($held) use ($slot, $slotEnd) {
                    $heldStart = CarbonImmutable::parse($held->starts_at);
                    $heldEnd = $heldStart->addMinutes((int) $held->duration_minutes);

                    return $heldStart < $slotEnd && $heldEnd > $slot;
                });
                $slots[] = [
                    'start_at' => $slot->utc()->toIso8601ZuluString('millisecond'),
                    'end_at' => $slotEnd->utc()->toIso8601ZuluString('millisecond'),
                    'status' => $block !== null ? 'blocked' : ($match !== null ? 'booked' : ($hold !== null ? 'held' : 'free')),
                    'booking_id' => $match->id ?? null,
                    'block_id' => $block->id ?? null,
                    'reason' => $block->reason ?? null,
                ];
            }

            $free = collect($slots)->where('status', 'free')->values();

            return [
                ...$this->courtPayload($court),
                'slots' => $slots,
                'free_slots_count' => $free->count(),
                'next_free_slot' => $free->first()['start_at'] ?? null,
            ];
        });

        return response()->json([
            'venue' => $this->venuePayload($venue),
            'date' => $query['date'],
            'open_hour' => (int) $start->format('G'),
            'close_hour' => (int) $end->format('G'),
            'slot_minutes' => $policy['slot_minutes'],
            'min_booking_minutes' => $policy['min_minutes'],
            'max_booking_minutes' => $policy['max_minutes'],
            'cancellation_window_minutes' => $policy['cancellation_window_minutes'],
            'courts' => $items,
        ]);
    }

    public function savedVenues(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $query = $this->validateQuery($request, [
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $items = DB::table('user_saved_venues as sv')
            ->join('venues as v', 'v.id', '=', 'sv.venue_id')
            ->where('sv.user_id', $user->id)
            ->where(fn ($q) => $q->whereNull('v.status')->orWhere('v.status', 'published'))
            ->orderByDesc('sv.created_at')
            ->limit((int) ($query['limit'] ?? 50))
            ->get([
                'v.id',
                'v.name',
                'v.address',
                'v.lat',
                'v.lng',
                'v.is_partner',
                'v.phone',
                'v.description',
                'v.description_i18n',
                'v.logo_url',
                'v.photo_url',
                'v.photo_urls',
                'v.rating_avg',
                'v.rating_count',
                'sv.created_at as saved_at',
            ])
            ->map(function ($venue) {
                return [
                    ...$this->venuePayload($venue),
                    'is_saved' => true,
                    'saved_at' => $this->iso($venue->saved_at),
                ];
            })
            ->values();

        return response()->json(['items' => $items]);
    }

    public function saveVenue(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        if (! $this->isUuid($id)) {
            throw ApiException::notFound('Venue not found');
        }
        // Only published venues are publicly visible; saving must honour the same
        // scope so a draft/suspended venue's details can't be probed/leaked here.
        $venue = DB::table('venues')
            ->where('id', $id)
            ->where(fn ($q) => $q->whereNull('status')->orWhere('status', 'published'))
            ->first();
        if (! $venue) {
            throw ApiException::notFound('Venue not found');
        }

        DB::table('user_saved_venues')->updateOrInsert([
            'user_id' => $user->id,
            'venue_id' => $id,
        ], ['created_at' => now()]);

        return response()->json([
            ...$this->venuePayload($venue),
            'is_saved' => true,
            'saved_at' => $this->iso(now()),
        ], 201);
    }

    public function unsaveVenue(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        // Idempotent unsave: a non-uuid id can never match a stored row, and on
        // Postgres the delete would 500 on the uuid cast — short-circuit to ok.
        if (! $this->isUuid($id)) {
            return response()->json(['ok' => true]);
        }
        DB::table('user_saved_venues')
            ->where('user_id', $user->id)
            ->where('venue_id', $id)
            ->delete();

        return response()->json(['ok' => true]);
    }

    public function savedCourts(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $query = $this->validateQuery($request, [
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $items = DB::table('user_saved_courts as sc')
            ->join('courts as c', 'c.id', '=', 'sc.court_id')
            ->join('venues as v', 'v.id', '=', 'c.venue_id')
            ->join('sports as s', 's.id', '=', 'c.sport_id')
            ->where('sc.user_id', $user->id)
            ->whereIn('s.slug', ['padel', 'tennis'])
            ->where(fn ($q) => $q->whereNull('v.status')->orWhere('v.status', 'published'))
            ->orderByDesc('sc.created_at')
            ->limit((int) ($query['limit'] ?? 50))
            ->get([
                'c.id',
                'c.venue_id',
                'v.name as venue_name',
                'v.address as venue_address',
                'c.sport_id',
                's.slug as sport_slug',
                's.name as sport_name',
                'c.name',
                'c.hourly_price_minor',
                'c.currency',
                'c.status',
                'c.photo_url',
                'c.photo_urls',
                'sc.created_at as saved_at',
            ])
            ->map(function ($court) {
                return [
                    ...$this->courtPayload($court),
                    'is_saved' => true,
                    'saved_at' => $this->iso($court->saved_at),
                ];
            })
            ->values();

        return response()->json(['items' => $items]);
    }

    public function saveCourt(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        if (! $this->isUuid($id)) {
            throw ApiException::notFound('Court not found');
        }
        // Mirror the public court() read scope (published venue + active court) so
        // a court that isn't publicly visible can't be probed/leaked via save.
        $court = DB::table('courts as c')
            ->join('venues as v', 'v.id', '=', 'c.venue_id')
            ->join('sports as s', 's.id', '=', 'c.sport_id')
            ->where('c.id', $id)
            ->whereIn('s.slug', ['padel', 'tennis'])
            ->where(fn ($q) => $q->whereNull('v.status')->orWhere('v.status', 'published'))
            ->where(fn ($q) => $q->whereNull('c.status')->orWhere('c.status', 'active'))
            ->first([
                'c.id',
                'c.venue_id',
                'v.name as venue_name',
                'v.address as venue_address',
                'c.sport_id',
                's.slug as sport_slug',
                's.name as sport_name',
                'c.name',
                'c.hourly_price_minor',
                'c.currency',
                'c.status',
                'c.photo_url',
                'c.photo_urls',
            ]);
        if (! $court) {
            throw ApiException::notFound('Court not found');
        }

        DB::table('user_saved_courts')->updateOrInsert([
            'user_id' => $user->id,
            'court_id' => $id,
        ], ['created_at' => now()]);

        return response()->json([
            ...$this->courtPayload($court),
            'is_saved' => true,
            'saved_at' => $this->iso(now()),
        ], 201);
    }

    public function unsaveCourt(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        // Idempotent unsave (see unsaveVenue): non-uuid can't match a stored row
        // and would 500 on the Postgres uuid cast — short-circuit to ok.
        if (! $this->isUuid($id)) {
            return response()->json(['ok' => true]);
        }
        DB::table('user_saved_courts')
            ->where('user_id', $user->id)
            ->where('court_id', $id)
            ->delete();

        return response()->json(['ok' => true]);
    }

    /**
     * Canonical UUID shape check. Used to reject malformed path ids before they
     * reach a Postgres uuid column (which would raise a 22P02 cast 500) and to
     * keep idempotent unsave deletes from erroring on garbage input.
     */
    private function isUuid(string $id): bool
    {
        return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $id) === 1;
    }

    private function venuePayload(object $r): array
    {
        return [
            'id' => $r->id,
            'name' => $r->name,
            'address' => $r->address,
            'lat' => (float) $r->lat,
            'lng' => (float) $r->lng,
            'is_partner' => (bool) $r->is_partner,
            'phone' => $r->phone ?? null,
            'description' => $r->description ?? null,
            // Localized descriptions {az,en,ru} (jsonb). Decoded to an object so the
            // web/app can show the venue blurb in the active language; falls back to
            // the plain `description` when a locale is missing.
            'description_i18n' => isset($r->description_i18n) && is_string($r->description_i18n)
                ? json_decode($r->description_i18n, true)
                : ($r->description_i18n ?? null),
            'logo_url' => $r->logo_url ?? null,
            'photo_url' => $r->photo_url ?? null,
            'photo_urls' => $this->pgArray($r->photo_urls ?? null),
            'rating_avg' => $r->rating_avg !== null ? (float) $r->rating_avg : null,
            'rating_count' => (int) ($r->rating_count ?? 0),
            'distance_km' => isset($r->distance_m) && $r->distance_m !== null ? round(((float) $r->distance_m) / 1000, 2) : null,
            // Court aggregates — present on the venue list (joined from a grouped
            // subquery, no N+1). Absent on single-venue / saved-venue payloads,
            // where they default to null so the shape stays stable.
            'courts_count' => isset($r->courts_count) && $r->courts_count !== null ? (int) $r->courts_count : null,
            'from_price_minor' => isset($r->from_price_minor) && $r->from_price_minor !== null ? (int) $r->from_price_minor : null,
        ];
    }

    /**
     * Grouped subquery: per-venue bookable-court count and cheapest hourly price
     * (the "from" price). Scoped to padel/tennis active courts so the aggregate
     * matches what the courts() list and booking flow actually expose. Joined as
     * a single derived table to keep the venue list free of N+1 per-venue queries.
     */
    private function venueCourtAggregates()
    {
        return DB::table('courts as c')
            ->join('sports as s', 's.id', '=', 'c.sport_id')
            ->whereIn('s.slug', ['padel', 'tennis'])
            ->where(fn ($q) => $q->whereNull('c.status')->orWhere('c.status', 'active'))
            ->groupBy('c.venue_id')
            ->selectRaw('c.venue_id, count(*) as courts_count, min(c.hourly_price_minor) as from_price_minor');
    }

    private function courtPayload(object $court): array
    {
        return [
            'id' => $court->id,
            'venue_id' => $court->venue_id,
            'venue_name' => $court->venue_name ?? null,
            'venue_address' => $court->venue_address ?? null,
            'sport_id' => $court->sport_id,
            'sport_slug' => $court->sport_slug,
            'sport_name' => $court->sport_name,
            'name' => $court->name,
            'hourly_price_minor' => (int) $court->hourly_price_minor,
            'currency' => $court->currency,
            'status' => $court->status ?? 'active',
            'photo_url' => $court->photo_url ?? null,
            'photo_urls' => $this->pgArray($court->photo_urls ?? null),
        ];
    }

    private function bookingPolicy(object $venue): array
    {
        return [
            'opening_hours' => json_decode((string) ($venue->opening_hours ?? ''), true) ?: [],
            'slot_minutes' => max(15, (int) ($venue->booking_slot_minutes ?? 30)),
            'min_minutes' => max(15, (int) ($venue->min_booking_minutes ?? 60)),
            'max_minutes' => max(15, (int) ($venue->max_booking_minutes ?? 120)),
            'cancellation_window_minutes' => max(0, (int) ($venue->cancellation_window_minutes ?? 120)),
        ];
    }

    private function openingWindowForDate(array $policy, string $date): ?array
    {
        $day = (string) CarbonImmutable::parse($date, 'Asia/Baku')->dayOfWeekIso;
        $hours = $policy['opening_hours'][$day] ?? $policy['opening_hours'][strtolower(CarbonImmutable::parse($date)->englishDayOfWeek)] ?? null;
        if (is_array($hours) && ($hours['closed'] ?? false)) {
            return null;
        }
        $open = is_array($hours) ? ($hours['open'] ?? '07:00') : '07:00';
        $close = is_array($hours) ? ($hours['close'] ?? '23:00') : '23:00';

        return [
            CarbonImmutable::parse($date.' '.$open, 'Asia/Baku'),
            CarbonImmutable::parse($date.' '.$close, 'Asia/Baku'),
        ];
    }

    private function pgArray(mixed $value): array
    {
        if ($value === null || $value === '{}') {
            return [];
        }
        if (is_array($value)) {
            return array_values($value);
        }

        $value = trim((string) $value);
        if ($value === '') {
            return [];
        }
        $json = json_decode($value, true);
        if (is_array($json)) {
            return array_values($json);
        }
        if ($value[0] === '{' && substr($value, -1) === '}') {
            $value = substr($value, 1, -1);
        }
        if ($value === '') {
            return [];
        }

        return str_getcsv($value, ',', '"', '\\');
    }
}
