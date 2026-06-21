<?php

namespace App\Http\Middleware;

use App\Support\ApiException;
use App\Support\ApiKeyRing;
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

        if (! ApiKeyRing::matches(
            $provided,
            (array) config('app.internal_api_keys', []),
            (array) config('app.internal_api_key_hashes', [])
        )) {
            throw ApiException::forbidden('Invalid or missing internal API key');
        }

        $request->attributes->set('linkfit_api_key_type', 'internal');
        $request->attributes->set('linkfit_api_key_fingerprint', ApiKeyRing::fingerprint($provided));

        return $next($request);
    }
}
