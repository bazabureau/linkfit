<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\AuthorizesAdminPermissions;
use App\Support\ApiException;
use App\Services\Mail\TransactionalMailService;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Response;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class BookingsController extends ApiController
{
    use AuthorizesAdminPermissions;

    public function availability(Request $request, string $id): JsonResponse
    {
        $query = $this->validateQuery($request, [
            'date' => ['required', 'regex:/^\d{4}-\d{2}-\d{2}$/'],
        ]);

        $court = $this->bookableCourtById($id);
        if ($court === null) {
            throw ApiException::notFound('Court not found');
        }

        $policy = $this->bookingPolicy($court);
        $hours = $this->openingWindowForDate($policy, $query['date']);
        if ($hours === null) {
            return response()->json([
                'court_id' => $id,
                'date' => $query['date'],
                'open_hour' => 0,
                'close_hour' => 0,
                'slot_minutes' => $policy['slot_minutes'],
                'slots' => [],
            ]);
        }
        [$start, $end] = $hours;

        $bookings = DB::table('bookings')
            ->where('court_id', $id)
            ->whereIn('status', ['pending_payment', 'partially_paid', 'paid'])
            ->where('starts_at', '<', $end->utc())
            ->whereRaw("(starts_at + (duration_minutes || ' minutes')::interval) > ?", [$start->utc()])
            ->get();
        $blocks = DB::table('court_blocks')
            ->where('court_id', $id)
            ->where('starts_at', '<', $end->utc())
            ->where('ends_at', '>', $start->utc())
            ->get();
        $holds = $this->activeHoldsQuery()
            ->where('court_id', $id)
            ->where('starts_at', '<', $end->utc())
            ->whereRaw("(starts_at + (duration_minutes || ' minutes')::interval) > ?", [$start->utc()])
            ->get();

        $slots = [];
        for ($slot = $start; $slot < $end; $slot = $slot->addMinutes($policy['slot_minutes'])) {
            $slotEnd = $slot->addMinutes($policy['slot_minutes']);
            $match = $bookings->first(function ($b) use ($slot, $slotEnd) {
                $bStart = CarbonImmutable::parse($b->starts_at);
                $bEnd = $bStart->addMinutes((int) $b->duration_minutes);

                return $bStart < $slotEnd && $bEnd > $slot;
            });
            $block = $blocks->first(function ($b) use ($slot, $slotEnd) {
                $bStart = CarbonImmutable::parse($b->starts_at);
                $bEnd = CarbonImmutable::parse($b->ends_at);

                return $bStart < $slotEnd && $bEnd > $slot;
            });
            $hold = $holds->first(function ($h) use ($slot, $slotEnd) {
                $hStart = CarbonImmutable::parse($h->starts_at);
                $hEnd = $hStart->addMinutes((int) $h->duration_minutes);

                return $hStart < $slotEnd && $hEnd > $slot;
            });
            $local = $slot->setTimezone('Asia/Baku');
            $startIso = $slot->utc()->toIso8601ZuluString('millisecond');
            $endIso = $slotEnd->utc()->toIso8601ZuluString('millisecond');
            $status = $block !== null ? 'blocked' : ($match !== null ? 'booked' : ($hold === null ? 'free' : 'held'));
            $slots[] = [
                'start_time' => $startIso,
                'end_time' => $endIso,
                'minutes_from_midnight' => (int) ($local->hour * 60 + $local->minute),
                'start_at' => $startIso,
                'end_at' => $endIso,
                // `starts_at`/`ends_at` aliases so the mobile slot decoder (which
                // reads the plural form, matching every other time field) works.
                'starts_at' => $startIso,
                'ends_at' => $endIso,
                'status' => $status,
                'booked' => in_array($status, ['booked', 'blocked', 'held'], true),
                'booking_id' => $match->id ?? null,
                'block_id' => $block->id ?? null,
                'hold_id' => $hold->id ?? null,
                'hold_expires_at' => $this->iso($hold->expires_at ?? null),
                'reason' => $block->reason ?? null,
            ];
        }

        return response()->json([
            'court_id' => $id,
            'date' => $query['date'],
            'open_hour' => (int) $start->format('G'),
            'close_hour' => (int) $end->format('G'),
            'slot_minutes' => $policy['slot_minutes'],
            'min_booking_minutes' => $policy['min_minutes'],
            'max_booking_minutes' => $policy['max_minutes'],
            'cancellation_window_minutes' => $policy['cancellation_window_minutes'],
            'slots' => $slots,
        ]);
    }

    public function suggestedSlots(Request $request, string $id): JsonResponse
    {
        $query = $this->validateQuery($request, [
            'starts_at' => ['required', 'date'],
            'duration_minutes' => ['required', 'integer', 'min:15', 'max:480'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:50'],
            'days_ahead' => ['nullable', 'integer', 'min:1', 'max:30'],
        ]);

        $court = $this->bookableCourtById($id);
        if ($court === null) {
            throw ApiException::notFound('Court not found');
        }

        $requested = CarbonImmutable::parse($query['starts_at']);
        $duration = (int) $query['duration_minutes'];
        $this->assertBookingRules($court, $requested, $duration);

        $limit = (int) ($query['limit'] ?? 12);
        $daysAhead = (int) ($query['days_ahead'] ?? 7);
        $policy = $this->bookingPolicy($court);
        $items = [];
        $cursorDate = $requested->setTimezone('Asia/Baku')->format('Y-m-d');

        for ($dayOffset = 0; $dayOffset < $daysAhead && count($items) < $limit; $dayOffset++) {
            $date = CarbonImmutable::parse($cursorDate, 'Asia/Baku')->addDays($dayOffset)->format('Y-m-d');
            $window = $this->openingWindowForDate($policy, $date);
            if ($window === null) {
                continue;
            }
            [$open, $close] = $window;
            for ($slot = $open; $slot->addMinutes($duration) <= $close && count($items) < $limit; $slot = $slot->addMinutes($policy['slot_minutes'])) {
                if ($slot < now('Asia/Baku') || $slot < $requested->setTimezone('Asia/Baku')) {
                    continue;
                }
                $slotUtc = $slot->utc();
                $slotEndUtc = $slot->addMinutes($duration)->utc();
                try {
                    $this->assertCourtAvailable($id, $slotUtc, $slotEndUtc);
                } catch (ApiException) {
                    continue;
                }

                $items[] = [
                    'court_id' => $id,
                    'venue_id' => $court->venue_id,
                    'venue_name' => $court->venue_name,
                    'starts_at' => $slotUtc->toIso8601ZuluString('millisecond'),
                    'ends_at' => $slotEndUtc->toIso8601ZuluString('millisecond'),
                    'duration_minutes' => $duration,
                    'total_minor' => $this->bookingTotalMinor($court, $duration),
                    'currency' => $court->currency,
                ];
            }
        }

        return response()->json([
            'court_id' => $id,
            'requested_starts_at' => $requested->utc()->toIso8601ZuluString('millisecond'),
            'duration_minutes' => $duration,
            'items' => $items,
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        // Freemium gate: free users have a monthly booking cap (premium = unlimited).
        app(\App\Services\Membership\MembershipService::class)->ensureCanBook($user->id);
        $data = $this->validateBody($request, [
            'court_id' => ['required', 'uuid'],
            'starts_at' => ['required', 'date'],
            'duration_minutes' => ['required', 'integer', 'min:15', 'max:480'],
            'idempotency_key' => ['sometimes', 'nullable', 'string', 'min:8', 'max:200'],
            'game_id' => ['sometimes', 'nullable', 'uuid'],
            'payment_method' => ['sometimes', 'nullable', 'in:cash,bank_transfer,manual,onsite'],
            'source' => ['sometimes', 'in:app,web'],
            'hold_id' => ['sometimes', 'nullable', 'uuid'],
            'promo_code' => ['sometimes', 'nullable', 'string', 'max:64'],
        ]);
        // Accept the idempotency key from the Idempotency-Key header too — the
        // mobile client sends it as a header, not a body field.
        $data['idempotency_key'] = $this->resolveIdempotencyKey($request, $data['idempotency_key'] ?? null);

        $court = $this->bookableCourtById((string) $data['court_id']);
        if ($court === null) {
            throw ApiException::validation('Unknown court_id');
        }

        $existing = DB::table('bookings')
            ->where('user_id', $user->id)
            ->where('idempotency_key', $data['idempotency_key'])
            ->first();
        if ($existing !== null) {
            return $this->show($request, $existing->id);
        }

        $starts = CarbonImmutable::parse($data['starts_at']);
        $ends = $starts->addMinutes((int) $data['duration_minutes']);
        $this->assertBookingRules($court, $starts, (int) $data['duration_minutes']);
        $holdId = $data['hold_id'] ?? null;
        if ($holdId !== null) {
            $this->assertHoldMatches((string) $holdId, (string) $user->id, (string) $data['court_id'], $starts, (int) $data['duration_minutes']);
        }
        $this->assertCourtAvailable((string) $data['court_id'], $starts, $ends, null, $holdId);
        $subtotal = $this->bookingTotalMinor($court, (int) $data['duration_minutes']);
        $promo = $this->promoDiscount($data['promo_code'] ?? null, (string) $user->id, $subtotal, (string) $court->currency);

        $id = (string) Str::uuid();
        try {
            // Booking insert + hold release + promo redemption commit atomically:
            // a crash mid-way must not leave a booking with its promo redemption
            // un-recorded (which would under-count per_user_limit / max_redemptions).
            DB::transaction(function () use ($id, $data, $user, $court, $starts, $subtotal, $promo, $holdId) {
                DB::table('bookings')->insert([
                    'id' => $id,
                    'game_id' => $data['game_id'] ?? null,
                    'court_id' => $data['court_id'],
                    'user_id' => $user->id,
                    'starts_at' => $starts,
                    'duration_minutes' => $data['duration_minutes'],
                    'subtotal_minor' => $subtotal,
                    'discount_minor' => $promo['discount_minor'],
                    'promo_code_id' => $promo['promo_id'],
                    'total_minor' => max(0, $subtotal - $promo['discount_minor']),
                    'currency' => $court->currency,
                    'status' => 'pending_payment',
                    'source' => $data['source'] ?? 'app',
                    'payment_method' => $data['payment_method'] ?? 'onsite',
                    'created_by_user_id' => $user->id,
                    'idempotency_key' => $data['idempotency_key'],
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
                if ($holdId !== null) {
                    DB::table('booking_holds')->where('id', $holdId)->delete();
                }
                if ($promo['promo_id'] !== null && $promo['discount_minor'] > 0) {
                    DB::table('booking_promo_redemptions')->insert([
                        'id' => (string) Str::uuid(),
                        'promo_code_id' => $promo['promo_id'],
                        'booking_id' => $id,
                        'user_id' => $user->id,
                        'discount_minor' => $promo['discount_minor'],
                        'created_at' => now(),
                    ]);
                }
            });
        } catch (\Illuminate\Database\QueryException $e) {
            // 23P01 = GiST slot-overlap EXCLUDE (race), 23505 = idempotency_key unique.
            $sqlState = (string) ($e->errorInfo[0] ?? '');
            if ($sqlState === '23P01') {
                throw ApiException::conflict('Court is already booked for this time');
            }
            if ($sqlState === '23505') {
                // Idempotent replay — return the booking already created for this key.
                $prior = DB::table('bookings')->where('idempotency_key', $data['idempotency_key'])->first();
                if ($prior !== null) {
                    return response()->json($this->bookingPayload($prior), 200);
                }
                throw ApiException::conflict('Duplicate booking request');
            }
            throw $e;
        }
        $this->notifyBookingCreated($id, (string) $court->venue_id, (string) $user->id);

        return $this->show($request, $id, 201);
    }

    public function holds(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $query = $this->validateQuery($request, [
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
            'include_expired' => ['nullable', 'boolean'],
        ]);
        $this->cleanupExpiredHolds();

        $base = DB::table('booking_holds as h')
            ->join('courts as c', 'c.id', '=', 'h.court_id')
            ->join('venues as v', 'v.id', '=', 'c.venue_id')
            ->where('h.user_id', $user->id);
        if (! ($query['include_expired'] ?? false)) {
            $base->where('h.expires_at', '>', now());
        }

        $items = $base
            ->orderBy('h.expires_at')
            ->limit((int) ($query['limit'] ?? 30))
            ->get(['h.*', 'c.name as court_name', 'v.id as venue_id', 'v.name as venue_name'])
            ->map(fn ($hold) => $this->holdPayload($hold))
            ->values();

        return response()->json(['items' => $items]);
    }

    public function createHold(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $data = $this->validateBody($request, [
            'court_id' => ['required', 'uuid'],
            'starts_at' => ['required', 'date'],
            'duration_minutes' => ['required', 'integer', 'min:15', 'max:480'],
            'idempotency_key' => ['sometimes', 'nullable', 'string', 'min:8', 'max:200'],
            'source' => ['sometimes', 'in:app,web'],
            'ttl_seconds' => ['sometimes', 'integer', 'min:60', 'max:900'],
        ]);
        // Header fallback (mobile sends Idempotency-Key as a header); generate one
        // if absent so a hold request never 400s on a missing key.
        $data['idempotency_key'] = $this->resolveIdempotencyKey($request, $data['idempotency_key'] ?? null, true);
        $this->cleanupExpiredHolds();

        $existing = DB::table('booking_holds')
            ->where('user_id', $user->id)
            ->where('idempotency_key', $data['idempotency_key'])
            ->first();
        if ($existing !== null && CarbonImmutable::parse($existing->expires_at)->isFuture()) {
            return response()->json($this->holdPayload($existing));
        }

        $court = $this->bookableCourtById((string) $data['court_id']);
        if ($court === null) {
            throw ApiException::validation('Unknown court_id');
        }

        $starts = CarbonImmutable::parse($data['starts_at']);
        $ends = $starts->addMinutes((int) $data['duration_minutes']);
        $this->assertBookingRules($court, $starts, (int) $data['duration_minutes']);
        $this->assertCourtAvailable((string) $data['court_id'], $starts, $ends);

        $id = (string) Str::uuid();
        $expiresAt = now()->addSeconds((int) ($data['ttl_seconds'] ?? 300));
        DB::table('booking_holds')->updateOrInsert(
            ['user_id' => $user->id, 'idempotency_key' => $data['idempotency_key']],
            [
                'id' => $id,
                'court_id' => $data['court_id'],
                'starts_at' => $starts,
                'duration_minutes' => (int) $data['duration_minutes'],
                'expires_at' => $expiresAt,
                'source' => $data['source'] ?? 'app',
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );

        $hold = DB::table('booking_holds as h')
            ->join('courts as c', 'c.id', '=', 'h.court_id')
            ->join('venues as v', 'v.id', '=', 'c.venue_id')
            ->where('h.id', $id)
            ->first(['h.*', 'c.name as court_name', 'v.id as venue_id', 'v.name as venue_name']);

        return response()->json($this->holdPayload($hold), 201);
    }

    public function releaseHold(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        $deleted = DB::table('booking_holds')
            ->where('id', $id)
            ->where('user_id', $user->id)
            ->delete();
        if ($deleted < 1) {
            throw ApiException::notFound('Booking hold not found');
        }

        return response()->json(['id' => $id, 'released' => true]);
    }

    public function adminHolds(Request $request): JsonResponse
    {
        $this->requireAdminPermission($request, 'bookings');

        return $this->holdsForOperator($request);
    }

    public function partnerHolds(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $venueId = $this->requirePartnerBookingPermission($user);

        return $this->holdsForOperator($request, $venueId);
    }

    public function quote(Request $request): JsonResponse
    {
        $data = $this->validateBody($request, [
            'court_id' => ['required', 'uuid'],
            'starts_at' => ['required', 'date'],
            'duration_minutes' => ['required', 'integer', 'min:15', 'max:480'],
            'hold_id' => ['sometimes', 'nullable', 'uuid'],
            'promo_code' => ['sometimes', 'nullable', 'string', 'max:64'],
        ]);
        $court = $this->bookableCourtById((string) $data['court_id']);
        if ($court === null) {
            throw ApiException::validation('Unknown court_id');
        }

        $starts = CarbonImmutable::parse($data['starts_at']);
        $ends = $starts->addMinutes((int) $data['duration_minutes']);
        $this->assertBookingRules($court, $starts, (int) $data['duration_minutes']);
        $holdId = $data['hold_id'] ?? null;
        if ($holdId !== null) {
            $this->assertHoldMatches((string) $holdId, null, (string) $data['court_id'], $starts, (int) $data['duration_minutes']);
        }
        $this->assertCourtAvailable((string) $data['court_id'], $starts, $ends, null, $holdId);
        $subtotal = $this->bookingTotalMinor($court, (int) $data['duration_minutes']);
        $promo = $this->promoDiscount($data['promo_code'] ?? null, null, $subtotal, (string) $court->currency);
        $total = max(0, $subtotal - $promo['discount_minor']);

        return response()->json([
            'court_id' => $data['court_id'],
            'venue_id' => $court->venue_id,
            'venue_name' => $court->venue_name,
            'starts_at' => $starts->toIso8601ZuluString('millisecond'),
            'ends_at' => $ends->toIso8601ZuluString('millisecond'),
            'duration_minutes' => (int) $data['duration_minutes'],
            'hourly_price_minor' => (int) $court->hourly_price_minor,
            'subtotal_minor' => $subtotal,
            'discount_minor' => $promo['discount_minor'],
            'total_minor' => $total,
            'currency' => $court->currency,
            'available' => true,
            'payment_methods' => ['onsite', 'cash', 'bank_transfer'],
            'promo' => $promo['promo'],
        ]);
    }

    public function mine(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $query = $this->validateQuery($request, [
            'sport' => ['nullable', 'in:padel,tennis'],
        ]);
        $rows = $this->bookingsQuery($user->id, $query)->orderByDesc('b.starts_at')->get(['b.*']);
        $items = $rows->map(fn ($r) => $this->bookingPayload($r));
        $now = now();

        return response()->json([
            'upcoming' => $items->filter(fn ($b) => $b['starts_at'] >= $now->toIso8601ZuluString('millisecond'))->values(),
            'past' => $items->filter(fn ($b) => $b['starts_at'] < $now->toIso8601ZuluString('millisecond'))->values(),
        ]);
    }

    public function index(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $query = $this->validateQuery($request, [
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
            'offset' => ['nullable', 'integer', 'min:0'],
            'status' => ['nullable', 'in:pending_payment,partially_paid,paid,cancelled,refunded,failed'],
            'timeframe' => ['nullable', 'in:all,upcoming,past'],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
            'venue_id' => ['nullable', 'uuid'],
            'sport' => ['nullable', 'in:padel,tennis'],
        ]);

        $base = $this->bookingsQuery($user->id, $query);
        $total = (clone $base)->count('b.id');
        $limit = (int) ($query['limit'] ?? 30);
        $offset = (int) ($query['offset'] ?? 0);
        $rows = $base
            ->orderByDesc('b.starts_at')
            ->offset($offset)
            ->limit($limit)
            ->get(['b.*'])
            ->map(fn ($booking) => $this->bookingPayload($booking))
            ->values();

        return response()->json([
            'items' => $rows,
            'pagination' => [
                'limit' => $limit,
                'offset' => $offset,
                'total' => $total,
            ],
            'summary' => [
                'upcoming' => DB::table('bookings')->where('user_id', $user->id)->where('starts_at', '>=', now())->whereNotIn('status', ['cancelled', 'refunded', 'failed'])->count(),
                'past' => DB::table('bookings')->where('user_id', $user->id)->where('starts_at', '<', now())->count(),
                'cancelled' => DB::table('bookings')->where('user_id', $user->id)->where('status', 'cancelled')->count(),
            ],
        ]);
    }

    public function exportMine(Request $request)
    {
        $user = $this->authUser($request);
        $query = $this->validateQuery($request, [
            'status' => ['nullable', 'in:pending_payment,partially_paid,paid,cancelled,refunded,failed'],
            'timeframe' => ['nullable', 'in:all,upcoming,past'],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
            'venue_id' => ['nullable', 'uuid'],
            'sport' => ['nullable', 'in:padel,tennis'],
        ]);

        $rows = $this->bookingsQuery($user->id, $query)
            ->orderByDesc('b.starts_at')
            ->limit(1000)
            ->get([
                'b.id',
                'b.starts_at',
                'b.duration_minutes',
                'b.total_minor',
                'b.currency',
                'b.status',
                'b.payment_method',
                'c.name as court_name',
                'v.name as venue_name',
                's.slug as sport_slug',
            ]);

        return Response::streamDownload(function () use ($rows) {
            $out = fopen('php://output', 'w');
            fputcsv($out, ['id', 'venue', 'court', 'sport', 'starts_at', 'duration_minutes', 'amount', 'currency', 'status', 'payment_method']);
            foreach ($rows as $row) {
                fputcsv($out, [
                    $row->id,
                    $row->venue_name,
                    $row->court_name,
                    $row->sport_slug,
                    $this->iso($row->starts_at),
                    (int) $row->duration_minutes,
                    number_format(((int) $row->total_minor) / 100, 2, '.', ''),
                    $row->currency,
                    $row->status,
                    $row->payment_method,
                ]);
            }
            fclose($out);
        }, 'linkfit-bookings.csv', ['Content-Type' => 'text/csv; charset=UTF-8']);
    }

    public function show(Request $request, string $id, int $status = 200): JsonResponse
    {
        $booking = DB::table('bookings')->where('id', $id)->first();
        if ($booking === null) {
            throw ApiException::notFound('Booking not found');
        }
        $user = $this->authUser($request);
        if ($booking->user_id !== $user->id && ! $this->canManageBooking($user, $booking)) {
            throw ApiException::forbidden('Forbidden');
        }

        return response()->json($this->bookingPayload($booking), $status);
    }

    public function receipt(Request $request, string $id): JsonResponse
    {
        $booking = DB::table('bookings')->where('id', $id)->first();
        if ($booking === null) {
            throw ApiException::notFound('Booking not found');
        }
        $user = $this->authUser($request);
        if ($booking->user_id !== $user->id && ! $this->canManageBooking($user, $booking)) {
            throw ApiException::forbidden('Forbidden');
        }

        $court = DB::table('courts as c')
            ->join('venues as v', 'v.id', '=', 'c.venue_id')
            ->join('sports as s', 's.id', '=', 'c.sport_id')
            ->where('c.id', $booking->court_id)
            ->first([
                'c.id as court_id',
                'c.name as court_name',
                'v.id as venue_id',
                'v.name as venue_name',
                'v.address as venue_address',
                'v.phone as venue_phone',
                's.slug as sport_slug',
                's.name as sport_name',
            ]);
        $starts = CarbonImmutable::parse($booking->starts_at);

        return response()->json([
            'receipt_number' => 'LF-'.strtoupper(substr((string) $booking->id, 0, 8)),
            'booking' => $this->bookingPayload($booking),
            'customer' => [
                'id' => $booking->user_id,
                'name' => $booking->customer_name ?: $user->display_name,
                'email' => $booking->customer_email ?: $user->email,
            ],
            'venue' => [
                'id' => $court->venue_id ?? null,
                'name' => $court->venue_name ?? null,
                'address' => $court->venue_address ?? null,
                'phone' => $court->venue_phone ?? null,
            ],
            'court' => [
                'id' => $court->court_id ?? $booking->court_id,
                'name' => $court->court_name ?? null,
                'sport_slug' => $court->sport_slug ?? null,
                'sport_name' => $court->sport_name ?? null,
            ],
            'line_items' => [[
                'description' => 'Court booking',
                'starts_at' => $starts->toIso8601ZuluString('millisecond'),
                'ends_at' => $starts->addMinutes((int) $booking->duration_minutes)->toIso8601ZuluString('millisecond'),
                'duration_minutes' => (int) $booking->duration_minutes,
                'amount_minor' => (int) ($booking->subtotal_minor ?? $booking->total_minor),
                'currency' => $booking->currency,
            ]],
            'totals' => [
                'subtotal_minor' => (int) ($booking->subtotal_minor ?? $booking->total_minor),
                'discount_minor' => (int) ($booking->discount_minor ?? 0),
                'tax_minor' => 0,
                'total_minor' => (int) $booking->total_minor,
                'currency' => $booking->currency,
            ],
            'payment' => [
                'status' => $booking->status,
                'method' => $booking->payment_method ?? null,
                'paid_at' => $this->iso($booking->paid_at),
                'external_ref' => $booking->external_ref,
                'refund_status' => $booking->refund_status ?? null,
                'refund_amount_minor' => $booking->refund_amount_minor ?? null,
                'refund_note' => $booking->refund_note ?? null,
                'refunded_at' => $this->iso($booking->refunded_at ?? null),
            ],
            'issued_at' => $this->iso(now()),
        ]);
    }

    public function cancel(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        $data = $this->validateBody($request, [
            'reason' => ['sometimes', 'nullable', 'string', 'max:1000'],
        ]);
        $booking = DB::table('bookings')->where('id', $id)->first();
        if ($booking === null) {
            throw ApiException::notFound('Booking not found');
        }
        if ($booking->user_id !== $user->id) {
            throw ApiException::forbidden('Forbidden');
        }
        $court = DB::table('courts as c')->join('venues as v', 'v.id', '=', 'c.venue_id')->where('c.id', $booking->court_id)->first(['v.cancellation_window_minutes']);
        $window = max(0, (int) ($court->cancellation_window_minutes ?? 120));
        if (CarbonImmutable::parse($booking->starts_at)->subMinutes($window)->isPast()) {
            throw ApiException::conflict('Cancellation window has passed');
        }

        DB::table('bookings')->where('id', $id)->update([
            'status' => 'cancelled',
            'cancelled_at' => now(),
            'cancelled_by_user_id' => $user->id,
            'cancellation_reason' => $data['reason'] ?? null,
            'refund_status' => in_array($booking->status, ['paid', 'partially_paid'], true) ? 'pending_manual_review' : null,
            'updated_at' => now(),
        ]);
        $this->notifyBookingCancelled($booking);

        return $this->show($request, $id);
    }

    public function markPaid(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        $booking = DB::table('bookings')->where('id', $id)->first();
        if ($booking === null) {
            throw ApiException::notFound('Booking not found');
        }
        if (! $this->canManageBooking($user, $booking)) {
            throw ApiException::forbidden('Only admins or partners can mark bookings paid');
        }

        DB::table('bookings')->where('id', $id)->update([
            'status' => 'paid',
            'paid_at' => now(),
            'payment_method' => $request->input('payment_method', $booking->payment_method ?? 'manual'),
            'payment_note' => $request->input('payment_note', $booking->payment_note ?? null),
            'updated_at' => now(),
        ]);

        return $this->show($request, $id);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        $booking = DB::table('bookings')->where('id', $id)->first();
        if ($booking === null) {
            throw ApiException::notFound('Booking not found');
        }
        if ($booking->user_id !== $user->id) {
            throw ApiException::forbidden('Forbidden');
        }
        if (in_array($booking->status, ['cancelled', 'refunded', 'failed'], true)) {
            throw ApiException::conflict('Booking cannot be updated');
        }
        $data = $this->validateBody($request, [
            'starts_at' => ['sometimes', 'date'],
            'duration_minutes' => ['sometimes', 'integer', 'min:15', 'max:480'],
            'payment_method' => ['sometimes', 'nullable', 'in:cash,bank_transfer,manual,onsite'],
        ]);
        if ($data === []) {
            throw ApiException::validation('Provide at least one field to update');
        }

        $starts = array_key_exists('starts_at', $data) ? CarbonImmutable::parse($data['starts_at']) : CarbonImmutable::parse($booking->starts_at);
        $duration = (int) ($data['duration_minutes'] ?? $booking->duration_minutes);
        $updates = [];
        if (array_key_exists('starts_at', $data) || array_key_exists('duration_minutes', $data)) {
            $court = $this->bookableCourtById((string) $booking->court_id);
            if ($court === null) {
                throw ApiException::conflict('Court is not available for rescheduling');
            }
            $window = max(0, (int) ($court->cancellation_window_minutes ?? 120));
            if (CarbonImmutable::parse($booking->starts_at)->subMinutes($window)->isPast()) {
                throw ApiException::conflict('Reschedule window has passed');
            }
            $this->assertBookingRules($court, $starts, $duration);
            $this->assertCourtAvailable((string) $booking->court_id, $starts, $starts->addMinutes($duration), $id);
            $updates['starts_at'] = $starts;
            $updates['duration_minutes'] = $duration;
            $subtotal = $this->bookingTotalMinor($court, $duration);
            $discount = min((int) ($booking->discount_minor ?? 0), $subtotal);
            $updates['subtotal_minor'] = $subtotal;
            $updates['discount_minor'] = $discount;
            $updates['total_minor'] = max(0, $subtotal - $discount);
            $updates['rescheduled_at'] = now();
        }
        if (array_key_exists('payment_method', $data)) {
            $updates['payment_method'] = $data['payment_method'];
        }
        DB::table('bookings')->where('id', $id)->update([...$updates, 'updated_at' => now()]);
        $this->enqueueNotification($user->id, 'system', 'Booking updated', 'Your booking was updated.', ['booking_id' => $id]);

        return $this->show($request, $id);
    }

    private function holdsForOperator(Request $request, ?string $venueId = null): JsonResponse
    {
        $query = $this->validateQuery($request, [
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
            'offset' => ['nullable', 'integer', 'min:0'],
            'venue_id' => ['nullable', 'uuid'],
            'court_id' => ['nullable', 'uuid'],
            'include_expired' => ['nullable', 'boolean'],
        ]);
        $this->cleanupExpiredHolds();

        $base = DB::table('booking_holds as h')
            ->join('users as u', 'u.id', '=', 'h.user_id')
            ->join('courts as c', 'c.id', '=', 'h.court_id')
            ->join('venues as v', 'v.id', '=', 'c.venue_id');
        if ($venueId !== null) {
            $base->where('v.id', $venueId);
        } elseif (! empty($query['venue_id'])) {
            $base->where('v.id', $query['venue_id']);
        }
        if (! empty($query['court_id'])) {
            $base->where('h.court_id', $query['court_id']);
        }
        if (! ($query['include_expired'] ?? false)) {
            $base->where('h.expires_at', '>', now());
        }

        $total = (clone $base)->count('h.id');
        $limit = (int) ($query['limit'] ?? 50);
        $offset = (int) ($query['offset'] ?? 0);
        $items = $base
            ->orderBy('h.expires_at')
            ->offset($offset)
            ->limit($limit)
            ->get([
                'h.*',
                'u.display_name as user_name',
                'u.email as user_email',
                'c.name as court_name',
                'v.id as venue_id',
                'v.name as venue_name',
            ])
            ->map(fn ($hold) => $this->holdPayload($hold))
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

    private function holdPayload(object $hold): array
    {
        $court = null;
        if (! isset($hold->court_name) || ! isset($hold->venue_id)) {
            $court = DB::table('courts as c')
                ->join('venues as v', 'v.id', '=', 'c.venue_id')
                ->where('c.id', $hold->court_id)
                ->first(['c.name as court_name', 'v.id as venue_id', 'v.name as venue_name']);
        }
        $starts = CarbonImmutable::parse($hold->starts_at);
        $expires = CarbonImmutable::parse($hold->expires_at);

        return [
            'id' => $hold->id,
            'user_id' => $hold->user_id,
            'user_name' => $hold->user_name ?? null,
            'user_email' => $hold->user_email ?? null,
            'court_id' => $hold->court_id,
            'court_name' => $hold->court_name ?? $court->court_name ?? null,
            'venue_id' => $hold->venue_id ?? $court->venue_id ?? null,
            'venue_name' => $hold->venue_name ?? $court->venue_name ?? null,
            'starts_at' => $starts->toIso8601ZuluString('millisecond'),
            'ends_at' => $starts->addMinutes((int) $hold->duration_minutes)->toIso8601ZuluString('millisecond'),
            'duration_minutes' => (int) $hold->duration_minutes,
            'source' => $hold->source ?? 'app',
            'idempotency_key' => $hold->idempotency_key ?? null,
            'expires_at' => $expires->toIso8601ZuluString('millisecond'),
            'expired' => $expires->isPast(),
            'created_at' => $this->iso($hold->created_at ?? null),
            'updated_at' => $this->iso($hold->updated_at ?? null),
        ];
    }

    private function bookingPayload(object $b): array
    {
        $court = DB::table('courts as c')->join('venues as v', 'v.id', '=', 'c.venue_id')->where('c.id', $b->court_id)
            ->first(['c.name as court_name', 'v.id as venue_id', 'v.name as venue_name']);
        $splits = DB::table('payment_splits')->where('booking_id', $b->id)->get(['id', 'user_id', 'amount_minor', 'status', 'external_ref']);
        $starts = CarbonImmutable::parse($b->starts_at);

        return [
            'id' => $b->id,
            'game_id' => $b->game_id,
            'court_id' => $b->court_id,
            'user_id' => $b->user_id,
            'venue_id' => $court->venue_id ?? null,
            'venue_name' => $court->venue_name ?? '',
            'court_name' => $court->court_name ?? '',
            'starts_at' => $starts->toIso8601ZuluString('millisecond'),
            'ends_at' => $starts->addMinutes((int) $b->duration_minutes)->toIso8601ZuluString('millisecond'),
            'duration_minutes' => (int) $b->duration_minutes,
            'total_minor' => (int) $b->total_minor,
            'currency' => $b->currency,
            'status' => $b->status,
            'source' => $b->source ?? 'app',
            'payment_method' => $b->payment_method ?? null,
            'payment_note' => $b->payment_note ?? null,
            'subtotal_minor' => (int) ($b->subtotal_minor ?? $b->total_minor),
            'discount_minor' => (int) ($b->discount_minor ?? 0),
            'promo_code_id' => $b->promo_code_id ?? null,
            'promo_code' => $this->promoCodeForBooking($b->promo_code_id ?? null),
            'customer_name' => $b->customer_name ?? null,
            'customer_email' => $b->customer_email ?? null,
            'idempotency_key' => $b->idempotency_key,
            'external_ref' => $b->external_ref,
            'created_at' => $this->iso($b->created_at),
            'paid_at' => $this->iso($b->paid_at),
            'cancelled_at' => $this->iso($b->cancelled_at),
            'cancelled_by_user_id' => $b->cancelled_by_user_id ?? null,
            'cancellation_reason' => $b->cancellation_reason ?? null,
            'rescheduled_at' => $this->iso($b->rescheduled_at ?? null),
            'no_show_at' => $this->iso($b->no_show_at ?? null),
            'refund_status' => $b->refund_status ?? null,
            'refund_amount_minor' => $b->refund_amount_minor ?? null,
            'refund_note' => $b->refund_note ?? null,
            'refunded_at' => $this->iso($b->refunded_at ?? null),
            'splits' => $splits,
        ];
    }

    private function bookableCourtById(string $id): ?object
    {
        return DB::table('courts as c')
            ->join('venues as v', 'v.id', '=', 'c.venue_id')
            ->join('sports as s', 's.id', '=', 'c.sport_id')
            ->where('c.id', $id)
            ->whereIn('s.slug', ['padel', 'tennis'])
            ->where(fn ($q) => $q->whereNull('c.status')->orWhere('c.status', 'active'))
            ->where(fn ($q) => $q->whereNull('v.status')->orWhere('v.status', 'published'))
            ->first([
                'c.*',
                'v.id as venue_id',
                'v.name as venue_name',
                'v.opening_hours',
                'v.booking_slot_minutes',
                'v.min_booking_minutes',
                'v.max_booking_minutes',
                'v.cancellation_window_minutes',
                's.slug as sport_slug',
                's.name as sport_name',
            ]);
    }

    private function bookingsQuery(string $userId, array $query)
    {
        $base = DB::table('bookings as b')
            ->join('courts as c', 'c.id', '=', 'b.court_id')
            ->join('venues as v', 'v.id', '=', 'c.venue_id')
            ->join('sports as s', 's.id', '=', 'c.sport_id')
            ->where('b.user_id', $userId)
            ->whereIn('s.slug', ['padel', 'tennis']);

        if (! empty($query['status'])) {
            $base->where('b.status', $query['status']);
        }
        if (($query['timeframe'] ?? 'all') === 'upcoming') {
            $base->where('b.starts_at', '>=', now());
        } elseif (($query['timeframe'] ?? 'all') === 'past') {
            $base->where('b.starts_at', '<', now());
        }
        if (! empty($query['from'])) {
            $base->where('b.starts_at', '>=', CarbonImmutable::parse($query['from']));
        }
        if (! empty($query['to'])) {
            $base->where('b.starts_at', '<=', CarbonImmutable::parse($query['to']));
        }
        if (! empty($query['venue_id'])) {
            $base->where('v.id', $query['venue_id']);
        }
        if (! empty($query['sport'])) {
            $base->where('s.slug', $query['sport']);
        }

        return $base;
    }

    private function bookingPolicy(object $court): array
    {
        return [
            'opening_hours' => json_decode((string) ($court->opening_hours ?? ''), true) ?: [],
            'slot_minutes' => max(15, (int) ($court->booking_slot_minutes ?? 30)),
            'min_minutes' => max(15, (int) ($court->min_booking_minutes ?? 60)),
            'max_minutes' => max(15, (int) ($court->max_booking_minutes ?? 120)),
            'cancellation_window_minutes' => max(0, (int) ($court->cancellation_window_minutes ?? 120)),
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

    private function assertBookingRules(object $court, CarbonImmutable $starts, int $duration): void
    {
        $policy = $this->bookingPolicy($court);
        if ($duration < $policy['min_minutes'] || $duration > $policy['max_minutes']) {
            throw ApiException::validation('Booking duration is outside venue rules', [
                'min_booking_minutes' => $policy['min_minutes'],
                'max_booking_minutes' => $policy['max_minutes'],
            ]);
        }
        if ($duration % $policy['slot_minutes'] !== 0) {
            throw ApiException::validation('Booking duration must match venue slot size', [
                'slot_minutes' => $policy['slot_minutes'],
            ]);
        }
        $window = $this->openingWindowForDate($policy, $starts->setTimezone('Asia/Baku')->format('Y-m-d'));
        if ($window === null) {
            throw ApiException::conflict('Venue is closed on this day');
        }
        [$open, $close] = $window;
        $localStarts = $starts->setTimezone('Asia/Baku');
        $localEnds = $localStarts->addMinutes($duration);
        if ($localStarts < $open || $localEnds > $close) {
            throw ApiException::conflict('Booking is outside venue opening hours');
        }
    }

    private function assertHoldMatches(string $holdId, ?string $userId, string $courtId, CarbonImmutable $starts, int $duration): void
    {
        if (! Schema::hasTable('booking_holds')) {
            throw ApiException::validation('Booking hold is not available');
        }
        $hold = DB::table('booking_holds')
            ->where('id', $holdId)
            ->when($userId !== null, fn ($q) => $q->where('user_id', $userId))
            ->first();
        if ($hold === null) {
            throw ApiException::validation('Unknown hold_id');
        }
        if (CarbonImmutable::parse($hold->expires_at)->isPast()) {
            DB::table('booking_holds')->where('id', $holdId)->delete();
            throw ApiException::conflict('Booking hold has expired');
        }
        $holdStarts = CarbonImmutable::parse($hold->starts_at);
        if ($hold->court_id !== $courtId || ! $holdStarts->equalTo($starts) || (int) $hold->duration_minutes !== $duration) {
            throw ApiException::validation('Booking hold does not match booking request');
        }
    }

    private function assertCourtAvailable(string $courtId, CarbonImmutable $starts, CarbonImmutable $ends, ?string $ignoreBookingId = null, ?string $ignoreHoldId = null): void
    {
        $overlap = DB::table('bookings')
            ->where('court_id', $courtId)
            ->when($ignoreBookingId, fn ($q) => $q->where('id', '!=', $ignoreBookingId))
            ->whereIn('status', ['pending_payment', 'partially_paid', 'paid'])
            ->where('starts_at', '<', $ends)
            ->whereRaw("(starts_at + (duration_minutes || ' minutes')::interval) > ?", [$starts])
            ->exists();
        if ($overlap) {
            throw ApiException::conflict('Court is already booked for this time');
        }
        $blocked = DB::table('court_blocks')
            ->where('court_id', $courtId)
            ->where('starts_at', '<', $ends)
            ->where('ends_at', '>', $starts)
            ->exists();
        if ($blocked) {
            throw ApiException::conflict('Court is unavailable for this time');
        }
        $held = $this->activeHoldsQuery()
            ->where('court_id', $courtId)
            ->when($ignoreHoldId, fn ($q) => $q->where('id', '!=', $ignoreHoldId))
            ->where('starts_at', '<', $ends)
            ->whereRaw("(starts_at + (duration_minutes || ' minutes')::interval) > ?", [$starts])
            ->exists();
        if ($held) {
            throw ApiException::conflict('Court is temporarily held for this time');
        }
    }

    private function promoDiscount(?string $code, ?string $userId, int $subtotalMinor, string $currency): array
    {
        if ($code === null || trim($code) === '') {
            return ['promo_id' => null, 'discount_minor' => 0, 'promo' => null];
        }
        if (! Schema::hasTable('promo_codes')) {
            throw ApiException::validation('Promo code is not available');
        }

        $normalized = strtoupper(preg_replace('/\s+/', '', trim($code)));
        $now = now();
        $promo = DB::table('promo_codes')
            ->where('code', $normalized)
            ->where('status', 'active')
            ->where(fn ($q) => $q->whereNull('starts_at')->orWhere('starts_at', '<=', $now))
            ->where(fn ($q) => $q->whereNull('ends_at')->orWhere('ends_at', '>', $now))
            ->first();
        if ($promo === null) {
            throw ApiException::validation('Promo code is not valid');
        }
        if (($promo->currency ?? 'AZN') !== $currency) {
            throw ApiException::validation('Promo code currency does not match booking currency');
        }
        if ((int) ($promo->min_amount_minor ?? 0) > $subtotalMinor) {
            throw ApiException::validation('Promo code minimum amount was not reached');
        }
        if ($promo->max_redemptions !== null) {
            $count = DB::table('booking_promo_redemptions')->where('promo_code_id', $promo->id)->count();
            if ($count >= (int) $promo->max_redemptions) {
                throw ApiException::conflict('Promo code redemption limit reached');
            }
        }
        if ($userId !== null && (int) ($promo->per_user_limit ?? 1) > 0) {
            $count = DB::table('booking_promo_redemptions')->where('promo_code_id', $promo->id)->where('user_id', $userId)->count();
            if ($count >= (int) $promo->per_user_limit) {
                throw ApiException::conflict('Promo code was already used by this user');
            }
        }

        $discount = $promo->discount_type === 'percent'
            ? (int) floor($subtotalMinor * (int) $promo->discount_value / 100)
            : (int) $promo->discount_value;
        if ($promo->max_discount_minor !== null) {
            $discount = min($discount, (int) $promo->max_discount_minor);
        }
        $discount = min($subtotalMinor, max(0, $discount));

        return [
            'promo_id' => $promo->id,
            'discount_minor' => $discount,
            'promo' => [
                'id' => $promo->id,
                'code' => $promo->code,
                'title' => $promo->title,
                'discount_type' => $promo->discount_type,
                'discount_value' => (int) $promo->discount_value,
            ],
        ];
    }

    private function promoCodeForBooking(?string $promoCodeId): ?string
    {
        if ($promoCodeId === null || ! Schema::hasTable('promo_codes')) {
            return null;
        }

        return DB::table('promo_codes')->where('id', $promoCodeId)->value('code');
    }

    private function activeHoldsQuery()
    {
        if (! Schema::hasTable('booking_holds')) {
            return DB::query()->fromRaw('(select null::uuid as id, null::uuid as user_id, null::uuid as court_id, now() as starts_at, 0::int as duration_minutes, now() as expires_at where false) as booking_holds');
        }

        return DB::table('booking_holds')->where('expires_at', '>', now());
    }

    private function cleanupExpiredHolds(): void
    {
        if (Schema::hasTable('booking_holds')) {
            DB::table('booking_holds')->where('expires_at', '<=', now())->delete();
        }
    }

    /**
     * Resolve an idempotency key from the request body, then the Idempotency-Key
     * header (mobile sends it there). Generates one when absent so a booking/hold
     * never fails purely because the client didn't supply a key — duplicate
     * slots are still blocked by the bookings EXCLUDE constraint regardless.
     */
    private function resolveIdempotencyKey(Request $request, ?string $bodyKey, bool $generateIfMissing = true): string
    {
        $key = $bodyKey ?: (string) ($request->header('Idempotency-Key') ?? '');
        $key = trim($key);
        if (strlen($key) >= 8) {
            return mb_substr($key, 0, 200);
        }
        if ($generateIfMissing) {
            return (string) Str::uuid();
        }
        throw ApiException::validation('idempotency_key is required (request body or Idempotency-Key header)');
    }

    private function bookingTotalMinor(object $court, int $durationMinutes): int
    {
        return (int) round(((int) $court->hourly_price_minor) * $durationMinutes / 60);
    }

    private function canManageBooking(object $user, object $booking): bool
    {
        if ($user->admin_role === 'admin') {
            return true;
        }
        if ($user->admin_role === 'moderator') {
            return $this->hasAdminPermission($user, 'bookings');
        }
        if ($user->admin_role !== 'partner' || $user->venue_id === null) {
            return false;
        }

        $court = DB::table('courts as c')
            ->join('venues as v', 'v.id', '=', 'c.venue_id')
            ->where('c.id', $booking->court_id)
            ->where('v.id', $user->venue_id)
            ->first(['v.id as venue_id', 'v.owner_user_id']);
        if ($court === null) {
            return false;
        }
        if ((string) $court->owner_user_id === (string) $user->id) {
            return true;
        }
        $permissions = $this->normalizePartnerPermissions(json_decode((string) ($user->staff_permissions ?? ''), true) ?: null);

        return (bool) ($permissions['bookings'] ?? false);
    }

    private function requirePartnerBookingPermission(object $user): string
    {
        if ($user->admin_role !== 'partner' || $user->venue_id === null) {
            throw ApiException::forbidden('Partner account required');
        }
        $venue = DB::table('venues')->where('id', $user->venue_id)->first(['id', 'owner_user_id']);
        if ($venue === null) {
            throw ApiException::forbidden('Partner venue not found');
        }
        if ((string) $venue->owner_user_id === (string) $user->id) {
            return (string) $venue->id;
        }
        $permissions = $this->normalizePartnerPermissions(json_decode((string) ($user->staff_permissions ?? ''), true) ?: null);
        if (! (bool) ($permissions['bookings'] ?? false)) {
            throw ApiException::forbidden('Owner permission required: bookings');
        }

        return (string) $venue->id;
    }

    private function normalizePartnerPermissions(?array $permissions): array
    {
        $base = [
            'dashboard' => true,
            'bookings' => true,
            'manual_booking' => true,
            'calendar' => true,
            'courts' => true,
            'maintenance' => true,
            'customers' => true,
            'reviews' => true,
            'reports' => true,
            'tournaments' => true,
            'staff' => false,
            'venue_settings' => false,
            'revenue' => false,
        ];
        if ($permissions === null) {
            return $base;
        }
        foreach ($base as $key => $default) {
            if (array_key_exists($key, $permissions)) {
                $base[$key] = (bool) $permissions[$key];
            }
        }

        return $base;
    }

    private function notifyBookingCreated(string $bookingId, string $venueId, string $userId): void
    {
        $this->enqueueNotification($userId, 'system', 'Booking confirmed', 'Your court booking was created.', ['booking_id' => $bookingId]);
        app(TransactionalMailService::class)->bookingConfirmed($bookingId);
        $owners = DB::table('users')->where('admin_role', 'partner')->where('venue_id', $venueId)->whereNull('deleted_at')->pluck('id');
        foreach ($owners as $ownerId) {
            $this->enqueueNotification((string) $ownerId, 'system', 'New booking', 'A new booking was created for your venue.', ['booking_id' => $bookingId, 'venue_id' => $venueId]);
        }
        app(TransactionalMailService::class)->ownerNewBooking($bookingId, $venueId);
    }

    private function notifyBookingCancelled(object $booking): void
    {
        $this->enqueueNotification((string) $booking->user_id, 'system', 'Booking cancelled', 'Your booking was cancelled.', ['booking_id' => $booking->id]);
        app(TransactionalMailService::class)->bookingCancelled((string) $booking->id, $booking->cancellation_reason ?? null);
    }

    private function enqueueNotification(string $userId, string $type, string $title, string $body, array $payload = []): void
    {
        $id = (string) Str::uuid();
        DB::table('notifications')->insert([
            'id' => $id,
            'user_id' => $userId,
            'type' => $type,
            'title' => $title,
            'body' => $body,
            'payload' => json_encode($payload),
            'created_at' => now(),
        ]);
        if (Schema::hasTable('push_notification_jobs')) {
            DB::table('push_notification_jobs')->insert([
                'id' => (string) Str::uuid(),
                'user_id' => $userId,
                'type' => $type,
                'title' => $title,
                'body' => $body,
                'payload' => json_encode($payload),
                'available_at' => now(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }
}
