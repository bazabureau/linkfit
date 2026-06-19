<?php

namespace App\Http\Middleware;

use App\Support\ApiException;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Server-to-server secret gate. Never send these keys from browser/mobile apps.
 */
class InternalApiKeyGuard
{
    public function handle(Request $request, Closure $next): Response
    {
        if ($request->isMethod('OPTIONS')) {
            return $next($request);
        }

        $provided = (string) $request->header('X-Linkfit-Internal-Key', '');

        if ($provided === '' || ! $this->matchesAnyKey($provided, (array) config('app.internal_api_keys', []))) {
            throw ApiException::forbidden('Invalid or missing internal API key');
        }

        $request->attributes->set('linkfit_api_key_type', 'internal');

        return $next($request);
    }

    /**
     * @param  array<int,string>  $keys
     */
    private function matchesAnyKey(string $provided, array $keys): bool
    {
        foreach ($keys as $expected) {
            if ($expected !== '' && hash_equals($expected, $provided)) {
                return true;
            }
        }

        return false;
    }
}
