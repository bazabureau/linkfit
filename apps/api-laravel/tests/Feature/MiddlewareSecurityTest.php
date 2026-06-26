<?php

namespace Tests\Feature;

use App\Http\Middleware\PortalRoleGuard;
use App\Http\Middleware\RequestId;
use App\Models\User;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Tests\TestCase;

/**
 * Guards owned by the auth/authz/gate slice. These exercise the middleware
 * directly (no DB / HTTP) so they stay fast and deterministic, matching
 * {@see PortalRoleGuardTest}.
 */
class MiddlewareSecurityTest extends TestCase
{
    // ── PortalRoleGuard: owner-application flow is a CONSUMER surface ──────

    public function test_consumer_can_reach_owner_applications(): void
    {
        $response = $this->guardFor('/api/v1/owner/applications', 'POST', null);

        $this->assertSame(200, $response->getStatusCode());
    }

    public function test_consumer_can_read_own_owner_applications(): void
    {
        $response = $this->guardFor('/api/v1/owner/applications', 'GET', null);

        $this->assertSame(200, $response->getStatusCode());
    }

    public function test_partner_can_reach_owner_applications(): void
    {
        $response = $this->guardFor('/api/v1/owner/applications', 'GET', 'partner');

        $this->assertSame(200, $response->getStatusCode());
    }

    public function test_admin_can_reach_owner_applications(): void
    {
        $response = $this->guardFor('/api/v1/owner/applications', 'POST', 'admin');

        $this->assertSame(200, $response->getStatusCode());
    }

    /**
     * The exemption is scoped to applications only — any future genuine
     * owner-portal path is still role-guarded as defense-in-depth.
     */
    public function test_consumer_still_blocked_from_other_owner_paths(): void
    {
        $this->expectException(ApiException::class);
        $this->expectExceptionMessage('Owner access required');

        $this->guardFor('/api/v1/owner/dashboard', 'GET', null);
    }

    // ── PortalRoleGuard: portal prefixes stay locked to their roles ───────

    public function test_consumer_cannot_reach_partner_routes(): void
    {
        $this->expectException(ApiException::class);
        $this->expectExceptionMessage('Partner access required');

        $this->guardFor('/api/v1/partner/bookings', 'GET', null);
    }

    public function test_consumer_cannot_reach_coach_routes(): void
    {
        $this->expectException(ApiException::class);
        $this->expectExceptionMessage('Coach access required');

        $this->guardFor('/api/v1/coach/lessons', 'GET', null);
    }

    public function test_partner_cannot_reach_admin_routes(): void
    {
        $this->expectException(ApiException::class);
        $this->expectExceptionMessage('Admin access required');

        $this->guardFor('/api/v1/admin/users', 'GET', 'partner');
    }

    public function test_coach_can_reach_coach_routes(): void
    {
        $response = $this->guardFor('/api/v1/coach/lessons', 'GET', 'coach');

        $this->assertSame(200, $response->getStatusCode());
    }

    public function test_moderator_can_reach_partner_and_coach_routes(): void
    {
        $this->assertSame(200, $this->guardFor('/api/v1/partner/venue', 'GET', 'moderator')->getStatusCode());
        $this->assertSame(200, $this->guardFor('/api/v1/coach/bootstrap', 'GET', 'moderator')->getStatusCode());
    }

    public function test_consumer_passes_through_non_portal_routes(): void
    {
        $response = $this->guardFor('/api/v1/me', 'GET', null);

        $this->assertSame(200, $response->getStatusCode());
    }

    public function test_unauthenticated_request_passes_to_next_for_route_to_resolve(): void
    {
        // No auth_user attribute → guard defers (the route/JWT layer decides).
        $guard = app(PortalRoleGuard::class);
        $request = Request::create('/api/v1/admin/users', 'GET');

        $response = $guard->handle($request, fn () => response()->json(['ok' => true]));

        $this->assertSame(200, $response->getStatusCode());
    }

    // ── RequestId: inbound id is sanitised against log/header injection ───

    public function test_well_formed_request_id_is_preserved(): void
    {
        $request = Request::create('/api/v1/me', 'GET');
        $request->headers->set('X-Request-Id', 'req-12345_abc.DEF');

        $response = $this->runRequestId($request);

        $this->assertSame('req-12345_abc.DEF', $request->attributes->get('request_id'));
        $this->assertSame('req-12345_abc.DEF', $response->headers->get('X-Request-Id'));
    }

    public function test_injected_request_id_is_replaced_with_uuid(): void
    {
        $request = Request::create('/api/v1/me', 'GET');
        $request->headers->set('X-Request-Id', "abc\r\nSet-Cookie: pwned=1");

        $response = $this->runRequestId($request);

        $id = (string) $request->attributes->get('request_id');
        $this->assertStringNotContainsString("\n", $id);
        $this->assertStringNotContainsString('pwned', $id);
        $this->assertMatchesRegularExpression('/^[0-9a-f-]{36}$/', $id);
        $this->assertSame($id, $response->headers->get('X-Request-Id'));
    }

    public function test_overlong_request_id_is_replaced_with_uuid(): void
    {
        $request = Request::create('/api/v1/me', 'GET');
        $request->headers->set('X-Request-Id', str_repeat('a', 200));

        $this->runRequestId($request);

        $this->assertMatchesRegularExpression('/^[0-9a-f-]{36}$/', (string) $request->attributes->get('request_id'));
    }

    public function test_missing_request_id_generates_uuid(): void
    {
        $request = Request::create('/api/v1/me', 'GET');

        $this->runRequestId($request);

        $this->assertMatchesRegularExpression('/^[0-9a-f-]{36}$/', (string) $request->attributes->get('request_id'));
    }

    // ── helpers ───────────────────────────────────────────────────────────

    private function guardFor(string $path, string $method, ?string $role)
    {
        $guard = app(PortalRoleGuard::class);
        $request = Request::create($path, $method);
        $request->attributes->set('auth_user', $this->userWithRole($role));

        return $guard->handle($request, fn () => response()->json(['ok' => true]));
    }

    private function runRequestId(Request $request)
    {
        return (new RequestId)->handle($request, fn () => response()->json(['ok' => true]));
    }

    private function userWithRole(?string $role): User
    {
        $user = new User;
        $user->forceFill([
            'id' => '00000000-0000-4000-8000-000000000901',
            'admin_role' => $role,
        ]);

        return $user;
    }
}
