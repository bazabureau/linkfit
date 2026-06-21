<?php

namespace Tests\Feature;

use App\Http\Middleware\PortalRoleGuard;
use App\Models\User;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Tests\TestCase;

class PortalRoleGuardTest extends TestCase
{
    public function test_consumer_jwt_cannot_reach_admin_routes(): void
    {
        $guard = app(PortalRoleGuard::class);
        $request = Request::create('/api/v1/admin/bootstrap', 'GET');
        $request->attributes->set('auth_user', $this->userWithRole(null));

        $this->expectException(ApiException::class);
        $this->expectExceptionMessage('Admin access required');

        $guard->handle($request, fn () => response()->json(['ok' => true]));
    }

    public function test_admin_role_can_reach_admin_routes(): void
    {
        $guard = app(PortalRoleGuard::class);
        $request = Request::create('/api/v1/admin/bootstrap', 'GET');
        $request->attributes->set('auth_user', $this->userWithRole('admin'));

        $response = $guard->handle($request, fn () => response()->json(['ok' => true]));

        $this->assertSame(200, $response->getStatusCode());
    }

    private function userWithRole(?string $role): User
    {
        $user = new User;
        $user->forceFill([
            'id' => '00000000-0000-4000-8000-000000000401',
            'admin_role' => $role,
        ]);

        return $user;
    }
}
