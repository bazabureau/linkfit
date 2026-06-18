<?php

namespace App\Http\Middleware;

use App\Support\ApiException;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Optional application API-key gate. When REQUIRE_API_KEY=true, every API
 * request must carry a matching `X-API-Key` header (the app/web secret). It is
 * OFF by default so existing mobile clients keep working — enable it only after
 * shipping a client build that sends the key.
 */
class ApiKeyGuard
{
    public function handle(Request $request, Closure $next): Response
    {
        // CORS preflight carries no custom headers — never gate it.
        if ($request->isMethod('OPTIONS')) {
            return $next($request);
        }

        if (! config('app.require_api_key')) {
            return $next($request);
        }

        $expected = (string) config('app.api_key');
        $provided = (string) ($request->header('X-API-Key') ?? $request->query('api_key', ''));

        if ($expected === '' || ! hash_equals($expected, $provided)) {
            throw ApiException::forbidden('Invalid or missing API key');
        }

        return $next($request);
    }
}
