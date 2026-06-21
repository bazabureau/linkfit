<?php

namespace App\Http\Middleware;

use App\Models\User;
use App\Support\ApiException;
use Closure;
use Illuminate\Http\Request;

class PortalRoleGuard
{
    public function handle(Request $request, Closure $next)
    {
        $user = $request->attributes->get('auth_user');
        if (! $user instanceof User) {
            return $next($request);
        }

        $path = ltrim($request->path(), '/');
        $role = (string) ($user->admin_role ?? '');

        if (str_starts_with($path, 'api/v1/admin/') && ! in_array($role, ['admin', 'moderator'], true)) {
            throw ApiException::forbidden('Admin access required');
        }

        if (str_starts_with($path, 'api/v1/partner/') && $role !== 'partner' && ! in_array($role, ['admin', 'moderator'], true)) {
            throw ApiException::forbidden('Partner access required');
        }

        if (str_starts_with($path, 'api/v1/owner/') && $role !== 'partner' && ! in_array($role, ['admin', 'moderator'], true)) {
            throw ApiException::forbidden('Owner access required');
        }

        if (str_starts_with($path, 'api/v1/coach/') && $role !== 'coach' && ! in_array($role, ['admin', 'moderator'], true)) {
            throw ApiException::forbidden('Coach access required');
        }

        return $next($request);
    }
}
