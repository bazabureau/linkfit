<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\AuthorizesAdminPermissions;
use App\Support\ApiException;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class WaitlistController extends ApiController
{
    use AuthorizesAdminPermissions;

    /**
     * Cap on concurrent ACTIVE/NOTIFIED waitlist entries per user. The create
     * route ({@see create}) is throttled (throttle:write-action), but that only
     * bounds request rate — this caps the standing table footprint a single user
     * can accumulate over time, while staying well above realistic legitimate use.
     */
    private const MAX_ACTIVE_WAITLIST_ENTRIES = 50;

    public function mine(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $query = $this->validateQuery($request, [
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
            'status' => ['nullable', 'in:active,notified,cancelled,expired'],
        ]);

        $items = $this->baseQuery()
            ->where('w.user_id', $user->id)
            ->when(! empty($query['status']), fn ($q) => $q->where('w.status', $query['status']))
            ->orderByDesc('w.created_at')
            ->limit((int) ($query['limit'] ?? 50))
            ->get()
            ->map(fn ($entry) => $this->payload($entry))
            ->values();

        return response()->json(['items' => $items]);
    }

    public function create(Request $request, string $courtId): JsonResponse
    {
        $user = $this->authUser($request);
        $data = $this->validateBody($request, [
            'starts_at' => ['required', 'date'],
            'duration_minutes' => ['required', 'integer', 'min:15', 'max:480'],
        ]);
        $court = DB::table('courts as c')
            ->join('venues as v', 'v.id', '=', 'c.venue_id')
            ->where('c.id', $courtId)
            ->first(['c.id', 'c.status', 'v.status as venue_status']);
        if (! $court) {
            throw ApiException::notFound('Court not found');
        }
        if (($court->status ?? 'active') !== 'active' || ! in_array($court->venue_status ?? 'published', [null, 'published'], true)) {
            throw ApiException::conflict('Court is not available for waitlist');
        }

        $starts = CarbonImmutable::parse($data['starts_at']);
        // Data integrity: never waitlist a slot that has already fully elapsed —
        // compared on the slot END so the in-progress slot is still allowed. Real
        // clients only send future times, so this rejects stale/abusive input only.
        if ($starts->addMinutes((int) $data['duration_minutes'])->lessThanOrEqualTo(CarbonImmutable::now())) {
            throw ApiException::conflict('Waitlist time is in the past');
        }
        $existing = DB::table('booking_waitlist_entries')
            ->where('user_id', $user->id)
            ->where('court_id', $courtId)
            ->where('starts_at', $starts)
            ->where('duration_minutes', (int) $data['duration_minutes'])
            ->first();
        if ($existing) {
            DB::table('booking_waitlist_entries')->where('id', $existing->id)->update([
                'status' => 'active',
                'cancelled_at' => null,
                'updated_at' => now(),
            ]);
        } else {
            // Unbounded-growth guard: cap how many ACTIVE/NOTIFIED waitlist entries
            // a single user may hold at once (the route throttle bounds rate, not
            // standing footprint). Reactivating an existing entry (above) is exempt
            // so a legitimate re-join is never blocked.
            $activeCount = DB::table('booking_waitlist_entries')
                ->where('user_id', $user->id)
                ->whereIn('status', ['active', 'notified'])
                ->count();
            if ($activeCount >= self::MAX_ACTIVE_WAITLIST_ENTRIES) {
                throw ApiException::conflict('You have reached the maximum number of active waitlist entries');
            }
            try {
                DB::table('booking_waitlist_entries')->insert([
                    'id' => (string) Str::uuid(),
                    'user_id' => $user->id,
                    'court_id' => $courtId,
                    'starts_at' => $starts,
                    'duration_minutes' => (int) $data['duration_minutes'],
                    'status' => 'active',
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            } catch (QueryException $e) {
                // Concurrent double-join: the pre-check above is a fast path only,
                // so two simultaneous requests can both miss $existing and race to
                // insert. The unique (user_id, court_id, starts_at, duration_minutes)
                // index is the real guard — the loser collides; translate that into
                // an idempotent reactivation of the now-existing row instead of a 500.
                if (! $this->isUniqueViolation($e)) {
                    throw $e;
                }
                DB::table('booking_waitlist_entries')
                    ->where('user_id', $user->id)
                    ->where('court_id', $courtId)
                    ->where('starts_at', $starts)
                    ->where('duration_minutes', (int) $data['duration_minutes'])
                    ->update(['status' => 'active', 'cancelled_at' => null, 'updated_at' => now()]);
                $existing = true;
            }
        }

        $entry = $this->baseQuery()
            ->where('w.user_id', $user->id)
            ->where('w.court_id', $courtId)
            ->where('w.starts_at', $starts)
            ->where('w.duration_minutes', (int) $data['duration_minutes'])
            ->first();
        $this->auditWrite($user->id, $existing ? 'waitlist.reactivate' : 'waitlist.create', 'booking_waitlist_entries', $entry->id, [
            'court_id' => $courtId,
            'starts_at' => $starts->toIso8601ZuluString('millisecond'),
            'duration_minutes' => (int) $data['duration_minutes'],
        ]);

        return response()->json($this->payload($entry), 201);
    }

    public function cancel(Request $request, string $id): JsonResponse
    {
        $user = $this->authUser($request);
        $updated = DB::table('booking_waitlist_entries')
            ->where('id', $id)
            ->where('user_id', $user->id)
            ->whereIn('status', ['active', 'notified'])
            ->update([
                'status' => 'cancelled',
                'cancelled_at' => now(),
                'updated_at' => now(),
            ]);
        if ($updated === 0) {
            throw ApiException::notFound('Waitlist entry not found');
        }
        $this->auditWrite($user->id, 'waitlist.cancel', 'booking_waitlist_entries', $id);

        return response()->json($this->payload($this->baseQuery()->where('w.id', $id)->first()));
    }

    public function partnerIndex(Request $request): JsonResponse
    {
        $venueId = $this->requirePartnerPermission($request, 'bookings');

        return $this->indexForRequest($request, $venueId);
    }

    public function adminIndex(Request $request): JsonResponse
    {
        $this->requireAdminPermission($request, 'bookings');

        return $this->indexForRequest($request, $request->query('venue_id'));
    }

    public function adminUpdate(Request $request, string $id): JsonResponse
    {
        $admin = $this->requireAdminPermission($request, 'bookings');
        $data = $this->validateBody($request, [
            'status' => ['required', 'in:active,notified,cancelled,expired'],
        ]);
        $response = $this->updateStatus($id, $data['status']);
        $this->auditWrite($admin->id, 'waitlist.admin_update', 'booking_waitlist_entries', $id, [
            'status' => $data['status'],
        ]);

        return $response;
    }

    public function partnerUpdate(Request $request, string $id): JsonResponse
    {
        $partner = $this->authUser($request);
        $venueId = $this->requirePartnerPermission($request, 'bookings');
        $exists = DB::table('booking_waitlist_entries as w')
            ->join('courts as c', 'c.id', '=', 'w.court_id')
            ->where('w.id', $id)
            ->where('c.venue_id', $venueId)
            ->exists();
        if (! $exists) {
            throw ApiException::notFound('Waitlist entry not found');
        }
        $data = $this->validateBody($request, [
            'status' => ['required', 'in:active,notified,cancelled,expired'],
        ]);
        $response = $this->updateStatus($id, $data['status']);
        $this->auditWrite($partner->id, 'waitlist.partner_update', 'booking_waitlist_entries', $id, [
            'status' => $data['status'],
            'venue_id' => $venueId,
        ]);

        return $response;
    }

    private function indexForRequest(Request $request, ?string $venueId = null): JsonResponse
    {
        $query = $this->validateQuery($request, [
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
            'offset' => ['nullable', 'integer', 'min:0'],
            'status' => ['nullable', 'in:active,notified,cancelled,expired'],
            'court_id' => ['nullable', 'uuid'],
            'date' => ['nullable', 'regex:/^\d{4}-\d{2}-\d{2}$/'],
        ]);
        $base = $this->baseQuery();
        if ($venueId) {
            $base->where('v.id', $venueId);
        }
        if (! empty($query['status'])) {
            $base->where('w.status', $query['status']);
        }
        if (! empty($query['court_id'])) {
            $base->where('w.court_id', $query['court_id']);
        }
        if (! empty($query['date'])) {
            $start = CarbonImmutable::parse($query['date'].' 00:00:00', 'Asia/Baku')->utc();
            $end = $start->addDay();
            $base->where('w.starts_at', '>=', $start)->where('w.starts_at', '<', $end);
        }
        $total = (clone $base)->count('w.id');
        $limit = (int) ($query['limit'] ?? 50);
        $offset = (int) ($query['offset'] ?? 0);

        return response()->json([
            'items' => $base->orderBy('w.starts_at')->offset($offset)->limit($limit)->get()->map(fn ($entry) => $this->payload($entry))->values(),
            'pagination' => ['limit' => $limit, 'offset' => $offset, 'total' => $total],
        ]);
    }

    private function updateStatus(string $id, string $status): JsonResponse
    {
        $updated = DB::table('booking_waitlist_entries')->where('id', $id)->update([
            'status' => $status,
            'notified_at' => $status === 'notified' ? now() : DB::raw('notified_at'),
            'cancelled_at' => $status === 'cancelled' ? now() : DB::raw('cancelled_at'),
            'updated_at' => now(),
        ]);
        if ($updated === 0) {
            throw ApiException::notFound('Waitlist entry not found');
        }

        return response()->json($this->payload($this->baseQuery()->where('w.id', $id)->first()));
    }

    private function baseQuery()
    {
        return DB::table('booking_waitlist_entries as w')
            ->join('users as u', 'u.id', '=', 'w.user_id')
            ->join('courts as c', 'c.id', '=', 'w.court_id')
            ->join('venues as v', 'v.id', '=', 'c.venue_id')
            ->leftJoin('sports as s', 's.id', '=', 'c.sport_id')
            ->select([
                'w.*',
                'u.display_name as user_display_name',
                'u.email as user_email',
                'u.photo_url as user_photo_url',
                'c.name as court_name',
                'v.id as venue_id',
                'v.name as venue_name',
                's.slug as sport_slug',
            ]);
    }

    private function payload(object $entry): array
    {
        $starts = CarbonImmutable::parse($entry->starts_at);

        return [
            'id' => $entry->id,
            'user_id' => $entry->user_id,
            'user' => [
                'id' => $entry->user_id,
                'display_name' => $entry->user_display_name,
                'email' => $entry->user_email,
                'photo_url' => $entry->user_photo_url,
            ],
            'court_id' => $entry->court_id,
            'court_name' => $entry->court_name,
            'venue_id' => $entry->venue_id,
            'venue_name' => $entry->venue_name,
            'sport_slug' => $entry->sport_slug,
            'starts_at' => $starts->toIso8601ZuluString('millisecond'),
            'ends_at' => $starts->addMinutes((int) $entry->duration_minutes)->toIso8601ZuluString('millisecond'),
            'duration_minutes' => (int) $entry->duration_minutes,
            'status' => $entry->status,
            'notified_at' => $this->iso($entry->notified_at),
            'cancelled_at' => $this->iso($entry->cancelled_at),
            'created_at' => $this->iso($entry->created_at),
            'updated_at' => $this->iso($entry->updated_at),
        ];
    }

    private function partnerVenueId(Request $request): string
    {
        $user = $this->authUser($request);
        if ($user->admin_role !== 'partner' || $user->venue_id === null) {
            throw ApiException::forbidden('Partner access required');
        }

        return $user->venue_id;
    }

    private function requirePartnerPermission(Request $request, string $permission): string
    {
        $venueId = $this->partnerVenueId($request);
        $user = $this->authUser($request);
        if (DB::table('venues')->where('id', $venueId)->where('owner_user_id', $user->id)->exists()) {
            return $venueId;
        }
        $permissions = $this->normalizePartnerPermissions(json_decode((string) ($user->staff_permissions ?? ''), true) ?: null);
        if (! (bool) ($permissions[$permission] ?? false)) {
            throw ApiException::forbidden('Owner permission required: '.$permission);
        }

        return $venueId;
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

    /**
     * Detect a unique/primary-key constraint violation across drivers.
     * Postgres reports SQLSTATE 23505; SQLite/MySQL report the generic 23000.
     */
    private function isUniqueViolation(QueryException $e): bool
    {
        $sqlState = (string) ($e->errorInfo[0] ?? $e->getCode());

        return in_array($sqlState, ['23505', '23000'], true);
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
