<?php

namespace App\Http\Middleware;

use App\Models\User;
use App\Services\Auth\TokenService;
use App\Support\ApiException;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Throwable;

/**
 * Validates the Bearer access token (HS256) and binds the authenticated user
 * onto the request. A missing/invalid/expired token → 401 UNAUTHENTICATED,
 * which the iOS client maps to its refresh-then-retry flow.
 */
class JwtAuthenticate
{
    private static ?bool $hasLastSeenAtColumn = null;

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
        $this->touchLastSeen((string) $user->id, $user->last_seen_at);

        return $next($request);
    }

    private function touchLastSeen(string $userId, mixed $lastSeenAt): void
    {
        self::$hasLastSeenAtColumn ??= Schema::hasColumn('users', 'last_seen_at');
        if (! self::$hasLastSeenAtColumn) {
            return;
        }

        $lastSeen = $lastSeenAt ? strtotime((string) $lastSeenAt) : false;
        if ($lastSeen !== false && $lastSeen >= now()->subSeconds(60)->getTimestamp()) {
            return;
        }

        DB::table('users')->where('id', $userId)->update(['last_seen_at' => now()]);
    }
}
