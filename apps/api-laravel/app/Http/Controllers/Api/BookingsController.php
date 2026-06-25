<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\AuthorizesAdminPermissions;
use App\Http\Controllers\Api\Concerns\HandlesIdempotentRequests;
use App\Http\Controllers\Api\Concerns\SanitizesCsv;
use App\Services\Launch\LaunchConfig;
use App\Services\Mail\TransactionalMailService;
use App\Services\Membership\MembershipService;
use App\Support\ApiException;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Response;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class BookingsController extends ApiController
{
    use AuthorizesAdminPermissions;
    use HandlesIdempotentRequests;
    use SanitizesCsv;

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
        // `starts_at` + `duration_minutes` is the explicit (web) contract. The
        // mobile client instead asks for a whole Baku calendar `date` and lets
        // the venue policy pick the duration, so both shapes are accepted: when
        // a field is omitted it is derived below (date → start-of-day,
        // duration → policy minimum). Either spelling yields the same item list.
        $query = $this->validateQuery($request, [
            'starts_at' => ['sometimes', 'nullable', 'date'],
            'date' => ['sometimes', 'nullable', 'regex:/^\d{4}-\d{2}-\d{2}$/'],
            'duration_minutes' => ['sometimes', 'nullable', 'integer', 'min:15', 'max:480'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:50'],
            'days_ahead' => ['nullable', 'integer', 'min:1', 'max:30'],
        ]);

        $court = $this->bookableCourtById($id);
        if ($court === null) {
            throw ApiException::notFound('Court not found');
        }

        $policy = $this->bookingPolicy($court);
        // Anchor: explicit `starts_at` wins; else the start of the requested
        // Baku `date` (clamped to now for today); else now.
        if (! empty($query['starts_at'])) {
            $requested = CarbonImmutable::parse($query['starts_at']);
        } elseif (! empty($query['date'])) {
            $dayStart = CarbonImmutable::parse($query['date'].' 00:00:00', 'Asia/Baku');
            $now = now('Asia/Baku');
            $requested = $dayStart->isToday() && $now->greaterThan($dayStart) ? $now->utc() : $dayStart->utc();
        } else {
            $requested = now()->utc();
        }
        // Duration: explicit value, else the shortest policy-valid booking
        // (min, snapped up to a whole slot, capped at max) so the suggested
        // slots are themselves bookable.
        $explicitStart = ! empty($query['starts_at']);
        $duration = ! empty($query['duration_minutes'])
            ? (int) $query['duration_minutes']
            : $this->defaultBookingMinutes($policy);
        if ($explicitStart) {
            // Web contract: the caller's exact start must satisfy venue rules.
            $this->assertBookingRules($court, $requested, $duration);
        } else {
            // Derived anchor (date/now): the moment itself may legitimately fall
            // outside opening hours (e.g. browsing at night), so only the
            // duration is validated here — the per-slot loop below still emits
            // only in-hours, in-future, available slots.
            $this->assertBookingDuration($policy, $duration);
        }

        $limit = (int) ($query['limit'] ?? 12);
        // A date-scoped request only suggests slots within that single day; the
        // open-ended (starts_at) request keeps scanning forward up to days_ahead.
        $daysAhead = ! empty($query['date']) && empty($query['starts_at'])
            ? 1
            : (int) ($query['days_ahead'] ?? 7);
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
        app(MembershipService::class)->ensureCanBook($user->id);
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
        $data['idempotency_key'] = $this->requireRequestIdempotencyKey($request, $data['idempotency_key'] ?? null);

        return $this->replayOrStoreIdempotentResponse($request, $data['idempotency_key'], function () use ($request, $user, $data): JsonResponse {
            return $this->createBooking($request, $user, $data);
        });
    }

    private function createBooking(Request $request, object $user, array $data): JsonResponse
    {

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
        $id = (string) Str::uuid();
        $subtotal = 0;
        $promo = ['promo_id' => null, 'discount_minor' => 0, 'promo' => null];
        try {
            // Booking insert + hold release + promo redemption commit atomically:
            // a crash mid-way must not leave a booking with its promo redemption
            // un-recorded (which would under-count per_user_limit / max_redemptions).
            DB::transaction(function () use ($id, $data, $user, $court, $starts, $ends, &$subtotal, &$promo, $holdId) {
                $this->lockCourtSlot((string) $data['court_id']);
                if ($holdId !== null) {
                    $this->assertHoldMatches((string) $holdId, (string) $user->id, (string) $data['court_id'], $starts, (int) $data['duration_minutes']);
                }
                $this->assertCourtAvailable((string) $data['court_id'], $starts, $ends, null, $holdId);
                $subtotal = $this->bookingTotalMinor($court, (int) $data['duration_minutes']);
                $promo = $this->promoDiscount($data['promo_code'] ?? null, (string) $user->id, $subtotal, (string) $court->currency);
                $serviceFee = app(LaunchConfig::class)->bookingServiceFeeMinor();

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
                    'total_minor' => max(0, $subtotal - $promo['discount_minor']) + $serviceFee,
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
        } catch (QueryException $e) {
            // 23P01 = GiST slot-overlap EXCLUDE (race). 23505 = a unique-index
            // violation, but TWO different bookings indexes raise it and they
            // mean opposite things, so we must disambiguate by constraint name:
            //   - bookings_idempotency_key_key        → idempotency-key replay
            //   - bookings_active_court_start_unique   → slot already booked
            //     (added by migration 2026_06_22_000001; same meaning as 23P01).
            $sqlState = (string) ($e->errorInfo[0] ?? '');
            if ($sqlState === '23P01') {
                throw ApiException::conflict('Court is already booked for this time');
            }
            if ($sqlState === '23505') {
                // The violated constraint name is not exposed as a discrete PDO
                // field, so inspect the full server message (errorInfo[2] /
                // getMessage()) for the slot-unique index. If it's that index the
                // collision is a slot race → conflict (consistent with 23P01).
                $detail = ((string) ($e->errorInfo[2] ?? '')).' '.$e->getMessage();
                if (str_contains($detail, 'bookings_active_court_start_unique')) {
                    throw ApiException::conflict('Court is already booked for this time');
                }
                // Otherwise treat as an idempotency-key replay — return the booking
                // already created for this key BY THIS USER. Scoping to user_id
                // prevents a cross-user PII leak: the idempotency_key column is
                // globally unique, so without this filter a client reusing another
                // user's key would receive that user's booking. The defensive
                // fallback (constraint name undeterminable) also lands here,
                // preserving the original behavior.
                $prior = DB::table('bookings')
                    ->where('idempotency_key', $data['idempotency_key'])
                    ->where('user_id', $user->id)
                    ->first();
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
        $data['idempotency_key'] = $this->resolveRequestIdempotencyKey($request, $data['idempotency_key'] ?? null, true);

        return $this->replayOrStoreIdempotentResponse($request, $data['idempotency_key'], function () use ($request, $user, $data): JsonResponse {
            return $this->createBookingHold($request, $user, $data);
        });
    }

    private function createBookingHold(Request $request, object $user, array $data): JsonResponse
    {
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
        $id = (string) Str::uuid();
        $expiresAt = now()->addSeconds((int) ($data['ttl_seconds'] ?? 300));
        DB::transaction(function () use ($id, $data, $user, $starts, $ends, $expiresAt) {
            $this->lockCourtSlot((string) $data['court_id']);
            $this->cleanupExpiredHolds();
            $this->assertCourtAvailable((string) $data['court_id'], $starts, $ends);
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
        });

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
        $serviceFee = app(LaunchConfig::class)->bookingServiceFeeMinor();

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
            'service_fee_minor' => $serviceFee,
            'booking_fee_enabled' => app(LaunchConfig::class)->bookingFeeEnabled(),
            'total_minor' => $total + $serviceFee,
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
        $now = now();
        $rows = $this->bookingsQuery($user->id, $query)->orderByDesc('b.starts_at')
            ->get(['b.*', 'c.name as court_name', 'v.id as venue_id', 'v.name as venue_name']);
        [$splitsByBooking, $promoByBooking] = $this->prefetchBookingRelations($rows);
        $upcoming = $rows->filter(fn ($b) => CarbonImmutable::parse($b->starts_at)->greaterThanOrEqualTo($now)
            && ! in_array($b->status, ['cancelled', 'refunded', 'failed'], true));
        $past = $rows->reject(fn ($b) => CarbonImmutable::parse($b->starts_at)->greaterThanOrEqualTo($now)
            && ! in_array($b->status, ['cancelled', 'refunded', 'failed'], true));
        $map = fn ($r) => $this->bookingPayload($r, $splitsByBooking[$r->id] ?? [], true, $promoByBooking[$r->promo_code_id ?? ''] ?? null);

        return response()->json([
            'upcoming' => $upcoming->map($map)->values(),
            'past' => $past->map($map)->values(),
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
        $bookings = $base
            ->orderByDesc('b.starts_at')
            ->offset($offset)
            ->limit($limit)
            ->get(['b.*', 'c.name as court_name', 'v.id as venue_id', 'v.name as venue_name']);
        [$splitsByBooking, $promoByBooking] = $this->prefetchBookingRelations($bookings);
        $rows = $bookings
            ->map(fn ($booking) => $this->bookingPayload($booking, $splitsByBooking[$booking->id] ?? [], true, $promoByBooking[$booking->promo_code_id ?? ''] ?? null))
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
                    $this->csvSafe($row->id),
                    $this->csvSafe($row->venue_name),
                    $this->csvSafe($row->court_name),
                    $this->csvSafe($row->sport_slug),
                    $this->iso($row->starts_at),
                    (int) $row->duration_minutes,
                    number_format(((int) $row->total_minor) / 100, 2, '.', ''),
                    $this->csvSafe($row->currency),
                    $this->csvSafe($row->status),
                    $this->csvSafe($row->payment_method),
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
        if (! app(LaunchConfig::class)->freeCancellationEnabled() && CarbonImmutable::parse($booking->starts_at)->subMinutes($window)->isPast()) {
            throw ApiException::conflict('Cancellation window has passed');
        }

        // Cancel + waitlist promotion are atomic: freeing the slot and flipping
        // the earliest waitlist entry to `notified` must commit together so a
        // crash can't leave a free slot with a stranded (still-active) waitlist
        // entry, nor a `notified` entry for a slot that wasn't actually freed.
        $promoted = null;
        DB::transaction(function () use ($id, $user, $data, $booking, &$promoted): void {
            DB::table('bookings')->where('id', $id)->update([
                'status' => 'cancelled',
                'cancelled_at' => now(),
                'cancelled_by_user_id' => $user->id,
                'cancellation_reason' => $data['reason'] ?? null,
                'refund_status' => in_array($booking->status, ['paid', 'partially_paid'], true) ? 'pending_manual_review' : null,
                'updated_at' => now(),
            ]);
            $promoted = $this->promoteWaitlistForFreedSlot($booking);
        });
        $this->notifyBookingCancelled($booking);
        if ($promoted !== null) {
            $this->enqueueNotification(
                (string) $promoted->user_id,
                'system',
                'Waitlist slot available',
                'A slot you waitlisted is now available.',
                [
                    'court_id' => (string) $promoted->court_id,
                    'waitlist_entry_id' => (string) $promoted->id,
                    'starts_at' => CarbonImmutable::parse($promoted->starts_at)->toIso8601ZuluString('millisecond'),
                ],
            );
        }

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
        // Already paid → idempotent no-op success. Returning here (before the
        // update + notification) keeps the side-effects single-fire so
        // re-marking a paid booking neither rewrites paid_at nor spams a
        // duplicate "payment confirmed" notification.
        if ($booking->status === 'paid') {
            return $this->show($request, $id);
        }
        // Status-transition guard: a booking may only be marked paid while it is
        // still awaiting payment. Terminal/invalid states (cancelled, refunded,
        // failed) must NOT be resurrectable to paid — reject with a conflict.
        if (! in_array($booking->status, ['pending_payment', 'partially_paid'], true)) {
            throw ApiException::conflict('Booking cannot be marked paid from its current status');
        }

        DB::transaction(function () use ($id, $request, $booking): void {
            DB::table('bookings')->where('id', $id)->update([
                'status' => 'paid',
                'paid_at' => now(),
                'payment_method' => $request->input('payment_method', $booking->payment_method ?? 'manual'),
                'payment_note' => $request->input('payment_note', $booking->payment_note ?? null),
                'updated_at' => now(),
            ]);
            // Notify the booker their payment was recorded — mirrors
            // notifyBookingCreated's fan-out (in-app notification + push). Inside
            // the transaction so a notification failure rolls the status back
            // rather than leaving a paid booking with no record sent.
            $this->notifyBookingPaid($booking);
        });

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
        if (array_key_exists('payment_method', $data)) {
            $updates['payment_method'] = $data['payment_method'];
        }
        if (array_key_exists('starts_at', $data) || array_key_exists('duration_minutes', $data)) {
            $court = $this->bookableCourtById((string) $booking->court_id);
            if ($court === null) {
                throw ApiException::conflict('Court is not available for rescheduling');
            }
            $window = max(0, (int) ($court->cancellation_window_minutes ?? 120));
            if (! app(LaunchConfig::class)->freeCancellationEnabled() && CarbonImmutable::parse($booking->starts_at)->subMinutes($window)->isPast()) {
                throw ApiException::conflict('Reschedule window has passed');
            }
            $this->assertBookingRules($court, $starts, $duration);
            DB::transaction(function () use ($booking, $starts, $duration, $id, &$updates, $court) {
                $this->lockCourtSlot((string) $booking->court_id);
                $this->assertCourtAvailable((string) $booking->court_id, $starts, $starts->addMinutes($duration), $id);
                $subtotal = $this->bookingTotalMinor($court, $duration);
                $discount = min((int) ($booking->discount_minor ?? 0), $subtotal);
                $updates['subtotal_minor'] = $subtotal;
                $updates['discount_minor'] = $discount;
                $updates['total_minor'] = max(0, $subtotal - $discount) + app(LaunchConfig::class)->bookingServiceFeeMinor();
                $updates['starts_at'] = $starts;
                $updates['duration_minutes'] = $duration;
                $updates['rescheduled_at'] = now();
                DB::table('bookings')->where('id', $id)->update([...$updates, 'updated_at' => now()]);
            });
        } else {
            DB::table('bookings')->where('id', $id)->update([...$updates, 'updated_at' => now()]);
        }
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

    /**
     * Batch the two per-row relations bookingPayload() needs (payment_splits and
     * promo codes) for a page of bookings, so the list endpoints (index, mine)
     * issue two whereIn() queries instead of two-per-row. Returns
     * [splitsByBookingId, promoCodeById].
     *
     * @param  iterable<int,object>  $bookings
     * @return array{0:array<string,array<int,object>>,1:array<string,string>}
     */
    private function prefetchBookingRelations(iterable $bookings): array
    {
        $bookingIds = [];
        $promoIds = [];
        foreach ($bookings as $b) {
            $bookingIds[] = $b->id;
            if (! empty($b->promo_code_id)) {
                $promoIds[$b->promo_code_id] = true;
            }
        }

        $splitsByBooking = [];
        if ($bookingIds !== []) {
            foreach (DB::table('payment_splits')->whereIn('booking_id', $bookingIds)->get(['id', 'booking_id', 'user_id', 'amount_minor', 'status', 'external_ref']) as $split) {
                $splitsByBooking[$split->booking_id][] = (object) [
                    'id' => $split->id,
                    'user_id' => $split->user_id,
                    'amount_minor' => $split->amount_minor,
                    'status' => $split->status,
                    'external_ref' => $split->external_ref,
                ];
            }
        }

        $promoById = [];
        if ($promoIds !== [] && Schema::hasTable('promo_codes')) {
            $promoById = DB::table('promo_codes')->whereIn('id', array_keys($promoIds))->pluck('code', 'id')->all();
        }

        return [$splitsByBooking, $promoById];
    }

    /**
     * @param  array<int,object>|null  $splits  prefetched payment_splits for THIS booking (else queried)
     * @param  bool  $promoResolved  true when $promoCode was prefetched (so a null means "no promo", not "look it up")
     */
    private function bookingPayload(object $b, ?array $splits = null, bool $promoResolved = false, ?string $promoCode = null): array
    {
        // When the caller already selected the joined court_name/venue_id/venue_name
        // (list endpoints select them via bookingsQuery) reuse them; otherwise fall
        // back to the per-row lookup for single-record callers (show/create/replay).
        if (property_exists($b, 'court_name') && property_exists($b, 'venue_id') && property_exists($b, 'venue_name')) {
            $court = (object) ['court_name' => $b->court_name, 'venue_id' => $b->venue_id, 'venue_name' => $b->venue_name];
        } else {
            $court = DB::table('courts as c')->join('venues as v', 'v.id', '=', 'c.venue_id')->where('c.id', $b->court_id)
                ->first(['c.name as court_name', 'v.id as venue_id', 'v.name as venue_name']);
        }
        $splits ??= DB::table('payment_splits')->where('booking_id', $b->id)->get(['id', 'user_id', 'amount_minor', 'status', 'external_ref'])->all();
        $promoCodeValue = $promoResolved ? $promoCode : $this->promoCodeForBooking($b->promo_code_id ?? null);
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
            'promo_code' => $promoCodeValue,
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

    /**
     * The shortest policy-valid booking duration: at least `min_minutes`,
     * rounded up to a whole `slot_minutes`, and never beyond `max_minutes`.
     * Mirrors the mobile client's BookingPolicy.defaultBookingMinutes so a
     * date-only suggested-slots request and the booking it leads to agree.
     */
    private function defaultBookingMinutes(array $policy): int
    {
        $slot = max(1, (int) $policy['slot_minutes']);
        $target = max((int) $policy['min_minutes'], $slot);
        $snapped = (int) (ceil($target / $slot) * $slot);

        return min($snapped, (int) $policy['max_minutes']);
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

    /**
     * Validate a booking duration against the venue policy (range + slot
     * multiple) without checking opening hours — used both by
     * {@see assertBookingRules} and by the date/now-anchored suggested-slots
     * path where the anchor moment may legitimately be outside opening hours.
     */
    private function assertBookingDuration(array $policy, int $duration): void
    {
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
    }

    private function assertBookingRules(object $court, CarbonImmutable $starts, int $duration): void
    {
        $policy = $this->bookingPolicy($court);
        $this->assertBookingDuration($policy, $duration);
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
        // Data integrity: a booking/hold/quote/reschedule must not be for a slot
        // that has already fully elapsed. Compared on the booking END (rather than
        // start) so the slot currently in progress remains bookable — legitimate
        // clients only ever send future times, so this rejects only stale/abusive
        // requests without narrowing the contract.
        if ($starts->addMinutes($duration)->lessThanOrEqualTo(CarbonImmutable::now())) {
            throw ApiException::conflict('Booking time is in the past');
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
        $bookingQuery = DB::table('bookings')
            ->where('court_id', $courtId)
            ->when($ignoreBookingId, fn ($q) => $q->where('id', '!=', $ignoreBookingId))
            ->whereIn('status', ['pending_payment', 'partially_paid', 'paid'])
            ->where('starts_at', '<', $ends);
        $overlap = DB::connection()->getDriverName() === 'pgsql'
            ? (clone $bookingQuery)->whereRaw("(starts_at + (duration_minutes || ' minutes')::interval) > ?", [$starts])->exists()
            : $this->rowsOverlapWindow((clone $bookingQuery)->get(['starts_at', 'duration_minutes']), $starts, $ends);
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
        $holdQuery = $this->activeHoldsQuery()
            ->where('court_id', $courtId)
            ->when($ignoreHoldId, fn ($q) => $q->where('id', '!=', $ignoreHoldId))
            ->where('starts_at', '<', $ends);
        $held = DB::connection()->getDriverName() === 'pgsql'
            ? (clone $holdQuery)->whereRaw("(starts_at + (duration_minutes || ' minutes')::interval) > ?", [$starts])->exists()
            : $this->rowsOverlapWindow((clone $holdQuery)->get(['starts_at', 'duration_minutes']), $starts, $ends);
        if ($held) {
            throw ApiException::conflict('Court is temporarily held for this time');
        }
    }

    private function rowsOverlapWindow(iterable $rows, CarbonImmutable $starts, CarbonImmutable $ends): bool
    {
        foreach ($rows as $row) {
            $rowStart = CarbonImmutable::parse($row->starts_at);
            $rowEnd = $rowStart->addMinutes((int) $row->duration_minutes);
            if ($rowStart < $ends && $rowEnd > $starts) {
                return true;
            }
        }

        return false;
    }

    private function promoDiscount(?string $code, ?string $userId, int $subtotalMinor, string $currency): array
    {
        if ($code === null || trim($code) === '') {
            return ['promo_id' => null, 'discount_minor' => 0, 'promo' => null];
        }
        if (! app(LaunchConfig::class)->promoEnabled()) {
            throw ApiException::validation('Promo codes are not available');
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
        // Serialise concurrent redemptions of THIS code so the count-then-check
        // below can't be raced past max_redemptions / per_user_limit. When we are
        // inside a booking transaction (createBooking → promoDiscount), the
        // lockCourtSlot lock only serialises bookings on the SAME court — two
        // bookings on different courts would both pass the unlocked count and
        // exceed the cap. Locking the promo_codes row here serialises them
        // regardless of court. lockForUpdate is a no-op outside a transaction
        // (quote()), where no redemption is written so the read-only count is fine.
        if (DB::transactionLevel() > 0) {
            DB::table('promo_codes')->where('id', $promo->id)->lockForUpdate()->first(['id']);
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
    private function lockCourtSlot(string $courtId): void
    {
        $locked = DB::table('courts')->where('id', $courtId)->lockForUpdate()->first(['id']);
        if ($locked === null) {
            throw ApiException::validation('Unknown court_id');
        }
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

    /**
     * Promote the earliest ACTIVE waitlist entry whose window overlaps the slot
     * just freed by a cancelled booking. Flips that single entry to `notified`
     * (FIFO by created_at) and returns it so the caller can fan out a "slot
     * available" notification; returns null when nothing matches (behaviour then
     * unchanged). Designed to run inside the cancel transaction.
     *
     * Slot match: same court_id, the entry status is still `active`, and the
     * entry's [starts_at, starts_at+duration) window overlaps the freed
     * booking's window. Overlap (rather than exact equality) means a waitlist
     * entry for a longer/offset slot covering the freed time still gets a shot —
     * the entry keys (court_id + starts_at) line up with the booking keys.
     */
    private function promoteWaitlistForFreedSlot(object $booking): ?object
    {
        if (! Schema::hasTable('booking_waitlist_entries')) {
            return null;
        }

        $freedStart = CarbonImmutable::parse($booking->starts_at);
        $freedEnd = $freedStart->addMinutes((int) $booking->duration_minutes);

        // Narrow in SQL to the same court + active entries that start before the
        // freed window ends; the precise end-overlap (which needs duration math)
        // is finished in PHP so the logic is identical on pgsql and sqlite.
        $candidates = DB::table('booking_waitlist_entries')
            ->where('court_id', $booking->court_id)
            ->where('status', 'active')
            ->where('starts_at', '<', $freedEnd)
            ->orderBy('created_at')
            ->orderBy('id')
            ->get();

        foreach ($candidates as $entry) {
            $entryStart = CarbonImmutable::parse($entry->starts_at);
            $entryEnd = $entryStart->addMinutes((int) $entry->duration_minutes);
            if ($entryStart < $freedEnd && $entryEnd > $freedStart) {
                DB::table('booking_waitlist_entries')->where('id', $entry->id)->update([
                    'status' => 'notified',
                    'notified_at' => now(),
                    'updated_at' => now(),
                ]);

                return $entry;
            }
        }

        return null;
    }

    private function notifyBookingCancelled(object $booking): void
    {
        $this->enqueueNotification((string) $booking->user_id, 'system', 'Booking cancelled', 'Your booking was cancelled.', ['booking_id' => $booking->id]);
        app(TransactionalMailService::class)->bookingCancelled((string) $booking->id, $booking->cancellation_reason ?? null);
    }

    /**
     * Notify the booker that a manual/onsite payment was recorded against their
     * booking. Mirrors {@see notifyBookingCreated}: persisted in-app
     * notification (which also fans out to the push queue via
     * {@see enqueueNotification}). The payload mirrors the other booking
     * notifications so the mobile client can deep-link straight to the booking.
     */
    private function notifyBookingPaid(object $booking): void
    {
        $this->enqueueNotification(
            (string) $booking->user_id,
            'system',
            'Payment confirmed',
            'Your court booking payment was confirmed.',
            ['booking_id' => $booking->id],
        );
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
