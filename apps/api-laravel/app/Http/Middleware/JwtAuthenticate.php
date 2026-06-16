<?php

namespace App\Http\Middleware;

use App\Models\User;
use App\Services\Auth\TokenService;
use App\Support\ApiException;
use Closure;
use Illuminate\Http\Request;
use Throwable;

/**
 * Validates the Bearer access token (HS256) and binds the authenticated user
 * onto the request. A missing/invalid/expired token → 401 UNAUTHENTICATED,
 * which the iOS client maps to its refresh-then-retry flow.
 */
class JwtAuthenticate
{
    public function __construct(private readonly TokenService $tokens) {}

    public function handle(Request $request, Closure $next)
    {
        $header = $request->header('Authorization', '');
        if (! str_starts_with($header, 'Bearer ')) {
            throw ApiException::unauthenticated('Missing bearer token');
        }
        $token = substr($header, 7);

        try {
            $claims = $this->tokens->verifyAccess($token);
        } catch (Throwable $e) {
            throw ApiException::unauthenticated('Invalid or expired token');
        }

        $user = User::whereNull('deleted_at')->find($claims->sub ?? null);
        if ($user === null) {
            throw ApiException::unauthenticated('Account not found');
        }

        $request->setUserResolver(fn () => $user);
        $request->attributes->set('auth_user', $user);
        $request->attributes->set('auth_family_id', $claims->sid ?? null);

        return $next($request);
    }
}
