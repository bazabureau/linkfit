<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\AuthorizesAdminPermissions;
use App\Support\ApiException;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class PaymentsController extends ApiController
{
    use AuthorizesAdminPermissions;

    public function history(Request $request): JsonResponse
    {
        $this->assertPaymentHistoryAvailable();

        $user = $this->authUser($request);
        $query = $this->validateQuery($request, [
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
            'offset' => ['nullable', 'integer', 'min:0'],
            'type' => ['nullable', 'in:all,booking,tournament'],
            'status' => ['nullable', 'string', 'max:40'],
        ]);

        $type = $query['type'] ?? 'all';
        $items = collect();
        if ($type === 'all' || $type === 'booking') {
            $items = $items->merge($this->bookingPayments($user->id, $query['status'] ?? null));
        }
        if ($type === 'all' || $type === 'tournament') {
            $items = $items->merge($this->tournamentPayments($user->id, $query['status'] ?? null));
        }

        $items = $items->sortByDesc('created_at')->values();
        $total = $items->count();
        $limit = (int) ($query['limit'] ?? 30);
        $offset = (int) ($query['offset'] ?? 0);

        return response()->json([
            'items' => $items->slice($offset, $limit)->values(),
            'pagination' => [
                'limit' => $limit,
                'offset' => $offset,
                'total' => $total,
            ],
            'summary' => $this->paymentSummaryForItems($items),
        ]);
    }

    public function summary(Request $request): JsonResponse
    {
        $this->assertPaymentHistoryAvailable();

        $user = $this->authUser($request);
        $items = $this->bookingPayments($user->id, null)->merge($this->tournamentPayments($user->id, null));

        return response()->json($this->paymentSummaryForItems($items));
    }

    public function bookingIntent(Request $request, string $id): JsonResponse
    {
        $this->assertPaymentIntentAvailable();

        $user = $this->authUser($request);
        // A non-UUID {id} would otherwise reach Postgres and surface as a raw
        // 22P02 QueryException → generic 500 + error-log noise. Treat a malformed
        // id as a clean "not found" (same 404 the app already gets for a missing
        // booking), and never let client input hit the DB driver as bad SQL.
        if (! Str::isUuid($id)) {
            throw ApiException::notFound('Booking not found');
        }
        $booking = DB::table('bookings')->where('id', $id)->first();
        if ($booking === null) {
            throw ApiException::notFound('Booking not found');
        }
        $operatorAction = $booking->user_id !== $user->id;
        if ($operatorAction && ! $this->canManageBookingPayment($request, $user, $booking)) {
            throw ApiException::forbidden('Forbidden');
        }

        $sheet = $this->paymentSheet('booking', $id, (int) $booking->total_minor, $booking->currency, ['booking_id' => $id, 'user_id' => $booking->user_id]);
        // Idempotency: only claim external_ref when the booking has none yet. A
        // client retry (e.g. network timeout) must not overwrite a previously
        // issued payment intent — that would orphan the first intent and risk a
        // double-charge. If the atomic guarded update touches no row, an intent
        // already exists, so reuse it instead of returning the fresh one.
        $updated = DB::table('bookings')->where('id', $id)->whereNull('external_ref')->update(['external_ref' => $sheet['payment_intent_id'], 'updated_at' => now()]);
        if (! $updated) {
            $booking = DB::table('bookings')->where('id', $id)->first();
            $sheet['payment_intent_id'] = $booking->external_ref;
        }
        if ($operatorAction) {
            $this->auditWrite($user->id, 'payment.booking_intent', 'bookings', $id, [
                'booking_user_id' => $booking->user_id,
                'amount_minor' => (int) $booking->total_minor,
                'currency' => $booking->currency,
            ]);
        }

        return response()->json([
            ...$sheet,
            'booking_id' => $id,
            'amount_minor' => (int) $booking->total_minor,
            'currency' => $booking->currency,
        ]);
    }

    public function bookingStatus(Request $request, string $id): JsonResponse
    {
        $this->assertPaymentHistoryAvailable();

        $user = $this->authUser($request);
        if (! Str::isUuid($id)) {
            throw ApiException::notFound('Booking not found');
        }
        $booking = DB::table('bookings')->where('id', $id)->first();
        if ($booking === null) {
            throw ApiException::notFound('Booking not found');
        }
        if ($booking->user_id !== $user->id && ! $this->canManageBookingPayment($request, $user, $booking)) {
            throw ApiException::forbidden('Forbidden');
        }
        // Only a fully-paid booking is `succeeded`. `partially_paid` is an
        // outstanding-balance state — collapsing it to succeeded would make a
        // poller stop collecting the remainder, so it stays `pending`.
        $status = match ($booking->status) {
            'paid' => 'succeeded',
            'failed', 'cancelled', 'refunded' => 'failed',
            default => 'pending',
        };
        // Always emit paid_at (null unless actually paid) so strict mobile/iOS
        // decoders never crash on an absent key, and a stale paid_at is never
        // leaked for an unpaid booking.
        return response()->json([
            'status' => $status,
            'paid_at' => $booking->status === 'paid' ? $this->iso($booking->paid_at) : null,
        ]);
    }

    public function tournamentIntent(Request $request, string $tournamentId): JsonResponse
    {
        $this->assertPaymentIntentAvailable();

        $user = $this->authUser($request);
        $data = $this->validateBody($request, [
            'squad_name' => ['required', 'string', 'min:2', 'max:80'],
            'player_ids' => ['sometimes', 'array', 'max:19'],
            'player_ids.*' => ['uuid', 'distinct'],
        ]);
        $tournament = $this->tournamentRow($tournamentId);
        $this->assertTournamentRegistrationOpen($tournament, $user->id);
        if (
            DB::table('tournament_entries')
                ->where('tournament_id', $tournamentId)
                ->where('captain_user_id', $user->id)
                ->where('status', '!=', 'withdrawn')
                ->exists()
        ) {
            throw ApiException::conflict('You are already registered for this tournament');
        }
        if (
            DB::table('tournament_entries')
                ->where('tournament_id', $tournamentId)
                ->where('squad_name', $data['squad_name'])
                ->where('status', '!=', 'withdrawn')
                ->exists()
        ) {
            throw ApiException::conflict('Squad name is already taken');
        }

        $playerIds = $this->validatedTournamentPlayerIds($data['player_ids'] ?? [], $user->id, (int) $tournament->squad_size);
        $sheet = $this->paymentSheet('tournament', $tournamentId, (int) $tournament->entry_fee_minor, $tournament->currency, ['tournament_id' => $tournamentId, 'user_id' => $user->id]);
        // Idempotency: a client retry must not create a second payment intent
        // for the same captain+tournament. There is no DB unique constraint, so
        // guard here — if a live (pending/succeeded) intent already exists,
        // reuse it instead of inserting a duplicate row.
        $existingPayment = DB::table('tournament_entry_payments')
            ->where('tournament_id', $tournamentId)
            ->where('captain_user_id', $user->id)
            ->whereIn('status', ['pending', 'succeeded'])
            ->orderByDesc('created_at')
            ->first();
        if ($existingPayment !== null) {
            $sheet['payment_intent_id'] = $existingPayment->payment_intent_id;

            return response()->json($sheet);
        }
        $paymentId = (string) Str::uuid();
        DB::table('tournament_entry_payments')->insert([
            'id' => $paymentId,
            'tournament_id' => $tournamentId,
            'captain_user_id' => $user->id,
            'payment_intent_id' => $sheet['payment_intent_id'],
            'amount_minor' => (int) $tournament->entry_fee_minor,
            'currency' => $tournament->currency,
            'squad_name' => $data['squad_name'],
            'player_ids' => $this->uuidArray($playerIds),
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->auditWrite($user->id, 'payment.tournament_intent', 'tournament_entry_payments', $paymentId, [
            'tournament_id' => $tournamentId,
            'amount_minor' => (int) $tournament->entry_fee_minor,
            'currency' => $tournament->currency,
            'player_count' => count($playerIds) + 1,
        ]);

        return response()->json($sheet);
    }

    private function tournamentRow(string $id): object
    {
        // Reject a non-UUID id before it reaches Postgres (would otherwise be a
        // raw 22P02 → 500); a malformed id is treated as a clean 404 like a
        // missing tournament.
        if (! Str::isUuid($id)) {
            throw ApiException::notFound('Tournament not found');
        }
        $tournament = DB::table('tournaments as t')
            ->join('sports as s', 's.id', '=', 't.sport_id')
            ->where('t.id', $id)
            ->whereIn('s.slug', ['padel', 'tennis'])
            ->first(['t.*']);
        if ($tournament === null) {
            throw ApiException::notFound('Tournament not found');
        }

        return $tournament;
    }

    private function assertTournamentRegistrationOpen(object $tournament, string $captainUserId): void
    {
        if ($tournament->status !== 'registration_open') {
            throw ApiException::conflict('Tournament registration is closed');
        }
        if ($tournament->registration_deadline !== null && CarbonImmutable::parse($tournament->registration_deadline)->isPast()) {
            throw ApiException::conflict('Tournament registration deadline has passed');
        }
        if (CarbonImmutable::parse($tournament->starts_at)->isPast()) {
            throw ApiException::conflict('Tournament has already started');
        }

        $existingActive = DB::table('tournament_entries')
            ->where('tournament_id', $tournament->id)
            ->where('captain_user_id', $captainUserId)
            ->where('status', '!=', 'withdrawn')
            ->exists();
        if ($existingActive) {
            return;
        }

        $activeEntries = DB::table('tournament_entries')
            ->where('tournament_id', $tournament->id)
            ->where('status', '!=', 'withdrawn')
            ->count();
        if ($activeEntries >= (int) $tournament->max_squads) {
            throw ApiException::conflict('Tournament is full');
        }
    }

    private function validatedTournamentPlayerIds(array $playerIds, string $captainUserId, int $squadSize): array
    {
        $playerIds = array_values(array_unique(array_filter($playerIds, fn ($uid) => is_string($uid) && $uid !== '')));
        $maxPlayers = max($squadSize - 1, 0);
        if (count($playerIds) > $maxPlayers) {
            throw ApiException::validation('Squad exceeds tournament size');
        }
        if (in_array($captainUserId, $playerIds, true)) {
            throw ApiException::validation('Captain cannot be listed as a player');
        }
        if ($playerIds !== []) {
            $existingUsers = DB::table('users')->whereIn('id', $playerIds)->count();
            if ($existingUsers !== count($playerIds)) {
                throw ApiException::validation('One or more players do not exist');
            }
        }

        return $playerIds;
    }

    private function uuidArray(array $ids)
    {
        $playerArray = '{'.implode(',', array_map(fn ($uid) => '"'.str_replace('"', '\"', $uid).'"', $ids)).'}';

        return DB::raw("'".$playerArray."'::uuid[]");
    }

    private function paymentSheet(string $kind, string $ref, int $amount, string $currency, array $metadata): array
    {
        $this->assertPaymentIntentAvailable([
            'kind' => $kind,
            'ref' => $ref,
            'amount_minor' => $amount,
            'currency' => $currency,
        ]);

        $provider = trim((string) config('membership.payment_provider', ''));
        if ($provider === '') {
            throw new ApiException(
                501,
                'PAYMENT_PROVIDER_NOT_CONFIGURED',
                'Online checkout is not available yet.',
                [
                    'kind' => $kind,
                    'ref' => $ref,
                    'amount_minor' => $amount,
                    'currency' => $currency,
                    'checkout_available' => false,
                ]
            );
        }

        throw new ApiException(
            501,
            'PAYMENT_ADAPTER_NOT_IMPLEMENTED',
            'Online checkout is not available yet.',
            [
                'kind' => $kind,
                'ref' => $ref,
                'amount_minor' => $amount,
                'currency' => $currency,
                'checkout_available' => false,
            ]
        );
    }

    private function assertPaymentHistoryAvailable(): void
    {
        if ($this->paymentSurfaceAvailable()) {
            return;
        }

        throw new ApiException(
            404,
            'PAYMENTS_NOT_AVAILABLE',
            'This feature is not available yet.'
        );
    }

    private function assertPaymentIntentAvailable(array $details = []): void
    {
        if ($this->paymentSurfaceAvailable()) {
            return;
        }

        throw new ApiException(
            409,
            'PAYMENTS_DISABLED',
            'Online checkout is not available yet.',
            [
                ...$details,
                'checkout_available' => false,
            ]
        );
    }

    private function paymentSurfaceAvailable(): bool
    {
        return (bool) config('membership.public_subscriptions_enabled')
            && (bool) config('membership.payments_enabled');
    }

    private function bookingPayments(string $userId, ?string $status)
    {
        return DB::table('bookings as b')
            ->join('courts as c', 'c.id', '=', 'b.court_id')
            ->join('venues as v', 'v.id', '=', 'c.venue_id')
            ->where('b.user_id', $userId)
            ->when($status, fn ($q) => $q->where('b.status', $status))
            ->orderByDesc('b.created_at')
            // Safety cap only — was 300, which silently hid the oldest records
            // (and corrupted the in-memory pagination total + summary totals)
            // for any user with more than 300 payments.
            ->limit(10000)
            ->get([
                'b.id',
                'b.status',
                'b.total_minor',
                'b.currency',
                'b.payment_method',
                'b.external_ref',
                'b.paid_at',
                'b.created_at',
                'c.name as court_name',
                'v.name as venue_name',
            ])
            ->map(fn ($row) => [
                'id' => 'booking:'.$row->id,
                'type' => 'booking',
                'target_id' => $row->id,
                'status' => $row->status,
                'amount_minor' => (int) $row->total_minor,
                'currency' => $row->currency,
                'payment_method' => $row->payment_method,
                'external_ref' => $row->external_ref,
                'title' => $row->venue_name,
                'subtitle' => $row->court_name,
                'created_at' => $this->iso($row->created_at),
                'paid_at' => $this->iso($row->paid_at),
            ]);
    }

    private function tournamentPayments(string $userId, ?string $status)
    {
        return DB::table('tournament_entry_payments as p')
            ->join('tournaments as t', 't.id', '=', 'p.tournament_id')
            ->leftJoin('venues as v', 'v.id', '=', 't.venue_id')
            ->where('p.captain_user_id', $userId)
            ->when($status, fn ($q) => $q->where('p.status', $status))
            ->orderByDesc('p.created_at')
            // Safety cap only — was 300, which silently hid the oldest records
            // (and corrupted the in-memory pagination total + summary totals)
            // for any user with more than 300 payments.
            ->limit(10000)
            ->get([
                'p.id',
                'p.tournament_id',
                'p.status',
                'p.amount_minor',
                'p.currency',
                'p.payment_intent_id',
                'p.succeeded_at',
                'p.created_at',
                'p.squad_name',
                't.name as tournament_name',
                'v.name as venue_name',
            ])
            ->map(fn ($row) => [
                'id' => 'tournament:'.$row->id,
                'type' => 'tournament',
                'target_id' => $row->tournament_id,
                'payment_id' => $row->id,
                'status' => $row->status,
                'amount_minor' => (int) $row->amount_minor,
                'currency' => $row->currency,
                'payment_method' => 'local',
                'external_ref' => $row->payment_intent_id,
                'title' => $row->tournament_name,
                'subtitle' => $row->venue_name ?: $row->squad_name,
                'created_at' => $this->iso($row->created_at),
                'paid_at' => $this->iso($row->succeeded_at),
            ]);
    }

    private function paymentSummaryForItems($items): array
    {
        // Only fully-settled items count as paid. `partially_paid` carries an
        // outstanding balance, so summing its full amount_minor here would
        // overstate the paid total — bucket it with the unpaid/pending items.
        $paid = $items->filter(fn ($item) => in_array($item['status'], ['paid', 'succeeded'], true));
        $pending = $items->filter(fn ($item) => in_array($item['status'], ['pending', 'pending_payment', 'partially_paid'], true));

        return [
            'items_total' => $items->count(),
            'paid_count' => $paid->count(),
            'pending_count' => $pending->count(),
            'paid_total_minor' => (int) $paid->sum('amount_minor'),
            'pending_total_minor' => (int) $pending->sum('amount_minor'),
            'currency' => $items->first()['currency'] ?? 'AZN',
        ];
    }

    private function canManageBookingPayment(Request $request, object $user, object $booking): bool
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

        $venue = DB::table('courts as c')
            ->join('venues as v', 'v.id', '=', 'c.venue_id')
            ->where('c.id', $booking->court_id)
            ->where('v.id', $user->venue_id)
            ->first(['v.id', 'v.owner_user_id']);
        if ($venue === null) {
            return false;
        }
        if ((string) $venue->owner_user_id === (string) $user->id) {
            return true;
        }
        $permissions = $this->normalizePartnerPermissions(json_decode((string) ($user->staff_permissions ?? ''), true) ?: null);

        return (bool) ($permissions['bookings'] ?? false);
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
}
