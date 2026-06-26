<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\AuthorizesAdminPermissions;
use App\Services\Mail\TransactionalMailService;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class LaunchWaitlistController extends ApiController
{
    use AuthorizesAdminPermissions;

    /**
     * The lifecycle states a launch-waitlist lead can be moved through from the
     * admin panel. 'pending' is the DB default applied on signup.
     *
     * @var list<string>
     */
    private const STATUSES = ['pending', 'invited', 'joined', 'declined'];

    public function store(Request $request): JsonResponse
    {
        $data = $this->validateBody($request, [
            'name' => ['required', 'string', 'min:2', 'max:160'],
            'email' => ['required', 'email:rfc', 'max:190'],
            'phone' => ['nullable', 'string', 'max:40'],
            'role' => ['nullable', 'string', 'in:player,venue,coach,other'],
            'locale' => ['nullable', 'string', 'in:az,en,ru'],
            'source' => ['nullable', 'string', 'max:80'],
            'message' => ['nullable', 'string', 'max:1200'],
        ]);

        $email = mb_strtolower(trim((string) $data['email']));
        $now = now();
        $existing = DB::table('launch_waitlist_entries')->where('email', $email)->first(['id']);
        $id = $existing?->id ?? (string) Str::uuid();

        $payload = [
            'name' => trim((string) $data['name']),
            'email' => $email,
            'phone' => isset($data['phone']) && trim((string) $data['phone']) !== '' ? trim((string) $data['phone']) : null,
            'role' => $data['role'] ?? 'player',
            'locale' => $data['locale'] ?? 'az',
            'source' => $data['source'] ?? 'web_waitlist',
            'message' => isset($data['message']) && trim((string) $data['message']) !== '' ? trim((string) $data['message']) : null,
            // Store a salted hash of the IP (never the raw address) — matches the
            // analytics convention so the value is correlatable but not PII.
            'ip_address' => $request->ip() ? hash('sha256', $request->ip().(string) config('app.key')) : null,
            'user_agent' => substr((string) $request->userAgent(), 0, 512),
            'updated_at' => $now,
        ];

        if ($existing === null) {
            try {
                DB::table('launch_waitlist_entries')->insert(array_merge($payload, [
                    'id' => $id,
                    'created_at' => $now,
                ]));
            } catch (QueryException $e) {
                // A concurrent request for the same (unique) email raced us to the
                // INSERT. Fall back to the existing-entry path instead of returning
                // a 500: update the row and respond 200, skipping the welcome email
                // (the request that won the race already sends it). 23505 = Postgres
                // unique_violation, 23000 = MySQL/SQLite integrity-constraint class.
                $sqlState = (string) ($e->errorInfo[0] ?? '');
                if ($sqlState !== '23505' && $sqlState !== '23000') {
                    throw $e;
                }
                $row = DB::table('launch_waitlist_entries')->where('email', $email)->first(['id']);
                $id = (string) ($row->id ?? $id);
                DB::table('launch_waitlist_entries')->where('email', $email)->update($payload);

                return response()->json(['ok' => true, 'id' => $id], 200);
            }
            // Auto welcome email on first signup only (not on duplicate re-submit).
            // Best-effort: a mail failure must never break the signup response.
            try {
                app(TransactionalMailService::class)->waitlistWelcome($email, $payload['name'], $payload['locale']);
            } catch (\Throwable $e) {
                // swallowed — TransactionalMailService also logs send failures,
                // but report to the exception handler (Sentry) so a failed welcome
                // email is not invisible if mail logging is misconfigured.
                report($e);
            }
        } else {
            DB::table('launch_waitlist_entries')->where('id', $id)->update($payload);
        }

        return response()->json(['ok' => true, 'id' => $id], $existing === null ? 201 : 200);
    }

    /**
     * Admin: paginated list of the public launch ("coming soon") signups, with
     * optional status/role filters and an email/name search. Mirrors the
     * {items, pagination} envelope used by the other admin list endpoints
     * (e.g. WaitlistController::adminIndex, EngagementController::adminAnnouncements).
     */
    public function adminIndex(Request $request): JsonResponse
    {
        $this->requireAdminPermission($request, 'operations');
        $query = $this->validateQuery($request, [
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
            'offset' => ['nullable', 'integer', 'min:0'],
            'status' => ['nullable', 'in:'.implode(',', self::STATUSES)],
            'role' => ['nullable', 'string', 'in:player,venue,coach,other'],
            'q' => ['nullable', 'string', 'max:160'],
        ]);

        $base = DB::table('launch_waitlist_entries');
        if (! empty($query['status'])) {
            $base->where('status', $query['status']);
        }
        if (! empty($query['role'])) {
            $base->where('role', $query['role']);
        }
        if (! empty($query['q'])) {
            // Escape LIKE wildcards so a literal `%`/`_`/`\` in the admin search
            // term matches itself instead of acting as a wildcard (parity with
            // EngagementController::adminAnnouncements).
            $needle = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], mb_strtolower($query['q'])).'%';
            $base->where(function ($q) use ($needle) {
                $q->whereRaw('LOWER(email) LIKE ?', [$needle])
                    ->orWhereRaw('LOWER(COALESCE(name, \'\')) LIKE ?', [$needle]);
            });
        }

        $total = (clone $base)->count();
        $limit = (int) ($query['limit'] ?? 50);
        $offset = (int) ($query['offset'] ?? 0);
        $items = $base
            ->orderByDesc('created_at')
            ->offset($offset)
            ->limit($limit)
            ->get()
            ->map(fn ($row) => $this->adminPayload($row))
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

    /**
     * Admin: update a launch-waitlist lead's pipeline status
     * (pending/invited/joined/declined). Returns the updated row.
     */
    public function adminUpdate(Request $request, string $id): JsonResponse
    {
        $admin = $this->requireAdminPermission($request, 'operations');
        $data = $this->validateBody($request, [
            'status' => ['required', 'string', 'in:'.implode(',', self::STATUSES)],
        ]);

        $updated = DB::table('launch_waitlist_entries')->where('id', $id)->update([
            'status' => $data['status'],
            'updated_at' => now(),
        ]);
        if ($updated === 0) {
            throw \App\Support\ApiException::notFound('Waitlist entry not found');
        }
        $this->auditWrite($admin->id, 'launch_waitlist.update', 'launch_waitlist_entries', $id, [
            'status' => $data['status'],
        ]);

        return response()->json($this->adminPayload(DB::table('launch_waitlist_entries')->where('id', $id)->first()));
    }

    /**
     * @return array<string,mixed>
     */
    private function adminPayload(object $row): array
    {
        return [
            'id' => $row->id,
            'name' => $row->name,
            'email' => $row->email,
            'phone' => $row->phone ?? null,
            'role' => $row->role ?? null,
            'locale' => $row->locale ?? null,
            'source' => $row->source ?? null,
            'message' => $row->message ?? null,
            'status' => $row->status ?? 'pending',
            'created_at' => $this->iso($row->created_at ?? null),
            'updated_at' => $this->iso($row->updated_at ?? null),
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
}
