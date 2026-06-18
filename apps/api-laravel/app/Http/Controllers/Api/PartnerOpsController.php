<?php

namespace App\Http\Controllers\Api;

use App\Services\Auth\PasswordService;
use App\Services\Mail\TransactionalMailService;
use App\Support\ApiException;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Response;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class PartnerOpsController extends ApiController
{
    public function account(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $venueId = $this->venueId($request);

        return response()->json([
            'id' => (string) $user->id,
            'email' => (string) $user->email,
            'display_name' => (string) $user->display_name,
            'admin_role' => $user->admin_role,
            'venue_id' => (string) $venueId,
            'staff_title' => $user->staff_title ?? null,
            'staff_permissions' => $this->permissionsForUser($user, $venueId),
            'is_owner' => DB::table('venues')->where('id', $venueId)->where('owner_user_id', $user->id)->exists(),
            'venue' => $this->venuePayload(DB::table('venues')->where('id', $venueId)->first()),
            'created_at' => $this->iso($user->created_at),
            'updated_at' => $this->iso($user->updated_at),
        ]);
    }

    public function updateAccount(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $this->venueId($request);
        $data = $this->validateBody($request, [
            'display_name' => ['sometimes', 'string', 'min:1', 'max:80'],
            'current_password' => ['required_with:password', 'string', 'max:200'],
            'password' => ['sometimes', 'string', 'min:8', 'max:200'],
        ]);
        if ($data === []) {
            throw ApiException::validation('Provide at least one field to update');
        }

        $updates = ['updated_at' => now()];
        if (isset($data['display_name'])) {
            $updates['display_name'] = trim($data['display_name']);
        }
        if (isset($data['password'])) {
            if ($user->password_hash === null || ! app(PasswordService::class)->verify($data['current_password'], $user->password_hash)) {
                throw ApiException::unauthenticated('Current password is invalid');
            }
            $updates['password_hash'] = app(PasswordService::class)->hash($data['password']);
        }
        DB::table('users')->where('id', $user->id)->update($updates);

        return $this->account($request);
    }

    public function bootstrap(Request $request): JsonResponse
    {
        $venueId = $this->venueId($request);

        return response()->json([
            'account' => $this->account($request)->getData(true),
            'venue' => $this->venuePayload(DB::table('venues')->where('id', $venueId)->first()),
            'stats' => $this->stats($request)->getData(true),
            'rules' => $this->rules($request)->getData(true),
            'today' => $this->today($request)->getData(true),
            'staff' => $this->canPermission($request, 'staff') ? ($this->staff($request)->getData(true)['items'] ?? []) : [],
        ]);
    }

    public function lookups(Request $request): JsonResponse
    {
        $venueId = $this->venueId($request);

        return response()->json([
            'sports' => DB::table('sports')->whereIn('slug', ['padel', 'tennis'])->orderByRaw("case when slug = 'padel' then 0 else 1 end")->get(['id', 'slug', 'name', 'min_players', 'max_players']),
            'venue' => DB::table('venues')->where('id', $venueId)->first(['id', 'name', 'status', 'booking_slot_minutes', 'min_booking_minutes', 'max_booking_minutes', 'cancellation_window_minutes']),
            'courts' => DB::table('courts as c')->join('sports as s', 's.id', '=', 'c.sport_id')->where('c.venue_id', $venueId)->orderBy('c.name')->get(['c.id', 'c.name', 'c.status', 'c.hourly_price_minor', 'c.currency', 's.slug as sport_slug']),
            'booking_statuses' => ['pending_payment', 'partially_paid', 'paid', 'cancelled', 'refunded', 'failed'],
            'payment_methods' => ['onsite', 'cash', 'bank_transfer', 'manual'],
            'court_statuses' => ['active', 'inactive', 'maintenance'],
        ]);
    }

    public function venue(Request $request): JsonResponse
    {
        return response()->json($this->venuePayload(DB::table('venues')->where('id', $this->venueId($request))->first()));
    }

    public function updateVenue(Request $request): JsonResponse
    {
        $this->requirePermission($request, 'venue_settings');
        $id = $this->venueId($request);
        $data = $this->validateBody($request, [
            'name' => ['sometimes', 'string', 'min:2', 'max:160'],
            'address' => ['sometimes', 'nullable', 'string', 'max:240'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:80'],
            'description' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'photo_urls' => ['sometimes', 'nullable', 'array'],
        ]);
        if ($data === []) {
            throw ApiException::validation('Provide at least one field to update');
        }
        if (array_key_exists('photo_urls', $data)) {
            $data['photo_urls'] = $this->pgTextArrayLiteral($data['photo_urls']);
        }
        DB::table('venues')->where('id', $id)->update([...$data, 'updated_at' => now()]);
        $this->auditWrite($this->authUser($request)->id, 'partner.venue.update', 'venues', $id, [
            'fields' => array_keys($data),
        ]);

        return $this->venue($request);
    }

    public function courts(Request $request): JsonResponse
    {
        return response()->json([
            'items' => DB::table('courts as c')
                ->join('sports as s', 's.id', '=', 'c.sport_id')
                ->where('c.venue_id', $this->venueId($request))
                ->whereIn('s.slug', ['padel', 'tennis'])
                ->orderBy('c.name')
                ->get(['c.*', 's.slug as sport_slug', 's.name as sport_name'])
                ->map(fn ($court) => $this->courtPayload($court))
                ->values(),
        ]);
    }

    public function court(Request $request, string $id): JsonResponse
    {
        $court = DB::table('courts as c')
            ->join('sports as s', 's.id', '=', 'c.sport_id')
            ->where('c.venue_id', $this->venueId($request))
            ->where('c.id', $id)
            ->whereIn('s.slug', ['padel', 'tennis'])
            ->first(['c.*', 's.slug as sport_slug', 's.name as sport_name']);
        if ($court === null) {
            throw ApiException::notFound('Court not found');
        }

        return response()->json([
            ...$this->courtPayload($court),
            'upcoming_bookings_count' => DB::table('bookings')->where('court_id', $id)->where('starts_at', '>=', now())->whereNotIn('status', ['cancelled', 'refunded', 'failed'])->count(),
            'active_blocks_count' => DB::table('court_blocks')->where('court_id', $id)->where('ends_at', '>=', now())->count(),
            'recent_bookings' => DB::table('bookings as b')
                ->leftJoin('users as u', 'u.id', '=', 'b.user_id')
                ->where('b.court_id', $id)
                ->orderByDesc('b.starts_at')
                ->limit(20)
                ->get(['b.*', 'u.display_name as booker_display_name', 'u.email as booker_email'])
                ->map(fn ($booking) => $this->bookingPayload((object) [
                    ...((array) $booking),
                    'court_name' => $court->name,
                    'venue_id' => $court->venue_id,
                ])),
        ]);
    }

    public function createCourt(Request $request): JsonResponse
    {
        $this->requirePermission($request, 'courts');
        $data = $this->validateBody($request, [
            'sport_id' => ['required', 'uuid'],
            'name' => ['required', 'string', 'min:1', 'max:120'],
            'hourly_price_minor' => ['nullable', 'integer', 'min:0', 'max:1000000'],
            'currency' => ['nullable', 'string', 'size:3'],
            'status' => ['nullable', 'in:active,inactive,maintenance'],
            'photo_url' => ['nullable', 'url', 'max:2048'],
            'photo_urls' => ['nullable', 'array'],
        ]);
        if (! DB::table('sports')->where('id', $data['sport_id'])->whereIn('slug', ['padel', 'tennis'])->exists()) {
            throw ApiException::validation('Unknown sport_id');
        }
        $id = (string) Str::uuid();
        DB::table('courts')->insert([
            'id' => $id,
            'venue_id' => $this->venueId($request),
            'sport_id' => $data['sport_id'],
            'name' => $data['name'],
            'hourly_price_minor' => $data['hourly_price_minor'] ?? 0,
            'currency' => $data['currency'] ?? 'AZN',
            'status' => $data['status'] ?? 'active',
            'photo_url' => $data['photo_url'] ?? null,
            'photo_urls' => isset($data['photo_urls']) ? json_encode($data['photo_urls']) : null,
            'created_at' => now(),
        ]);
        $this->auditWrite($this->authUser($request)->id, 'partner.court.create', 'courts', $id, [
            'venue_id' => $this->venueId($request),
            'sport_id' => $data['sport_id'],
            'name' => $data['name'],
        ]);

        return response()->json(DB::table('courts')->where('id', $id)->first(), 201);
    }

    public function updateCourt(Request $request, string $id): JsonResponse
    {
        $this->requirePermission($request, 'courts');
        $data = $this->validateBody($request, [
            'name' => ['sometimes', 'string', 'min:1', 'max:120'],
            'hourly_price_minor' => ['sometimes', 'integer', 'min:0', 'max:1000000'],
            'currency' => ['sometimes', 'string', 'size:3'],
            'status' => ['sometimes', 'in:active,inactive,maintenance'],
            'photo_url' => ['sometimes', 'nullable', 'url', 'max:2048'],
            'photo_urls' => ['sometimes', 'nullable', 'array'],
        ]);
        if ($data === []) {
            throw ApiException::validation('Provide at least one field to update');
        }
        if (array_key_exists('photo_urls', $data)) {
            $data['photo_urls'] = $data['photo_urls'] !== null ? json_encode($data['photo_urls']) : null;
        }
        $venueId = $this->venueId($request);
        $updated = DB::table('courts')->where('venue_id', $venueId)->where('id', $id)->update($data);
        if ($updated === 0) {
            throw ApiException::notFound('Court not found');
        }
        $this->auditWrite($this->authUser($request)->id, 'partner.court.update', 'courts', $id, [
            'venue_id' => $venueId,
            'fields' => array_keys($data),
        ]);

        return $this->court($request, $id);
    }

    public function deleteCourt(Request $request, string $id): JsonResponse
    {
        $this->requirePermission($request, 'courts');
        $venueId = $this->venueId($request);
        if (! DB::table('courts')->where('venue_id', $venueId)->where('id', $id)->exists()) {
            throw ApiException::notFound('Court not found');
        }
        if (DB::table('bookings')->where('court_id', $id)->exists()) {
            throw ApiException::conflict('Court has bookings and cannot be deleted');
        }
        $deleted = DB::table('courts')->where('venue_id', $venueId)->where('id', $id)->delete();
        if ($deleted === 0) {
            throw ApiException::notFound('Court not found');
        }
        $this->auditWrite($this->authUser($request)->id, 'partner.court.delete', 'courts', $id, [
            'venue_id' => $venueId,
        ]);

        return response()->json(null, 204);
    }

    public function bookings(Request $request): JsonResponse
    {
        $this->requirePermission($request, 'bookings');
        $venueId = $this->venueId($request);

        $from = $request->query('from');
        $to = $request->query('to');

        return response()->json([
            'items' => DB::table('bookings as b')
                ->join('courts as c', 'c.id', '=', 'b.court_id')
                ->leftJoin('users as u', 'u.id', '=', 'b.user_id')
                ->where('c.venue_id', $venueId)
                ->when($from, fn ($q) => $q->where('b.starts_at', '>=', $from))
                ->when($to, fn ($q) => $q->where('b.starts_at', '<=', $to))
                ->orderByDesc('b.starts_at')
                ->limit(500)
                ->get([
                    'b.*',
                    'c.name as court_name',
                    'u.display_name as booker_display_name',
                    'u.email as booker_email',
                ]),
        ]);
    }

    public function exportBookings(Request $request)
    {
        $this->requirePermission($request, 'bookings');
        $venueId = $this->venueId($request);
        $from = $request->query('from');
        $to = $request->query('to');
        $rows = DB::table('bookings as b')
            ->join('courts as c', 'c.id', '=', 'b.court_id')
            ->leftJoin('users as u', 'u.id', '=', 'b.user_id')
            ->where('c.venue_id', $venueId)
            ->when($from, fn ($q) => $q->where('b.starts_at', '>=', $from))
            ->when($to, fn ($q) => $q->where('b.starts_at', '<=', $to))
            ->orderBy('b.starts_at')
            ->get(['b.id', 'b.starts_at', 'b.duration_minutes', 'b.status', 'b.total_minor', 'b.currency', 'b.payment_method', 'b.customer_name', 'b.customer_email', 'c.name as court_name', 'u.display_name as booker_display_name', 'u.email as booker_email']);
        $csv = "id,starts_at,duration_minutes,court,status,payment_method,total_minor,currency,booker,booker_email,customer_name,customer_email\n";
        foreach ($rows as $row) {
            $csv .= implode(',', [
                $row->id,
                $row->starts_at,
                $row->duration_minutes,
                '"'.str_replace('"', '""', (string) $row->court_name).'"',
                $row->status,
                $row->payment_method,
                $row->total_minor,
                $row->currency,
                '"'.str_replace('"', '""', (string) $row->booker_display_name).'"',
                $row->booker_email,
                '"'.str_replace('"', '""', (string) $row->customer_name).'"',
                $row->customer_email,
            ])."\n";
        }

        return Response::make($csv, 200, ['Content-Type' => 'text/csv']);
    }

    public function today(Request $request): JsonResponse
    {
        $date = (string) $request->query('date', now('Asia/Baku')->format('Y-m-d'));
        $start = CarbonImmutable::parse($date.' 00:00', 'Asia/Baku')->utc();
        $end = $start->addDay();
        $venueId = $this->venueId($request);
        $base = DB::table('bookings as b')->join('courts as c', 'c.id', '=', 'b.court_id')->where('c.venue_id', $venueId)->where('b.starts_at', '>=', $start)->where('b.starts_at', '<', $end);

        return response()->json([
            'date' => $date,
            'summary' => [
                'bookings' => (clone $base)->count(),
                'paid' => (clone $base)->where('b.status', 'paid')->count(),
                'unpaid' => (clone $base)->whereIn('b.status', ['pending_payment', 'partially_paid'])->count(),
                'cancelled' => (clone $base)->where('b.status', 'cancelled')->count(),
                'revenue_paid_minor' => (int) (clone $base)->where('b.status', 'paid')->sum('b.total_minor'),
            ],
            'next_bookings' => (clone $base)
                ->leftJoin('users as u', 'u.id', '=', 'b.user_id')
                ->where('b.starts_at', '>=', now())
                ->orderBy('b.starts_at')
                ->limit(12)
                ->get(['b.*', 'c.name as court_name', 'u.display_name as booker_display_name', 'u.email as booker_email'])
                ->map(fn ($booking) => $this->bookingPayload($booking)),
            'blocks' => DB::table('court_blocks as cb')
                ->join('courts as c', 'c.id', '=', 'cb.court_id')
                ->where('c.venue_id', $venueId)
                ->where('cb.starts_at', '<', $end)
                ->where('cb.ends_at', '>', $start)
                ->orderBy('cb.starts_at')
                ->get(['cb.*', 'c.name as court_name']),
        ]);
    }

    public function activity(Request $request): JsonResponse
    {
        $venueId = $this->venueId($request);
        $limit = min(max((int) $request->query('limit', 30), 1), 100);
        $bookings = DB::table('bookings as b')
            ->join('courts as c', 'c.id', '=', 'b.court_id')
            ->leftJoin('users as u', 'u.id', '=', 'b.user_id')
            ->where('c.venue_id', $venueId)
            ->orderByDesc('b.updated_at')
            ->limit($limit)
            ->get(['b.id', 'b.status', 'b.source', 'b.updated_at', 'b.created_at', 'b.starts_at', 'b.total_minor', 'b.currency', 'c.name as court_name', 'u.display_name as booker_display_name'])
            ->map(fn ($row) => [
                'type' => 'booking',
                'id' => $row->id,
                'title' => trim(($row->booker_display_name ?: 'Manual booking').' - '.$row->court_name),
                'status' => $row->status,
                'source' => $row->source,
                'starts_at' => $this->iso($row->starts_at),
                'total_minor' => (int) $row->total_minor,
                'currency' => $row->currency,
                'created_at' => $this->iso($row->created_at),
                'updated_at' => $this->iso($row->updated_at),
            ]);

        return response()->json(['items' => $bookings]);
    }

    public function customers(Request $request): JsonResponse
    {
        $this->requirePermission($request, 'customers');
        $venueId = $this->venueId($request);
        $term = trim((string) $request->query('q', ''));
        $limit = min(max((int) $request->query('limit', 50), 1), 100);
        $lastBookings = DB::table('bookings as b')
            ->join('courts as c', 'c.id', '=', 'b.court_id')
            ->where('c.venue_id', $venueId)
            ->whereNotNull('b.user_id')
            ->selectRaw('b.user_id, COUNT(*) as bookings_count, MAX(b.starts_at) as last_booking_at, SUM(CASE WHEN b.status = ? THEN b.total_minor ELSE 0 END) as paid_total_minor', ['paid'])
            ->groupBy('b.user_id');

        $items = DB::table('users as u')
            ->joinSub($lastBookings, 'lb', 'lb.user_id', '=', 'u.id')
            ->when($term !== '', function ($q) use ($term) {
                $like = '%'.$term.'%';
                $q->where(fn ($w) => $w->where('u.display_name', 'ilike', $like)->orWhere('u.email', 'ilike', $like));
            })
            ->orderByDesc('lb.last_booking_at')
            ->limit($limit)
            ->get(['u.id', 'u.email', 'u.display_name', 'u.photo_url', 'lb.bookings_count', 'lb.last_booking_at', 'lb.paid_total_minor'])
            ->map(fn ($user) => [
                'id' => (string) $user->id,
                'email' => (string) $user->email,
                'display_name' => (string) $user->display_name,
                'photo_url' => $user->photo_url,
                'bookings_count' => (int) $user->bookings_count,
                'last_booking_at' => $this->iso($user->last_booking_at),
                'paid_total_minor' => (int) $user->paid_total_minor,
            ]);

        return response()->json(['items' => $items]);
    }

    public function userSearch(Request $request): JsonResponse
    {
        $this->requirePermission($request, 'customers');
        $term = trim((string) $request->query('q', ''));
        if ($term === '') {
            return response()->json(['items' => []]);
        }
        $like = '%'.$term.'%';

        return response()->json([
            'items' => DB::table('users')
                ->whereNull('deleted_at')
                ->where(fn ($q) => $q->where('display_name', 'ilike', $like)->orWhere('email', 'ilike', $like))
                ->orderBy('display_name')
                ->limit(min(max((int) $request->query('limit', 20), 1), 50))
                ->get(['id', 'email', 'display_name', 'photo_url', 'created_at'])
                ->map(fn ($user) => [
                    'id' => (string) $user->id,
                    'email' => (string) $user->email,
                    'display_name' => (string) $user->display_name,
                    'photo_url' => $user->photo_url,
                    'created_at' => $this->iso($user->created_at),
                ]),
        ]);
    }

    public function metrics(Request $request): JsonResponse
    {
        $this->requirePermission($request, 'reports');
        $venueId = $this->venueId($request);
        $days = min(max((int) $request->query('days', 30), 1), 365);
        $from = now()->subDays($days - 1)->startOfDay();
        $to = now()->endOfDay();

        $daily = DB::table('bookings as b')
            ->join('courts as c', 'c.id', '=', 'b.court_id')
            ->where('c.venue_id', $venueId)
            ->whereBetween('b.starts_at', [$from, $to])
            ->selectRaw("date_trunc('day', b.starts_at) as day, COUNT(*) as bookings_count, SUM(CASE WHEN b.status = 'paid' THEN b.total_minor ELSE 0 END) as paid_revenue_minor, SUM(CASE WHEN b.status IN ('pending_payment','partially_paid') THEN b.total_minor ELSE 0 END) as unpaid_revenue_minor")
            ->groupByRaw("date_trunc('day', b.starts_at)")
            ->orderBy('day')
            ->get()
            ->map(fn ($row) => [
                'date' => CarbonImmutable::parse($row->day)->format('Y-m-d'),
                'bookings_count' => (int) $row->bookings_count,
                'paid_revenue_minor' => (int) $row->paid_revenue_minor,
                'unpaid_revenue_minor' => (int) $row->unpaid_revenue_minor,
            ]);

        return response()->json([
            'from' => $this->iso($from),
            'to' => $this->iso($to),
            'daily' => $daily,
            'by_court' => DB::table('bookings as b')
                ->join('courts as c', 'c.id', '=', 'b.court_id')
                ->where('c.venue_id', $venueId)
                ->whereBetween('b.starts_at', [$from, $to])
                ->selectRaw("c.id as court_id, c.name as court_name, COUNT(*) as bookings_count, SUM(CASE WHEN b.status = 'paid' THEN b.total_minor ELSE 0 END) as paid_revenue_minor")
                ->groupBy('c.id', 'c.name')
                ->orderByDesc('paid_revenue_minor')
                ->get()
                ->map(fn ($row) => [
                    'court_id' => (string) $row->court_id,
                    'court_name' => (string) $row->court_name,
                    'bookings_count' => (int) $row->bookings_count,
                    'paid_revenue_minor' => (int) $row->paid_revenue_minor,
                ]),
        ]);
    }

    public function availability(Request $request): JsonResponse
    {
        $venueId = $this->venueId($request);
        $date = (string) $request->query('date', now('Asia/Baku')->format('Y-m-d'));
        if (! preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            throw ApiException::validation('date must be YYYY-MM-DD');
        }
        $courtId = $request->query('court_id');
        $venue = DB::table('venues')->where('id', $venueId)->first();
        $policy = $this->venuePolicy($venue);
        $window = $this->openingWindowForDate($policy, $date);
        $courts = DB::table('courts as c')
            ->join('sports as s', 's.id', '=', 'c.sport_id')
            ->where('c.venue_id', $venueId)
            ->when($courtId, fn ($q) => $q->where('c.id', $courtId))
            ->orderBy('c.name')
            ->get(['c.*', 's.slug as sport_slug', 's.name as sport_name']);

        if ($window === null) {
            return response()->json([
                'date' => $date,
                'slot_minutes' => $policy['slot_minutes'],
                'courts' => $courts->map(fn ($court) => [...$this->courtPayload($court), 'slots' => []])->values(),
            ]);
        }

        [$start, $end] = $window;
        $courtIds = $courts->pluck('id')->all();
        $bookings = DB::table('bookings')->whereIn('court_id', $courtIds)->whereIn('status', ['pending_payment', 'partially_paid', 'paid'])->where('starts_at', '<', $end)->whereRaw("(starts_at + (duration_minutes || ' minutes')::interval) > ?", [$start])->get()->groupBy('court_id');
        $blocks = DB::table('court_blocks')->whereIn('court_id', $courtIds)->where('starts_at', '<', $end)->where('ends_at', '>', $start)->get()->groupBy('court_id');

        return response()->json([
            'date' => $date,
            'open_hour' => (int) $start->format('G'),
            'close_hour' => (int) $end->format('G'),
            'slot_minutes' => $policy['slot_minutes'],
            'courts' => $courts->map(fn ($court) => [
                ...$this->courtPayload($court),
                'slots' => $this->availabilitySlots((string) $court->id, $start, $end, $policy['slot_minutes'], $bookings, $blocks),
            ])->values(),
        ]);
    }

    public function cancelBooking(Request $request, string $id): JsonResponse
    {
        $this->requirePermission($request, 'bookings');
        $user = $this->authUser($request);
        $booking = $this->bookingForVenue($request, $id);
        $data = $this->validateBody($request, [
            'reason' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'refund_status' => ['sometimes', 'nullable', 'in:pending_manual_review,approved,processed,rejected,not_required'],
            'refund_amount_minor' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:100000000'],
            'refund_note' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ]);
        $updates = [
            'status' => 'cancelled',
            'cancelled_at' => now(),
            'cancelled_by_user_id' => $user->id,
            'cancellation_reason' => $data['reason'] ?? null,
            'updated_at' => now(),
        ];
        foreach (['refund_status', 'refund_amount_minor', 'refund_note'] as $field) {
            if (array_key_exists($field, $data)) {
                $updates[$field] = $data[$field];
            }
        }
        DB::table('bookings')->where('id', $booking->id)->update($updates);
        if ($booking->user_id !== null) {
            $this->enqueueNotification((string) $booking->user_id, 'system', 'Booking cancelled', 'Your booking was cancelled by the venue.', ['booking_id' => $booking->id]);
        }
        app(TransactionalMailService::class)->bookingCancelled((string) $booking->id, $updates['cancellation_reason'] ?? null);
        $this->auditWrite($user->id, 'partner.booking.cancel', 'bookings', (string) $booking->id, $updates);

        return response()->json($this->bookingPayload($this->bookingForVenue($request, $id)));
    }

    public function refundBooking(Request $request, string $id): JsonResponse
    {
        $this->requirePermission($request, 'bookings');
        $user = $this->authUser($request);
        $booking = $this->bookingForVenue($request, $id);
        $data = $this->validateBody($request, [
            'refund_status' => ['sometimes', 'in:pending_manual_review,approved,processed,rejected,not_required'],
            'refund_amount_minor' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:100000000'],
            'refund_note' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ]);
        $refundStatus = $data['refund_status'] ?? 'processed';
        $updates = [
            'refund_status' => $refundStatus,
            'refund_amount_minor' => array_key_exists('refund_amount_minor', $data) ? $data['refund_amount_minor'] : (int) $booking->total_minor,
            'refund_note' => $data['refund_note'] ?? null,
            'updated_at' => now(),
        ];
        if ($refundStatus === 'processed') {
            $updates['status'] = 'refunded';
            $updates['refunded_at'] = now();
        }
        DB::table('bookings')->where('id', $booking->id)->update($updates);
        if ($booking->user_id !== null) {
            $this->enqueueNotification((string) $booking->user_id, 'system', 'Booking refund updated', 'Your booking refund status was updated by the venue.', ['booking_id' => $booking->id, 'refund_status' => $refundStatus]);
        }
        app(TransactionalMailService::class)->bookingRefundUpdated((string) $booking->id);
        $this->auditWrite($user->id, 'partner.booking.refund', 'bookings', (string) $booking->id, $updates);

        return response()->json($this->bookingPayload($this->bookingForVenue($request, $id)));
    }

    public function markPaid(Request $request, string $id): JsonResponse
    {
        $this->requirePermission($request, 'bookings');
        $booking = $this->bookingForVenue($request, $id);
        $updates = [
            'status' => 'paid',
            'paid_at' => now(),
            'payment_method' => $request->input('payment_method', 'manual'),
            'payment_note' => $request->input('payment_note'),
            'updated_at' => now(),
        ];
        DB::table('bookings')->where('id', $booking->id)->update($updates);
        $this->auditWrite($this->authUser($request)->id, 'partner.booking.mark_paid', 'bookings', (string) $booking->id, $updates);

        return response()->json($this->bookingPayload($this->bookingForVenue($request, $id)));
    }

    public function createBooking(Request $request): JsonResponse
    {
        $this->requirePermission($request, 'manual_booking');
        $user = $this->authUser($request);
        $venueId = $this->venueId($request);
        $data = $this->validateBody($request, [
            'court_id' => ['required', 'uuid'],
            'user_id' => ['sometimes', 'nullable', 'uuid'],
            'starts_at' => ['required', 'date'],
            'duration_minutes' => ['required', 'integer', 'min:15', 'max:480'],
            'customer_name' => ['nullable', 'string', 'max:120'],
            'customer_email' => ['nullable', 'email', 'max:254'],
            'payment_method' => ['nullable', 'in:cash,bank_transfer,manual,onsite'],
            'payment_note' => ['nullable', 'string', 'max:1000'],
            'status' => ['nullable', 'in:pending_payment,paid'],
        ]);
        $court = DB::table('courts as c')->join('venues as v', 'v.id', '=', 'c.venue_id')->where('c.id', $data['court_id'])->where('c.venue_id', $venueId)->first(['c.*', 'v.opening_hours', 'v.booking_slot_minutes', 'v.min_booking_minutes', 'v.max_booking_minutes']);
        if ($court === null) {
            throw ApiException::validation('Unknown court_id');
        }
        if (! empty($data['user_id']) && ! DB::table('users')->where('id', $data['user_id'])->whereNull('deleted_at')->exists()) {
            throw ApiException::validation('Unknown user_id');
        }
        $starts = CarbonImmutable::parse($data['starts_at']);
        $ends = $starts->addMinutes((int) $data['duration_minutes']);
        $this->assertVenueRules($court, $starts, (int) $data['duration_minutes']);
        $this->assertCourtAvailable($data['court_id'], $starts, $ends);

        $id = (string) Str::uuid();
        $status = $data['status'] ?? 'pending_payment';
        DB::table('bookings')->insert([
            'id' => $id,
            'game_id' => null,
            'court_id' => $data['court_id'],
            'user_id' => $data['user_id'] ?? $user->id,
            'starts_at' => $starts,
            'duration_minutes' => $data['duration_minutes'],
            'total_minor' => $this->bookingTotalMinor($court, (int) $data['duration_minutes']),
            'currency' => $court->currency,
            'status' => $status,
            'source' => 'owner_manual',
            'payment_method' => $data['payment_method'] ?? 'manual',
            'payment_note' => $data['payment_note'] ?? null,
            'customer_name' => $data['customer_name'] ?? null,
            'customer_email' => $data['customer_email'] ?? null,
            'created_by_user_id' => $user->id,
            'idempotency_key' => 'owner:'.$id,
            'paid_at' => $status === 'paid' ? now() : null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        app(TransactionalMailService::class)->bookingConfirmed($id);
        $this->auditWrite($user->id, 'partner.booking.create', 'bookings', $id, [
            'venue_id' => $venueId,
            'court_id' => $data['court_id'],
            'source' => 'owner_manual',
            'status' => $status,
        ]);

        return response()->json($this->bookingPayload($this->bookingForVenue($request, $id)), 201);
    }

    public function quoteBooking(Request $request): JsonResponse
    {
        $this->requirePermission($request, 'manual_booking');
        $venueId = $this->venueId($request);
        $data = $this->validateBody($request, [
            'court_id' => ['required', 'uuid'],
            'starts_at' => ['required', 'date'],
            'duration_minutes' => ['required', 'integer', 'min:15', 'max:480'],
        ]);
        $court = DB::table('courts as c')
            ->join('venues as v', 'v.id', '=', 'c.venue_id')
            ->where('c.id', $data['court_id'])
            ->where('c.venue_id', $venueId)
            ->first(['c.*', 'v.opening_hours', 'v.booking_slot_minutes', 'v.min_booking_minutes', 'v.max_booking_minutes']);
        if ($court === null) {
            throw ApiException::validation('Unknown court_id');
        }
        $starts = CarbonImmutable::parse($data['starts_at']);
        $duration = (int) $data['duration_minutes'];
        $this->assertVenueRules($court, $starts, $duration);
        $this->assertCourtAvailable((string) $data['court_id'], $starts, $starts->addMinutes($duration));

        return response()->json([
            'court_id' => $data['court_id'],
            'starts_at' => $starts->toIso8601ZuluString('millisecond'),
            'ends_at' => $starts->addMinutes($duration)->toIso8601ZuluString('millisecond'),
            'duration_minutes' => $duration,
            'hourly_price_minor' => (int) $court->hourly_price_minor,
            'total_minor' => $this->bookingTotalMinor($court, $duration),
            'currency' => $court->currency,
            'available' => true,
        ]);
    }

    public function markNoShow(Request $request, string $id): JsonResponse
    {
        $this->requirePermission($request, 'bookings');
        $user = $this->authUser($request);
        $booking = $this->bookingForVenue($request, $id);
        DB::table('bookings')->where('id', $booking->id)->update([
            'no_show_at' => now(),
            'no_show_marked_by_user_id' => $user->id,
            'checked_in_at' => null,
            'checked_in_by_user_id' => null,
            'updated_at' => now(),
        ]);
        $this->auditWrite($user->id, 'partner.booking.no_show', 'bookings', (string) $booking->id);

        return response()->json($this->bookingPayload($this->bookingForVenue($request, $id)));
    }

    public function clearNoShow(Request $request, string $id): JsonResponse
    {
        $this->requirePermission($request, 'bookings');
        $user = $this->authUser($request);
        $booking = $this->bookingForVenue($request, $id);
        DB::table('bookings')->where('id', $booking->id)->update([
            'no_show_at' => null,
            'no_show_marked_by_user_id' => null,
            'updated_at' => now(),
        ]);
        $this->auditWrite($user->id, 'partner.booking.no_show_clear', 'bookings', (string) $booking->id);

        return response()->json($this->bookingPayload($this->bookingForVenue($request, $id)));
    }

    public function checkInBooking(Request $request, string $id): JsonResponse
    {
        $this->requirePermission($request, 'bookings');
        $user = $this->authUser($request);
        $booking = $this->bookingForVenue($request, $id);
        DB::table('bookings')->where('id', $booking->id)->update([
            'checked_in_at' => now(),
            'checked_in_by_user_id' => $user->id,
            'no_show_at' => null,
            'no_show_marked_by_user_id' => null,
            'updated_at' => now(),
        ]);
        $this->auditWrite($user->id, 'partner.booking.check_in', 'bookings', (string) $booking->id);

        return response()->json($this->bookingPayload($this->bookingForVenue($request, $id)));
    }

    public function undoCheckInBooking(Request $request, string $id): JsonResponse
    {
        $this->requirePermission($request, 'bookings');
        $user = $this->authUser($request);
        $booking = $this->bookingForVenue($request, $id);
        DB::table('bookings')->where('id', $booking->id)->update([
            'checked_in_at' => null,
            'checked_in_by_user_id' => null,
            'updated_at' => now(),
        ]);
        $this->auditWrite($user->id, 'partner.booking.check_in_undo', 'bookings', (string) $booking->id);

        return response()->json($this->bookingPayload($this->bookingForVenue($request, $id)));
    }

    public function booking(Request $request, string $id): JsonResponse
    {
        return response()->json($this->bookingPayload($this->bookingForVenue($request, $id)));
    }

    public function updateBooking(Request $request, string $id): JsonResponse
    {
        $this->requirePermission($request, 'bookings');
        $booking = $this->bookingForVenue($request, $id);
        $data = $this->validateBody($request, [
            'starts_at' => ['sometimes', 'date'],
            'duration_minutes' => ['sometimes', 'integer', 'min:15', 'max:480'],
            'status' => ['sometimes', 'in:pending_payment,partially_paid,paid,cancelled,refunded,failed'],
            'payment_method' => ['sometimes', 'nullable', 'in:cash,bank_transfer,manual,onsite'],
            'payment_note' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'customer_name' => ['sometimes', 'nullable', 'string', 'max:120'],
            'customer_email' => ['sometimes', 'nullable', 'email', 'max:254'],
            'internal_note' => ['sometimes', 'nullable', 'string', 'max:5000'],
            'cancellation_reason' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'refund_status' => ['sometimes', 'nullable', 'in:pending_manual_review,approved,processed,rejected,not_required'],
            'refund_amount_minor' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:100000000'],
            'refund_note' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ]);
        if ($data === []) {
            throw ApiException::validation('Provide at least one field to update');
        }

        $court = DB::table('courts as c')
            ->join('venues as v', 'v.id', '=', 'c.venue_id')
            ->where('c.id', $booking->court_id)
            ->first(['c.*', 'v.opening_hours', 'v.booking_slot_minutes', 'v.min_booking_minutes', 'v.max_booking_minutes']);
        $starts = array_key_exists('starts_at', $data) ? CarbonImmutable::parse($data['starts_at']) : CarbonImmutable::parse($booking->starts_at);
        $duration = (int) ($data['duration_minutes'] ?? $booking->duration_minutes);
        if (array_key_exists('starts_at', $data) || array_key_exists('duration_minutes', $data)) {
            $this->assertVenueRules($court, $starts, $duration);
            $this->assertCourtAvailable((string) $booking->court_id, $starts, $starts->addMinutes($duration), $id);
            $data['starts_at'] = $starts;
            $data['duration_minutes'] = $duration;
            $data['total_minor'] = $this->bookingTotalMinor($court, $duration);
            $data['rescheduled_at'] = now();
            if ($booking->user_id !== null) {
                $this->enqueueNotification((string) $booking->user_id, 'system', 'Booking rescheduled', 'Your booking time was updated by the venue.', ['booking_id' => $booking->id, 'starts_at' => $starts->toIso8601String()]);
            }
        }
        if (($data['status'] ?? null) === 'paid') {
            $data['paid_at'] = now();
        }
        if (($data['status'] ?? null) === 'cancelled') {
            $data['cancelled_at'] = now();
            $data['cancelled_by_user_id'] = $this->authUser($request)->id;
        }
        if (($data['status'] ?? null) === 'refunded') {
            $data['refund_status'] = $data['refund_status'] ?? 'processed';
            $data['refunded_at'] = now();
        }

        DB::table('bookings')->where('id', $booking->id)->update([...$data, 'updated_at' => now()]);
        $this->auditWrite($this->authUser($request)->id, 'partner.booking.update', 'bookings', (string) $booking->id, [
            'fields' => array_keys($data),
        ]);

        return response()->json($this->bookingPayload($this->bookingForVenue($request, $id)));
    }

    public function bulkUpdateBookings(Request $request): JsonResponse
    {
        $this->requirePermission($request, 'bookings');
        $venueId = $this->venueId($request);
        $data = $this->validateBody($request, [
            'ids' => ['required', 'array', 'min:1', 'max:100'],
            'ids.*' => ['uuid'],
            'status' => ['required', 'in:pending_payment,partially_paid,paid,cancelled,refunded,failed'],
            'payment_method' => ['sometimes', 'nullable', 'in:cash,bank_transfer,manual,onsite'],
            'payment_note' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'cancellation_reason' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'refund_status' => ['sometimes', 'nullable', 'in:pending_manual_review,approved,processed,rejected,not_required'],
            'refund_amount_minor' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:100000000'],
            'refund_note' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ]);
        $ids = DB::table('bookings as b')
            ->join('courts as c', 'c.id', '=', 'b.court_id')
            ->where('c.venue_id', $venueId)
            ->whereIn('b.id', $data['ids'])
            ->pluck('b.id')
            ->all();
        $updates = ['status' => $data['status'], 'updated_at' => now()];
        if ($data['status'] === 'paid') {
            $updates['paid_at'] = now();
        }
        if ($data['status'] === 'cancelled') {
            $updates['cancelled_at'] = now();
            $updates['cancelled_by_user_id'] = $this->authUser($request)->id;
        }
        if ($data['status'] === 'refunded') {
            $updates['refund_status'] = $data['refund_status'] ?? 'processed';
            $updates['refunded_at'] = now();
        }
        if (array_key_exists('payment_method', $data)) {
            $updates['payment_method'] = $data['payment_method'];
        }
        if (array_key_exists('payment_note', $data)) {
            $updates['payment_note'] = $data['payment_note'];
        }
        foreach (['cancellation_reason', 'refund_status', 'refund_amount_minor', 'refund_note'] as $field) {
            if (array_key_exists($field, $data)) {
                $updates[$field] = $data[$field];
            }
        }

        $updated = $ids === [] ? 0 : DB::table('bookings')->whereIn('id', $ids)->update($updates);
        $this->auditWrite($this->authUser($request)->id, 'partner.booking.bulk_update', 'bookings', null, [
            'venue_id' => $venueId,
            'ids' => $ids,
            'updates' => $updates,
            'affected' => $updated,
        ]);

        return response()->json(['updated' => $updated]);
    }

    public function stats(Request $request): JsonResponse
    {
        $venueId = $this->venueId($request);
        $todayStart = now()->startOfDay();
        $todayEnd = now()->endOfDay();
        $bookings = DB::table('bookings as b')->join('courts as c', 'c.id', '=', 'b.court_id')->where('c.venue_id', $venueId);

        $courtsCount = DB::table('courts')->where('venue_id', $venueId)->count();
        $totalBookings = (clone $bookings)->count();
        $paidBookings = (clone $bookings)->where('b.status', 'paid')->count();
        $pendingBookings = (clone $bookings)->whereIn('b.status', ['pending_payment', 'partially_paid'])->count();
        $cancelledBookings = (clone $bookings)->whereIn('b.status', ['cancelled', 'refunded', 'failed'])->count();
        $revenuePaidMinor = (int) (clone $bookings)->where('b.status', 'paid')->sum('b.total_minor');
        $currency = DB::table('courts')->where('venue_id', $venueId)->value('currency') ?? 'AZN';

        // Occupancy over the next 7 days: booked (non-cancelled) slots vs an
        // approximate capacity of ~14 bookable hours/day per court.
        $upcoming7 = (clone $bookings)
            ->whereBetween('b.starts_at', [now(), now()->addDays(7)])
            ->whereNotIn('b.status', ['cancelled', 'refunded', 'failed'])
            ->count();
        $capacity = $courtsCount * 7 * 14;
        $occupancyRate = $capacity > 0 ? min(100, (int) round(100 * $upcoming7 / $capacity)) : 0;

        return response()->json([
            'courts' => $courtsCount,
            'bookings' => $totalBookings,
            'bookings_today' => (clone $bookings)->whereBetween('b.starts_at', [$todayStart, $todayEnd])->count(),
            'bookings_upcoming' => (clone $bookings)->where('b.starts_at', '>=', now())->whereNotIn('b.status', ['cancelled', 'refunded', 'failed'])->count(),
            'bookings_unpaid' => $pendingBookings,
            'revenue_paid_minor' => $revenuePaidMinor,
            'maintenance_blocks' => DB::table('court_blocks as cb')->join('courts as c', 'c.id', '=', 'cb.court_id')->where('c.venue_id', $venueId)->where('cb.ends_at', '>=', now())->count(),
            'staff_accounts' => DB::table('users')->where('admin_role', 'partner')->where('venue_id', $venueId)->whereNull('deleted_at')->count(),
            // Fields consumed by the owner overview KPIs:
            'total_bookings' => $totalBookings,
            'paid_bookings' => $paidBookings,
            'pending_bookings' => $pendingBookings,
            'cancelled_bookings' => $cancelledBookings,
            'total_revenue_minor' => $revenuePaidMinor,
            'currency' => $currency,
            'occupancy_rate' => $occupancyRate,
        ]);
    }

    public function calendar(Request $request): JsonResponse
    {
        $this->requirePermission($request, 'calendar');
        $venueId = $this->venueId($request);
        $from = CarbonImmutable::parse($request->query('from', now()->startOfWeek()->toIso8601String()));
        $to = CarbonImmutable::parse($request->query('to', now()->endOfWeek()->toIso8601String()));

        return response()->json([
            'items' => DB::table('bookings as b')
                ->join('courts as c', 'c.id', '=', 'b.court_id')
                ->leftJoin('users as u', 'u.id', '=', 'b.user_id')
                ->where('c.venue_id', $venueId)
                ->where('b.starts_at', '<=', $to)
                ->whereRaw("(b.starts_at + (b.duration_minutes || ' minutes')::interval) >= ?", [$from])
                ->orderBy('b.starts_at')
                ->get(['b.*', 'c.name as court_name', 'u.display_name as booker_display_name', 'u.email as booker_email']),
            'blocks' => DB::table('court_blocks as cb')
                ->join('courts as c', 'c.id', '=', 'cb.court_id')
                ->where('c.venue_id', $venueId)
                ->where('cb.starts_at', '<=', $to)
                ->where('cb.ends_at', '>=', $from)
                ->orderBy('cb.starts_at')
                ->get(['cb.*', 'c.name as court_name']),
        ]);
    }

    public function schedule(Request $request): JsonResponse
    {
        $this->requirePermission($request, 'calendar');
        $venueId = $this->venueId($request);
        $date = (string) $request->query('date', now('Asia/Baku')->format('Y-m-d'));
        $start = CarbonImmutable::parse($date.' 00:00', 'Asia/Baku')->utc();
        $end = $start->addDay();

        return response()->json([
            'date' => $date,
            'courts' => DB::table('courts')->where('venue_id', $venueId)->orderBy('name')->get(),
            'bookings' => DB::table('bookings as b')
                ->join('courts as c', 'c.id', '=', 'b.court_id')
                ->where('c.venue_id', $venueId)
                ->where('b.starts_at', '>=', $start)
                ->where('b.starts_at', '<', $end)
                ->orderBy('b.starts_at')
                ->get(['b.*', 'c.name as court_name']),
            'blocks' => DB::table('court_blocks as cb')
                ->join('courts as c', 'c.id', '=', 'cb.court_id')
                ->where('c.venue_id', $venueId)
                ->where('cb.starts_at', '<', $end)
                ->where('cb.ends_at', '>', $start)
                ->orderBy('cb.starts_at')
                ->get(['cb.*', 'c.name as court_name']),
        ]);
    }

    public function revenue(Request $request)
    {
        $this->requirePermission($request, 'revenue');
        $venueId = $this->venueId($request);
        $from = $request->query('from');
        $to = $request->query('to');
        $rows = DB::table('bookings as b')
            ->join('courts as c', 'c.id', '=', 'b.court_id')
            ->where('c.venue_id', $venueId)
            ->when($from, fn ($q) => $q->where('b.starts_at', '>=', $from))
            ->when($to, fn ($q) => $q->where('b.starts_at', '<=', $to))
            ->orderBy('b.starts_at')
            ->get(['b.id', 'b.starts_at', 'b.duration_minutes', 'b.total_minor', 'b.currency', 'b.status', 'b.payment_method', 'c.name as court_name']);
        if ($request->query('format') === 'csv') {
            $csv = "id,starts_at,court,status,payment_method,total_minor,currency\n";
            foreach ($rows as $row) {
                $csv .= implode(',', [
                    $row->id,
                    $row->starts_at,
                    '"'.str_replace('"', '""', (string) $row->court_name).'"',
                    $row->status,
                    $row->payment_method,
                    $row->total_minor,
                    $row->currency,
                ])."\n";
            }

            return Response::make($csv, 200, ['Content-Type' => 'text/csv']);
        }

        return response()->json([
            'items' => $rows,
            'paid_total_minor' => (int) $rows->where('status', 'paid')->sum('total_minor'),
            'unpaid_total_minor' => (int) $rows->whereIn('status', ['pending_payment', 'partially_paid'])->sum('total_minor'),
        ]);
    }

    public function tournaments(Request $request): JsonResponse
    {
        $this->requirePermission($request, 'tournaments');
        $venueId = $this->venueId($request);
        if ($request->query('sport') && ! in_array((string) $request->query('sport'), ['padel', 'tennis'], true)) {
            throw ApiException::validation('Unsupported sport');
        }
        $items = DB::table('tournaments as t')
            ->join('sports as s', 's.id', '=', 't.sport_id')
            ->leftJoin('venues as v', 'v.id', '=', 't.venue_id')
            ->where('t.venue_id', $venueId)
            ->whereIn('s.slug', ['padel', 'tennis'])
            ->when($request->query('status'), fn ($q, $status) => $q->where('t.status', $status))
            ->when($request->query('sport'), fn ($q, $sport) => $q->where('s.slug', $sport))
            ->orderByDesc('t.starts_at')
            ->limit(min(max((int) $request->query('limit', 50), 1), 100))
            ->get(['t.*', 's.slug as sport_slug', 's.name as sport_name', 'v.name as venue_name'])
            ->map(fn ($tournament) => $this->tournamentPayload($tournament))
            ->values();

        return response()->json(['items' => $items]);
    }

    public function tournament(Request $request, string $id): JsonResponse
    {
        $this->requirePermission($request, 'tournaments');
        $venueId = $this->venueId($request);
        $tournament = $this->tournamentForVenue($venueId, $id);

        return response()->json([
            ...$this->tournamentPayload($tournament),
            'entries' => $this->tournamentEntriesPayload($id),
        ]);
    }

    public function createTournament(Request $request): JsonResponse
    {
        $this->requirePermission($request, 'tournaments');
        $venueId = $this->venueId($request);
        $data = $this->validateBody($request, [
            'name' => ['required', 'string', 'min:2', 'max:160'],
            'description' => ['sometimes', 'nullable', 'string', 'max:4000'],
            'sport_id' => ['required', 'uuid'],
            'starts_at' => ['required', 'date'],
            'ends_at' => ['required', 'date'],
            'registration_deadline' => ['sometimes', 'nullable', 'date'],
            'max_squads' => ['required', 'integer', 'min:2', 'max:256'],
            'squad_size' => ['required', 'integer', 'min:1', 'max:20'],
            'entry_fee_minor' => ['sometimes', 'integer', 'min:0'],
            'currency' => ['sometimes', 'string', 'size:3'],
            'status' => ['sometimes', 'in:announced,registration_open,registration_closed,in_progress,completed,cancelled'],
        ]);
        if (! DB::table('sports')->where('id', $data['sport_id'])->whereIn('slug', ['padel', 'tennis'])->exists()) {
            throw ApiException::validation('Unknown sport_id');
        }
        $this->assertTournamentDateWindow($data);
        $id = (string) Str::uuid();
        DB::table('tournaments')->insert([
            'id' => $id,
            'name' => $data['name'],
            'description' => $data['description'] ?? null,
            'sport_id' => $data['sport_id'],
            'venue_id' => $venueId,
            'starts_at' => $data['starts_at'],
            'ends_at' => $data['ends_at'],
            'registration_deadline' => $data['registration_deadline'] ?? null,
            'max_squads' => $data['max_squads'],
            'squad_size' => $data['squad_size'],
            'entry_fee_minor' => $data['entry_fee_minor'] ?? 0,
            'currency' => strtoupper($data['currency'] ?? 'AZN'),
            'status' => $data['status'] ?? 'announced',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->auditWrite($this->authUser($request)->id, 'partner.tournament.create', 'tournaments', $id, [
            'venue_id' => $venueId,
            'name' => $data['name'],
        ]);

        return $this->tournament($request, $id);
    }

    public function updateTournament(Request $request, string $id): JsonResponse
    {
        $this->requirePermission($request, 'tournaments');
        $venueId = $this->venueId($request);
        $existing = $this->tournamentForVenue($venueId, $id);
        $data = $this->validateBody($request, [
            'name' => ['sometimes', 'string', 'min:2', 'max:160'],
            'description' => ['sometimes', 'nullable', 'string', 'max:4000'],
            'sport_id' => ['sometimes', 'uuid'],
            'starts_at' => ['sometimes', 'date'],
            'ends_at' => ['sometimes', 'date'],
            'registration_deadline' => ['sometimes', 'nullable', 'date'],
            'max_squads' => ['sometimes', 'integer', 'min:2', 'max:256'],
            'squad_size' => ['sometimes', 'integer', 'min:1', 'max:20'],
            'entry_fee_minor' => ['sometimes', 'integer', 'min:0'],
            'currency' => ['sometimes', 'string', 'size:3'],
            'status' => ['sometimes', 'in:announced,registration_open,registration_closed,in_progress,completed,cancelled'],
        ]);
        if ($data === []) {
            throw ApiException::validation('Provide at least one field to update');
        }
        if (isset($data['sport_id']) && ! DB::table('sports')->where('id', $data['sport_id'])->whereIn('slug', ['padel', 'tennis'])->exists()) {
            throw ApiException::validation('Unknown sport_id');
        }
        if (isset($data['currency'])) {
            $data['currency'] = strtoupper($data['currency']);
        }
        $this->assertTournamentDateWindow($data, $existing);
        $updated = DB::table('tournaments')->where('id', $id)->where('venue_id', $venueId)->update([...$data, 'updated_at' => now()]);
        if ($updated === 0) {
            throw ApiException::notFound('Tournament not found');
        }
        $this->auditWrite($this->authUser($request)->id, 'partner.tournament.update', 'tournaments', $id, [
            'venue_id' => $venueId,
            'fields' => array_keys($data),
        ]);

        return $this->tournament($request, $id);
    }

    public function cancelTournament(Request $request, string $id): JsonResponse
    {
        $this->requirePermission($request, 'tournaments');
        $venueId = $this->venueId($request);
        $this->tournamentForVenue($venueId, $id);
        DB::table('tournaments')->where('id', $id)->where('venue_id', $venueId)->update(['status' => 'cancelled', 'updated_at' => now()]);
        $this->auditWrite($this->authUser($request)->id, 'partner.tournament.cancel', 'tournaments', $id, [
            'venue_id' => $venueId,
        ]);

        return $this->tournament($request, $id);
    }

    public function tournamentEntries(Request $request, string $id): JsonResponse
    {
        $this->requirePermission($request, 'tournaments');
        $venueId = $this->venueId($request);
        $this->tournamentForVenue($venueId, $id);

        return response()->json(['items' => $this->tournamentEntriesPayload($id)]);
    }

    public function updateTournamentEntry(Request $request, string $id, string $entryId): JsonResponse
    {
        $this->requirePermission($request, 'tournaments');
        $venueId = $this->venueId($request);
        $this->tournamentForVenue($venueId, $id);
        $data = $this->validateBody($request, [
            'status' => ['required', 'in:pending,confirmed,withdrawn,disqualified'],
        ]);
        $updated = DB::table('tournament_entries')->where('tournament_id', $id)->where('id', $entryId)->update(['status' => $data['status']]);
        if ($updated === 0) {
            throw ApiException::notFound('Tournament entry not found');
        }
        $this->auditWrite($this->authUser($request)->id, 'partner.tournament_entry.update', 'tournament_entries', $entryId, [
            'tournament_id' => $id,
            'venue_id' => $venueId,
            'status' => $data['status'],
        ]);

        return response()->json($this->tournamentEntryPayload(DB::table('tournament_entries as e')->join('users as u', 'u.id', '=', 'e.captain_user_id')->where('e.id', $entryId)->first(['e.*', 'u.display_name as captain_display_name', 'u.photo_url as captain_photo_url', 'u.email as captain_email'])));
    }

    public function rules(Request $request): JsonResponse
    {
        $venue = DB::table('venues')->where('id', $this->venueId($request))->first();

        return response()->json([
            'opening_hours' => json_decode((string) ($venue->opening_hours ?? ''), true) ?: null,
            'booking_slot_minutes' => (int) ($venue->booking_slot_minutes ?? 30),
            'min_booking_minutes' => (int) ($venue->min_booking_minutes ?? 60),
            'max_booking_minutes' => (int) ($venue->max_booking_minutes ?? 120),
            'cancellation_window_minutes' => (int) ($venue->cancellation_window_minutes ?? 120),
        ]);
    }

    public function updateRules(Request $request): JsonResponse
    {
        $this->requirePermission($request, 'venue_settings');
        $venueId = $this->venueId($request);
        $data = $this->validateBody($request, [
            'opening_hours' => ['nullable', 'array'],
            'booking_slot_minutes' => ['nullable', 'integer', 'min:15', 'max:240'],
            'min_booking_minutes' => ['nullable', 'integer', 'min:15', 'max:480'],
            'max_booking_minutes' => ['nullable', 'integer', 'min:15', 'max:480'],
            'cancellation_window_minutes' => ['nullable', 'integer', 'min:0', 'max:10080'],
        ]);
        $updates = ['updated_at' => now()];
        foreach (['booking_slot_minutes', 'min_booking_minutes', 'max_booking_minutes', 'cancellation_window_minutes'] as $field) {
            if (array_key_exists($field, $data)) {
                $updates[$field] = $data[$field];
            }
        }
        if (array_key_exists('opening_hours', $data)) {
            $updates['opening_hours'] = json_encode($data['opening_hours']);
        }
        DB::table('venues')->where('id', $venueId)->update($updates);
        $this->auditWrite($this->authUser($request)->id, 'partner.rules.update', 'venues', $venueId, [
            'fields' => array_keys($updates),
        ]);

        return $this->rules($request);
    }

    public function blocks(Request $request): JsonResponse
    {
        $this->requirePermission($request, 'maintenance');
        $venueId = $this->venueId($request);

        return response()->json(['items' => DB::table('court_blocks as cb')->join('courts as c', 'c.id', '=', 'cb.court_id')->where('c.venue_id', $venueId)->orderByDesc('cb.starts_at')->get(['cb.*', 'c.name as court_name'])]);
    }

    public function createBlock(Request $request): JsonResponse
    {
        $this->requirePermission($request, 'maintenance');
        $venueId = $this->venueId($request);
        $data = $this->validateBody($request, [
            'court_id' => ['required', 'uuid'],
            'starts_at' => ['required', 'date'],
            'ends_at' => ['required', 'date'],
            'reason' => ['nullable', 'string', 'max:160'],
        ]);
        if (! DB::table('courts')->where('id', $data['court_id'])->where('venue_id', $venueId)->exists()) {
            throw ApiException::notFound('Court not found');
        }
        $starts = CarbonImmutable::parse($data['starts_at']);
        $ends = CarbonImmutable::parse($data['ends_at']);
        if ($ends <= $starts) {
            throw ApiException::validation('ends_at must be after starts_at');
        }
        if (! (bool) $request->input('force', false) && DB::table('bookings')->where('court_id', $data['court_id'])->whereIn('status', ['pending_payment', 'partially_paid', 'paid'])->where('starts_at', '<', $ends)->whereRaw("(starts_at + (duration_minutes || ' minutes')::interval) > ?", [$starts])->exists()) {
            throw ApiException::conflict('Court has bookings in this maintenance window');
        }
        $id = (string) Str::uuid();
        DB::table('court_blocks')->insert([
            'id' => $id,
            'court_id' => $data['court_id'],
            'created_by_user_id' => $this->authUser($request)->id,
            'starts_at' => $starts,
            'ends_at' => $ends,
            'reason' => $data['reason'] ?? null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->auditWrite($this->authUser($request)->id, 'partner.court_block.create', 'court_blocks', $id, [
            'court_id' => $data['court_id'],
            'venue_id' => $venueId,
        ]);

        return response()->json(DB::table('court_blocks')->where('id', $id)->first(), 201);
    }

    public function updateBlock(Request $request, string $id): JsonResponse
    {
        $this->requirePermission($request, 'maintenance');
        $venueId = $this->venueId($request);
        $block = DB::table('court_blocks as cb')
            ->join('courts as c', 'c.id', '=', 'cb.court_id')
            ->where('cb.id', $id)
            ->where('c.venue_id', $venueId)
            ->first(['cb.*']);
        if ($block === null) {
            throw ApiException::notFound('Block not found');
        }
        $data = $this->validateBody($request, [
            'starts_at' => ['sometimes', 'date'],
            'ends_at' => ['sometimes', 'date'],
            'reason' => ['sometimes', 'nullable', 'string', 'max:160'],
            'force' => ['sometimes', 'boolean'],
        ]);
        if ($data === []) {
            throw ApiException::validation('Provide at least one field to update');
        }
        $starts = array_key_exists('starts_at', $data) ? CarbonImmutable::parse($data['starts_at']) : CarbonImmutable::parse($block->starts_at);
        $ends = array_key_exists('ends_at', $data) ? CarbonImmutable::parse($data['ends_at']) : CarbonImmutable::parse($block->ends_at);
        if ($ends <= $starts) {
            throw ApiException::validation('ends_at must be after starts_at');
        }
        if (! (bool) ($data['force'] ?? false) && DB::table('bookings')->where('court_id', $block->court_id)->whereIn('status', ['pending_payment', 'partially_paid', 'paid'])->where('starts_at', '<', $ends)->whereRaw("(starts_at + (duration_minutes || ' minutes')::interval) > ?", [$starts])->exists()) {
            throw ApiException::conflict('Court has bookings in this maintenance window');
        }
        $updates = [
            'starts_at' => $starts,
            'ends_at' => $ends,
            'updated_at' => now(),
        ];
        if (array_key_exists('reason', $data)) {
            $updates['reason'] = $data['reason'];
        }
        DB::table('court_blocks')->where('id', $id)->update($updates);
        $this->auditWrite($this->authUser($request)->id, 'partner.court_block.update', 'court_blocks', $id, [
            'court_id' => $block->court_id,
            'venue_id' => $venueId,
            'fields' => array_keys($updates),
        ]);

        return response()->json(DB::table('court_blocks')->where('id', $id)->first());
    }

    public function deleteBlock(Request $request, string $id): JsonResponse
    {
        $this->requirePermission($request, 'maintenance');
        $venueId = $this->venueId($request);
        DB::table('court_blocks')
            ->where('id', $id)
            ->whereIn('court_id', DB::table('courts')->where('venue_id', $venueId)->pluck('id')->all())
            ->delete();
        $this->auditWrite($this->authUser($request)->id, 'partner.court_block.delete', 'court_blocks', $id, [
            'venue_id' => $venueId,
        ]);

        return response()->json(null, 204);
    }

    public function staff(Request $request): JsonResponse
    {
        $this->requirePermission($request, 'staff');
        $venueId = $this->venueId($request);

        return response()->json([
            'items' => DB::table('users')
                ->where('admin_role', 'partner')
                ->where('venue_id', $venueId)
                ->orderByDesc('created_at')
                ->get(['id', 'email', 'display_name', 'admin_role', 'venue_id', 'staff_title', 'staff_permissions', 'deleted_at', 'created_at', 'updated_at'])
                ->map(fn ($user) => $this->staffPayload($user))
                ->values(),
            'permission_options' => $this->staffPermissionOptions(),
        ]);
    }

    public function updateStaff(Request $request, string $id): JsonResponse
    {
        $this->requirePermission($request, 'staff');
        $venueId = $this->venueId($request);
        $data = $this->validateBody($request, [
            'display_name' => ['sometimes', 'string', 'min:1', 'max:80'],
            'password' => ['sometimes', 'string', 'min:8', 'max:200'],
            'staff_title' => ['sometimes', 'nullable', 'string', 'max:80'],
            'staff_permissions' => ['sometimes', 'nullable', 'array'],
            'restore' => ['sometimes', 'boolean'],
        ]);
        if ($data === []) {
            throw ApiException::validation('Provide at least one field to update');
        }
        $updates = ['updated_at' => now()];
        if (isset($data['display_name'])) {
            $updates['display_name'] = trim($data['display_name']);
        }
        if (isset($data['password'])) {
            $updates['password_hash'] = app(PasswordService::class)->hash($data['password']);
        }
        if (array_key_exists('staff_title', $data)) {
            $updates['staff_title'] = $data['staff_title'] !== null ? trim($data['staff_title']) : null;
        }
        if (array_key_exists('staff_permissions', $data)) {
            $updates['staff_permissions'] = json_encode($this->normalizeStaffPermissions($data['staff_permissions']));
        }
        if (($data['restore'] ?? false) === true) {
            $updates['deleted_at'] = null;
        }
        $updated = DB::table('users')->where('id', $id)->where('venue_id', $venueId)->where('admin_role', 'partner')->update($updates);
        if ($updated === 0) {
            throw ApiException::notFound('Staff account not found');
        }
        $this->auditWrite($this->authUser($request)->id, 'partner.staff.update', 'users', $id, [
            'venue_id' => $venueId,
            'fields' => array_values(array_diff(array_keys($updates), ['password_hash'])),
        ]);

        return response()->json($this->staffPayload(DB::table('users')->where('id', $id)->first(['id', 'email', 'display_name', 'admin_role', 'venue_id', 'staff_title', 'staff_permissions', 'deleted_at', 'created_at', 'updated_at'])));
    }

    public function createStaff(Request $request): JsonResponse
    {
        $this->requirePermission($request, 'staff');
        $venueId = $this->venueId($request);
        $data = $this->validateBody($request, [
            'email' => ['required', 'email', 'max:254'],
            'display_name' => ['required', 'string', 'min:1', 'max:80'],
            'password' => ['required', 'string', 'min:8', 'max:200'],
            'staff_title' => ['sometimes', 'nullable', 'string', 'max:80'],
            'staff_permissions' => ['sometimes', 'nullable', 'array'],
        ]);
        $email = mb_strtolower(trim($data['email']));
        if (DB::table('users')->where('email', $email)->exists()) {
            throw ApiException::conflict('Email is already registered');
        }
        $id = (string) Str::uuid();
        DB::table('users')->insert([
            'id' => $id,
            'email' => $email,
            'password_hash' => app(PasswordService::class)->hash($data['password']),
            'display_name' => trim($data['display_name']),
            'admin_role' => 'partner',
            'venue_id' => $venueId,
            'staff_title' => isset($data['staff_title']) ? trim((string) $data['staff_title']) : 'Venue staff',
            'staff_permissions' => json_encode($this->normalizeStaffPermissions($data['staff_permissions'] ?? null)),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->auditWrite($this->authUser($request)->id, 'partner.staff.create', 'users', $id, [
            'venue_id' => $venueId,
            'email' => $email,
        ]);

        return response()->json($this->staffPayload(DB::table('users')->where('id', $id)->first(['id', 'email', 'display_name', 'admin_role', 'venue_id', 'staff_title', 'staff_permissions', 'deleted_at', 'created_at', 'updated_at'])), 201);
    }

    public function deleteStaff(Request $request, string $id): JsonResponse
    {
        $this->requirePermission($request, 'staff');
        $venueId = $this->venueId($request);
        DB::table('users')->where('id', $id)->where('venue_id', $venueId)->where('admin_role', 'partner')->update(['deleted_at' => now(), 'updated_at' => now()]);
        $this->auditWrite($this->authUser($request)->id, 'partner.staff.delete', 'users', $id, [
            'venue_id' => $venueId,
        ]);

        return response()->json(null, 204);
    }

    private function venueId(Request $request): string
    {
        $user = $this->authUser($request);
        if ($user->admin_role !== 'partner') {
            throw ApiException::forbidden('Partner access required');
        }
        if ($user->venue_id === null) {
            throw ApiException::validation('Partner user has no venue_id');
        }

        return $user->venue_id;
    }

    private function requirePermission(Request $request, string $permission): void
    {
        if (! $this->canPermission($request, $permission)) {
            throw ApiException::forbidden('Owner permission required: '.$permission);
        }
    }

    private function canPermission(Request $request, string $permission): bool
    {
        $user = $this->authUser($request);
        $venueId = $this->venueId($request);
        $permissions = $this->permissionsForUser($user, $venueId);

        return (bool) ($permissions[$permission] ?? false);
    }

    private function permissionsForUser(object $user, string $venueId): array
    {
        $permissions = $this->normalizeStaffPermissions(json_decode((string) ($user->staff_permissions ?? ''), true) ?: null);
        if ($this->isVenueOwner($user, $venueId)) {
            return array_map(fn () => true, $permissions);
        }

        return $permissions;
    }

    private function isVenueOwner(object $user, string $venueId): bool
    {
        return DB::table('venues')->where('id', $venueId)->where('owner_user_id', $user->id)->exists();
    }

    private function staffPayload(object $user): array
    {
        return [
            'id' => (string) $user->id,
            'email' => (string) $user->email,
            'display_name' => (string) $user->display_name,
            'admin_role' => (string) $user->admin_role,
            'venue_id' => $user->venue_id ? (string) $user->venue_id : null,
            'staff_title' => $user->staff_title ?? null,
            'staff_permissions' => $this->normalizeStaffPermissions(json_decode((string) ($user->staff_permissions ?? ''), true) ?: null),
            'deleted_at' => $this->iso($user->deleted_at),
            'created_at' => $this->iso($user->created_at),
            'updated_at' => $this->iso($user->updated_at ?? null),
        ];
    }

    private function staffPermissionOptions(): array
    {
        return array_keys($this->defaultStaffPermissions());
    }

    private function defaultStaffPermissions(): array
    {
        return [
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
    }

    private function normalizeStaffPermissions(?array $permissions): array
    {
        $base = $this->defaultStaffPermissions();
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

    private function bookingForVenue(Request $request, string $id): object
    {
        $booking = DB::table('bookings as b')
            ->join('courts as c', 'c.id', '=', 'b.court_id')
            ->leftJoin('users as u', 'u.id', '=', 'b.user_id')
            ->where('b.id', $id)
            ->where('c.venue_id', $this->venueId($request))
            ->first(['b.*', 'c.name as court_name', 'c.venue_id', 'u.display_name as booker_display_name', 'u.email as booker_email']);
        if ($booking === null) {
            throw ApiException::notFound('Booking not found');
        }

        return $booking;
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

    private function bookingPayload(object $booking): array
    {
        return [
            ...((array) $booking),
            'starts_at' => $this->iso($booking->starts_at ?? null),
            'created_at' => $this->iso($booking->created_at ?? null),
            'updated_at' => $this->iso($booking->updated_at ?? null),
            'paid_at' => $this->iso($booking->paid_at ?? null),
            'cancelled_at' => $this->iso($booking->cancelled_at ?? null),
            'cancelled_by_user_id' => $booking->cancelled_by_user_id ?? null,
            'cancellation_reason' => $booking->cancellation_reason ?? null,
            'rescheduled_at' => $this->iso($booking->rescheduled_at ?? null),
            'no_show_at' => $this->iso($booking->no_show_at ?? null),
            'checked_in_at' => $this->iso($booking->checked_in_at ?? null),
            'checked_in_by_user_id' => $booking->checked_in_by_user_id ?? null,
            'internal_note' => $booking->internal_note ?? null,
            'refund_status' => $booking->refund_status ?? null,
            'refund_amount_minor' => $booking->refund_amount_minor ?? null,
            'refund_note' => $booking->refund_note ?? null,
            'refunded_at' => $this->iso($booking->refunded_at ?? null),
        ];
    }

    private function courtPayload(object $court): array
    {
        return [
            'id' => (string) $court->id,
            'venue_id' => (string) $court->venue_id,
            'sport_id' => (string) $court->sport_id,
            'sport_slug' => (string) $court->sport_slug,
            'sport_name' => $court->sport_name ?? null,
            'name' => (string) $court->name,
            'hourly_price_minor' => (int) $court->hourly_price_minor,
            'currency' => trim((string) $court->currency),
            'status' => $court->status ?? 'active',
            'photo_url' => $court->photo_url ?? null,
            'photo_urls' => $this->jsonArray($court->photo_urls ?? null),
            'created_at' => $this->iso($court->created_at),
        ];
    }

    private function venuePayload(?object $venue): ?array
    {
        if ($venue === null) {
            return null;
        }

        return [
            'id' => (string) $venue->id,
            'name' => (string) $venue->name,
            'address' => $venue->address ?? null,
            'lat' => $venue->lat !== null ? (float) $venue->lat : null,
            'lng' => $venue->lng !== null ? (float) $venue->lng : null,
            'is_partner' => (bool) $venue->is_partner,
            'phone' => $venue->phone ?? null,
            'description' => $venue->description ?? null,
            'photo_url' => $venue->photo_url ?? null,
            'photo_urls' => $this->jsonArray($venue->photo_urls ?? null),
            'status' => $venue->status ?? 'published',
            'opening_hours' => json_decode((string) ($venue->opening_hours ?? ''), true) ?: null,
            'booking_slot_minutes' => (int) ($venue->booking_slot_minutes ?? 30),
            'min_booking_minutes' => (int) ($venue->min_booking_minutes ?? 60),
            'max_booking_minutes' => (int) ($venue->max_booking_minutes ?? 120),
            'cancellation_window_minutes' => (int) ($venue->cancellation_window_minutes ?? 120),
            'created_at' => $this->iso($venue->created_at ?? null),
            'updated_at' => $this->iso($venue->updated_at ?? null),
        ];
    }

    private function bookingTotalMinor(object $court, int $durationMinutes): int
    {
        return (int) round(((int) $court->hourly_price_minor) * $durationMinutes / 60);
    }

    private function enqueueNotification(string $userId, string $type, string $title, string $body, array $payload = []): void
    {
        DB::table('notifications')->insert([
            'id' => (string) Str::uuid(),
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

    private function assertCourtAvailable(string $courtId, CarbonImmutable $starts, CarbonImmutable $ends, ?string $ignoreBookingId = null): void
    {
        if (DB::table('bookings')->where('court_id', $courtId)->when($ignoreBookingId, fn ($q) => $q->where('id', '!=', $ignoreBookingId))->whereIn('status', ['pending_payment', 'partially_paid', 'paid'])->where('starts_at', '<', $ends)->whereRaw("(starts_at + (duration_minutes || ' minutes')::interval) > ?", [$starts])->exists()) {
            throw ApiException::conflict('Court is already booked for this time');
        }
        if (DB::table('court_blocks')->where('court_id', $courtId)->where('starts_at', '<', $ends)->where('ends_at', '>', $starts)->exists()) {
            throw ApiException::conflict('Court is unavailable for this time');
        }
    }

    private function assertVenueRules(object $court, CarbonImmutable $starts, int $duration): void
    {
        $slot = max(15, (int) ($court->booking_slot_minutes ?? 30));
        $min = max(15, (int) ($court->min_booking_minutes ?? 60));
        $max = max(15, (int) ($court->max_booking_minutes ?? 120));
        if ($duration < $min || $duration > $max || $duration % $slot !== 0) {
            throw ApiException::validation('Booking duration is outside venue rules');
        }
        $hours = json_decode((string) ($court->opening_hours ?? ''), true) ?: [];
        $localDate = $starts->setTimezone('Asia/Baku')->format('Y-m-d');
        $day = (string) CarbonImmutable::parse($localDate, 'Asia/Baku')->dayOfWeekIso;
        $rule = $hours[$day] ?? null;
        if (is_array($rule) && ($rule['closed'] ?? false)) {
            throw ApiException::conflict('Venue is closed on this day');
        }
        $open = is_array($rule) ? ($rule['open'] ?? '07:00') : '07:00';
        $close = is_array($rule) ? ($rule['close'] ?? '23:00') : '23:00';
        $openAt = CarbonImmutable::parse($localDate.' '.$open, 'Asia/Baku');
        $closeAt = CarbonImmutable::parse($localDate.' '.$close, 'Asia/Baku');
        $localStarts = $starts->setTimezone('Asia/Baku');
        if ($localStarts < $openAt || $localStarts->addMinutes($duration) > $closeAt) {
            throw ApiException::conflict('Booking is outside venue opening hours');
        }
    }

    private function venuePolicy(object $venue): array
    {
        return [
            'opening_hours' => json_decode((string) ($venue->opening_hours ?? ''), true) ?: [],
            'slot_minutes' => max(15, (int) ($venue->booking_slot_minutes ?? 30)),
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

    private function availabilitySlots(string $courtId, CarbonImmutable $start, CarbonImmutable $end, int $slotMinutes, $bookings, $blocks): array
    {
        $slots = [];
        for ($slot = $start; $slot < $end; $slot = $slot->addMinutes($slotMinutes)) {
            $slotEnd = $slot->addMinutes($slotMinutes);
            $match = ($bookings->get($courtId) ?? collect())->first(function ($booking) use ($slot, $slotEnd) {
                $bookingStart = CarbonImmutable::parse($booking->starts_at);
                $bookingEnd = $bookingStart->addMinutes((int) $booking->duration_minutes);

                return $bookingStart < $slotEnd && $bookingEnd > $slot;
            });
            $block = ($blocks->get($courtId) ?? collect())->first(function ($blocked) use ($slot, $slotEnd) {
                $blockedStart = CarbonImmutable::parse($blocked->starts_at);
                $blockedEnd = CarbonImmutable::parse($blocked->ends_at);

                return $blockedStart < $slotEnd && $blockedEnd > $slot;
            });
            $slots[] = [
                'start_at' => $slot->utc()->toIso8601ZuluString('millisecond'),
                'end_at' => $slotEnd->utc()->toIso8601ZuluString('millisecond'),
                'status' => $block !== null ? 'blocked' : ($match === null ? 'free' : 'booked'),
                'booking_id' => $match->id ?? null,
                'block_id' => $block->id ?? null,
                'reason' => $block->reason ?? null,
            ];
        }

        return $slots;
    }

    private function jsonArray(mixed $value): array
    {
        if ($value === null || $value === '' || $value === '{}') {
            return [];
        }
        if (is_array($value)) {
            return array_values($value);
        }
        $decoded = json_decode((string) $value, true);
        if (is_array($decoded)) {
            return array_values($decoded);
        }

        return array_values(array_filter(str_getcsv(trim((string) $value, '{}'))));
    }

    private function pgTextArrayLiteral(?array $values): string
    {
        if ($values === null || $values === []) {
            return '{}';
        }

        return '{'.implode(',', array_map(function ($value) {
            return '"'.str_replace(['\\', '"'], ['\\\\', '\\"'], (string) $value).'"';
        }, array_values($values))).'}';
    }

    private function tournamentForVenue(string $venueId, string $id): object
    {
        $tournament = DB::table('tournaments as t')
            ->join('sports as s', 's.id', '=', 't.sport_id')
            ->leftJoin('venues as v', 'v.id', '=', 't.venue_id')
            ->where('t.id', $id)
            ->where('t.venue_id', $venueId)
            ->whereIn('s.slug', ['padel', 'tennis'])
            ->first(['t.*', 's.slug as sport_slug', 's.name as sport_name', 'v.name as venue_name']);
        if ($tournament === null) {
            throw ApiException::notFound('Tournament not found');
        }

        return $tournament;
    }

    private function assertTournamentDateWindow(array $data, ?object $existing = null): void
    {
        $startsAt = array_key_exists('starts_at', $data) ? $data['starts_at'] : ($existing->starts_at ?? null);
        $endsAt = array_key_exists('ends_at', $data) ? $data['ends_at'] : ($existing->ends_at ?? null);
        $deadline = array_key_exists('registration_deadline', $data) ? $data['registration_deadline'] : ($existing->registration_deadline ?? null);

        if ($startsAt !== null && $endsAt !== null && CarbonImmutable::parse($endsAt)->lt(CarbonImmutable::parse($startsAt))) {
            throw ApiException::validation('ends_at must be after or equal to starts_at');
        }
        if ($deadline !== null && $startsAt !== null && CarbonImmutable::parse($deadline)->gt(CarbonImmutable::parse($startsAt))) {
            throw ApiException::validation('registration_deadline must be before or equal to starts_at');
        }
    }

    private function tournamentPayload(object $t): array
    {
        return [
            'id' => (string) $t->id,
            'name' => (string) $t->name,
            'description' => $t->description,
            'sport_id' => (string) $t->sport_id,
            'sport_slug' => $t->sport_slug ?? null,
            'sport_name' => $t->sport_name ?? null,
            'venue_id' => $t->venue_id ? (string) $t->venue_id : null,
            'venue_name' => $t->venue_name ?? null,
            'starts_at' => $this->iso($t->starts_at),
            'ends_at' => $this->iso($t->ends_at),
            'registration_deadline' => $this->iso($t->registration_deadline),
            'max_squads' => (int) $t->max_squads,
            'squad_size' => (int) $t->squad_size,
            'entry_fee_minor' => (int) $t->entry_fee_minor,
            'currency' => trim((string) $t->currency),
            'status' => (string) $t->status,
            'entries_count' => DB::table('tournament_entries')->where('tournament_id', $t->id)->where('status', '!=', 'withdrawn')->count(),
            'created_at' => $this->iso($t->created_at),
            'updated_at' => $this->iso($t->updated_at ?? null),
        ];
    }

    private function tournamentEntriesPayload(string $tournamentId)
    {
        return DB::table('tournament_entries as e')
            ->join('users as u', 'u.id', '=', 'e.captain_user_id')
            ->where('e.tournament_id', $tournamentId)
            ->orderByDesc('e.created_at')
            ->get(['e.*', 'u.display_name as captain_display_name', 'u.photo_url as captain_photo_url', 'u.email as captain_email'])
            ->map(fn ($entry) => $this->tournamentEntryPayload($entry))
            ->values();
    }

    private function tournamentEntryPayload(object $entry): array
    {
        return [
            'id' => (string) $entry->id,
            'tournament_id' => (string) $entry->tournament_id,
            'captain_user_id' => (string) $entry->captain_user_id,
            'captain_display_name' => $entry->captain_display_name ?? null,
            'captain_photo_url' => $entry->captain_photo_url ?? null,
            'captain_email' => $entry->captain_email ?? null,
            'squad_name' => (string) $entry->squad_name,
            'player_ids' => $this->jsonArray($entry->player_ids ?? null),
            'status' => (string) $entry->status,
            'created_at' => $this->iso($entry->created_at),
        ];
    }
}
