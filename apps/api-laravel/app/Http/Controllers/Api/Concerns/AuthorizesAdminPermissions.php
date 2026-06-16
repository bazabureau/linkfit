<?php

namespace App\Http\Controllers\Api\Concerns;

use App\Support\ApiException;
use Illuminate\Http\Request;

trait AuthorizesAdminPermissions
{
    protected function requireAdminPermission(Request $request, string $permission): object
    {
        $user = $this->authUser($request);
        if (! in_array($user->admin_role, ['admin', 'moderator'], true)) {
            throw ApiException::forbidden('Admin access required');
        }
        if ($user->admin_role === 'moderator' && ! $this->hasAdminPermission($user, $permission)) {
            throw ApiException::forbidden('Admin permission required: '.$permission);
        }

        return $user;
    }

    protected function requirePlatformAdmin(Request $request): object
    {
        $user = $this->authUser($request);
        if ($user->admin_role !== 'admin') {
            throw ApiException::forbidden('Admin permission required');
        }

        return $user;
    }

    protected function hasAdminPermission(object $user, string $permission): bool
    {
        $permissions = $this->normalizeAdminPermissions(
            json_decode((string) ($user->staff_permissions ?? ''), true) ?: null,
            (string) $user->admin_role === 'admin'
        );

        return (bool) ($permissions[$permission] ?? false);
    }

    protected function normalizeAdminPermissions(?array $permissions, bool $adminDefaults = false): array
    {
        $base = [
            'dashboard' => true,
            'users' => $adminDefaults,
            'staff' => $adminDefaults,
            'venues' => true,
            'courts' => true,
            'bookings' => true,
            'games' => true,
            'tournaments' => true,
            'reports' => true,
            'reviews' => true,
            'operations' => $adminDefaults,
            'media' => true,
            'push_jobs' => $adminDefaults,
            'revenue' => $adminDefaults,
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
}
