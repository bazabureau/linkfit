<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\AuthorizesAdminPermissions;
use App\Support\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class OwnerApplicationsController extends ApiController
{
    use AuthorizesAdminPermissions;

    public function mine(Request $request): JsonResponse
    {
        $user = $this->authUser($request);

        return response()->json([
            'items' => DB::table('owner_applications')
                ->where('user_id', $user->id)
                ->orderByDesc('created_at')
                ->limit(50)
                ->get()
                ->map(fn ($application) => $this->applicationPayload($application))
                ->values(),
        ]);
    }

    public function create(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $data = $this->validateBody($request, [
            'venue_id' => ['sometimes', 'nullable', 'uuid'],
            'venue_name' => ['required', 'string', 'min:2', 'max:160'],
            'venue_address' => ['required', 'string', 'min:2', 'max:1000'],
            'lat' => ['sometimes', 'nullable', 'numeric', 'between:-90,90'],
            'lng' => ['sometimes', 'nullable', 'numeric', 'between:-180,180'],
            'contact_name' => ['required', 'string', 'min:2', 'max:120'],
            'contact_phone' => ['sometimes', 'nullable', 'string', 'max:60'],
            'contact_email' => ['required', 'email', 'max:254'],
            'message' => ['sometimes', 'nullable', 'string', 'max:4000'],
        ]);
        if (array_key_exists('lat', $data) xor array_key_exists('lng', $data)) {
            throw ApiException::validation('lat and lng must be provided together');
        }
        if (! empty($data['venue_id']) && ! DB::table('venues')->where('id', $data['venue_id'])->exists()) {
            throw ApiException::notFound('Venue not found');
        }
        $hasPending = DB::table('owner_applications')
            ->where('user_id', $user->id)
            ->where('status', 'pending')
            ->exists();
        if ($hasPending) {
            throw ApiException::conflict('You already have a pending owner application');
        }

        $id = (string) Str::uuid();
        DB::table('owner_applications')->insert([
            'id' => $id,
            'user_id' => $user->id,
            'venue_id' => $data['venue_id'] ?? null,
            'venue_name' => trim($data['venue_name']),
            'venue_address' => trim($data['venue_address']),
            'lat' => $data['lat'] ?? null,
            'lng' => $data['lng'] ?? null,
            'contact_name' => trim($data['contact_name']),
            'contact_phone' => $data['contact_phone'] ?? null,
            'contact_email' => mb_strtolower(trim($data['contact_email'])),
            'message' => $data['message'] ?? null,
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return response()->json($this->applicationPayload($this->applicationRow($id), true), 201);
    }

    public function adminIndex(Request $request): JsonResponse
    {
        $this->requireAdminPermission($request, 'venues');
        $query = $this->validateQuery($request, [
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
            'offset' => ['nullable', 'integer', 'min:0'],
            'status' => ['nullable', 'in:pending,approved,rejected'],
            'q' => ['nullable', 'string', 'max:120'],
        ]);
        $base = DB::table('owner_applications as a')->leftJoin('users as u', 'u.id', '=', 'a.user_id');
        if (! empty($query['status'])) {
            $base->where('a.status', $query['status']);
        }
        if (! empty($query['q'])) {
            $needle = '%'.mb_strtolower($query['q']).'%';
            $base->where(function ($q) use ($needle) {
                $q->whereRaw('LOWER(a.venue_name) LIKE ?', [$needle])
                    ->orWhereRaw('LOWER(a.venue_address) LIKE ?', [$needle])
                    ->orWhereRaw('LOWER(a.contact_email) LIKE ?', [$needle])
                    ->orWhereRaw('LOWER(a.contact_name) LIKE ?', [$needle])
                    ->orWhereRaw('LOWER(COALESCE(u.email, \'\')) LIKE ?', [$needle]);
            });
        }

        $total = (clone $base)->count('a.id');
        $limit = (int) ($query['limit'] ?? 50);
        $offset = (int) ($query['offset'] ?? 0);

        return response()->json([
            'items' => $base->orderByDesc('a.created_at')->offset($offset)->limit($limit)->get(['a.*'])->map(fn ($row) => $this->applicationPayload($row))->values(),
            'pagination' => ['limit' => $limit, 'offset' => $offset, 'total' => $total],
            'summary' => [
                'pending' => DB::table('owner_applications')->where('status', 'pending')->count(),
                'approved' => DB::table('owner_applications')->where('status', 'approved')->count(),
                'rejected' => DB::table('owner_applications')->where('status', 'rejected')->count(),
            ],
        ]);
    }

    public function adminShow(Request $request, string $id): JsonResponse
    {
        $this->requireAdminPermission($request, 'venues');

        return response()->json($this->applicationPayload($this->applicationRow($id), true));
    }

    public function approve(Request $request, string $id): JsonResponse
    {
        $admin = $this->requireAdminPermission($request, 'venues');
        $application = $this->applicationRow($id);
        if ($application->status !== 'pending') {
            throw ApiException::conflict('Application is already reviewed');
        }
        $data = $this->validateBody($request, [
            'venue_id' => ['sometimes', 'nullable', 'uuid'],
            'review_note' => ['sometimes', 'nullable', 'string', 'max:4000'],
            'status' => ['sometimes', 'in:published,draft'],
        ]);
        $venueId = $data['venue_id'] ?? $application->venue_id;
        if ($venueId !== null && ! DB::table('venues')->where('id', $venueId)->exists()) {
            throw ApiException::notFound('Venue not found');
        }
        // Reassigning an EXISTING venue's ownership is admin-only. Without this a
        // moderator (venues permission) could transfer any user's venue to an
        // applicant by passing its id. Moderators may still create NEW venues.
        if ($venueId !== null && ($admin->admin_role ?? null) !== 'admin') {
            throw ApiException::forbidden('Only admins can assign an existing venue to an applicant');
        }
        if ($venueId === null) {
            if ($application->lat === null || $application->lng === null) {
                throw ApiException::validation('lat and lng are required to create a new venue');
            }
            $venueId = (string) Str::uuid();
            DB::table('venues')->insert([
                'id' => $venueId,
                'name' => $application->venue_name,
                'address' => $application->venue_address,
                'lat' => $application->lat,
                'lng' => $application->lng,
                'owner_user_id' => $application->user_id,
                'is_partner' => true,
                'phone' => $application->contact_phone,
                'description' => $application->message,
                'status' => $data['status'] ?? 'draft',
                'approved_at' => now(),
                'approved_by_user_id' => $admin->id,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        } else {
            // Never overwrite an ownership that already belongs to a different
            // partner — that would orphan the prior owner's venue_id reference
            // and corrupt the ownership graph. Reassigning to the same applicant
            // (idempotent re-approval) stays allowed.
            if (DB::table('venues')->where('id', $venueId)->whereNotNull('owner_user_id')->where('owner_user_id', '!=', $application->user_id)->exists()) {
                throw ApiException::conflict('Venue is already owned by another partner');
            }
            DB::table('venues')->where('id', $venueId)->update([
                'owner_user_id' => $application->user_id,
                'is_partner' => true,
                'status' => $data['status'] ?? 'published',
                'approved_at' => now(),
                'approved_by_user_id' => $admin->id,
                'updated_at' => now(),
            ]);
        }

        DB::table('users')->where('id', $application->user_id)->update([
            'admin_role' => 'partner',
            'venue_id' => $venueId,
            'staff_title' => 'Venue owner',
            'staff_permissions' => json_encode($this->defaultOwnerPermissions()),
            'updated_at' => now(),
        ]);
        DB::table('owner_applications')->where('id', $id)->update([
            'venue_id' => $venueId,
            'status' => 'approved',
            'reviewed_by_user_id' => $admin->id,
            'reviewed_at' => now(),
            'review_note' => $data['review_note'] ?? null,
            'updated_at' => now(),
        ]);
        $this->auditWrite($admin->id, 'owner_application.approve', 'owner_applications', $id, [
            'user_id' => $application->user_id,
            'venue_id' => $venueId,
            'created_new_venue' => ($data['venue_id'] ?? $application->venue_id) === null,
            'status' => $data['status'] ?? null,
        ]);

        return response()->json($this->applicationPayload($this->applicationRow($id), true));
    }

    public function reject(Request $request, string $id): JsonResponse
    {
        $admin = $this->requireAdminPermission($request, 'venues');
        $application = $this->applicationRow($id);
        if ($application->status !== 'pending') {
            throw ApiException::conflict('Application is already reviewed');
        }
        $data = $this->validateBody($request, [
            'review_note' => ['sometimes', 'nullable', 'string', 'max:4000'],
        ]);
        DB::table('owner_applications')->where('id', $id)->update([
            'status' => 'rejected',
            'reviewed_by_user_id' => $admin->id,
            'reviewed_at' => now(),
            'review_note' => $data['review_note'] ?? null,
            'updated_at' => now(),
        ]);
        $this->auditWrite($admin->id, 'owner_application.reject', 'owner_applications', $id, [
            'user_id' => $application->user_id,
            'venue_id' => $application->venue_id,
        ]);

        return response()->json($this->applicationPayload($this->applicationRow($id), true));
    }

    private function applicationRow(string $id): object
    {
        $row = DB::table('owner_applications')->where('id', $id)->first();
        if (! $row) {
            throw ApiException::notFound('Owner application not found');
        }

        return $row;
    }

    private function applicationPayload(object $row, bool $includeUser = false): array
    {
        return [
            'id' => $row->id,
            'user_id' => $row->user_id,
            'user' => $includeUser ? $this->userSummary($row->user_id) : null,
            'venue_id' => $row->venue_id,
            'venue' => $row->venue_id ? DB::table('venues')->where('id', $row->venue_id)->first(['id', 'name', 'address', 'status', 'is_partner']) : null,
            'venue_name' => $row->venue_name,
            'venue_address' => $row->venue_address,
            'lat' => $row->lat !== null ? (float) $row->lat : null,
            'lng' => $row->lng !== null ? (float) $row->lng : null,
            'contact_name' => $row->contact_name,
            'contact_phone' => $row->contact_phone,
            'contact_email' => $row->contact_email,
            'message' => $row->message,
            'status' => $row->status,
            'reviewed_by_user_id' => $row->reviewed_by_user_id,
            'reviewed_by' => $includeUser ? $this->userSummary($row->reviewed_by_user_id) : null,
            'reviewed_at' => $this->iso($row->reviewed_at),
            'review_note' => $row->review_note,
            'created_at' => $this->iso($row->created_at),
            'updated_at' => $this->iso($row->updated_at),
        ];
    }

    private function userSummary(?string $id): ?array
    {
        if (! $id) {
            return null;
        }
        $user = DB::table('users')->where('id', $id)->first(['id', 'email', 'display_name', 'photo_url', 'admin_role', 'venue_id']);
        if (! $user) {
            return null;
        }

        return [
            'id' => $user->id,
            'email' => $user->email,
            'display_name' => $user->display_name,
            'photo_url' => $user->photo_url,
            'admin_role' => $user->admin_role,
            'venue_id' => $user->venue_id,
        ];
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

    private function defaultOwnerPermissions(): array
    {
        return [
            'dashboard' => true,
            'bookings' => true,
            'booking_write' => true,
            'courts' => true,
            'rules' => true,
            'blocks' => true,
            'staff' => true,
            'customers' => true,
            'reports' => true,
            'tournaments' => true,
            'reviews' => true,
        ];
    }
}
