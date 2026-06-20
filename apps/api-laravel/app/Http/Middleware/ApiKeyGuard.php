<?php

namespace App\Http\Middleware;

use App\Support\ApiException;
use App\Support\ApiKeyRing;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Optional application API-key gate. When REQUIRE_API_KEY=true, every API
 * request must carry a matching public Linkfit app key header. This is an app
 * identification layer, not user auth and not a private browser/mobile secret.
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

        $provided = (string) $request->header('X-Linkfit-App-Key', '');

        if (! ApiKeyRing::matches(
            $provided,
            (array) config('app.api_keys', []),
            (array) config('app.api_key_hashes', [])
        )) {
            throw ApiException::forbidden('Invalid or missing API key');
        }

        $request->attributes->set('linkfit_api_key_type', 'public_app');

        return $next($request);
    }
}
