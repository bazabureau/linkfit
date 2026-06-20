<?php

namespace App\Http\Middleware;

use App\Support\ApiException;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Defense-in-depth for browser clients: the public app key is observable in web
 * bundles, so browser requests must also come from a Linkfit-owned origin.
 * Native/mobile clients normally send no Origin header and pass through.
 */
class BrowserOriginGuard
{
    public function handle(Request $request, Closure $next): Response
    {
        if ($request->isMethod('OPTIONS') || ! config('app.require_api_key')) {
            return $next($request);
        }

        $origin = $this->normalizeOrigin((string) $request->headers->get('Origin', ''));
        if ($origin === null) {
            return $next($request);
        }

        $allowed = array_values(array_filter(array_map(
            fn ($value) => $this->normalizeOrigin((string) $value),
            (array) config('cors.allowed_origins', []),
        )));

        if (! in_array($origin, $allowed, true)) {
            throw ApiException::forbidden('Origin is not allowed');
        }

        return $next($request);
    }

    private function normalizeOrigin(string $value): ?string
    {
        $value = rtrim(trim($value), '/');
        if ($value === '' || strtolower($value) === 'null') {
            return null;
        }

        $parts = parse_url($value);
        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        $host = strtolower((string) ($parts['host'] ?? ''));
        if (! in_array($scheme, ['http', 'https'], true) || $host === '') {
            return null;
        }

        $port = isset($parts['port']) ? ':'.(int) $parts['port'] : '';

        return "{$scheme}://{$host}{$port}";
    }
}
