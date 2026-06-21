<?php

namespace App\Http\Middleware;

use App\Support\ApiException;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Defense-in-depth for browser clients. Origin is not authentication, but
 * requests that declare a browser Origin should come from a Linkfit-owned
 * frontend. Native/mobile/server clients normally send no Origin header and
 * pass through.
 */
class BrowserOriginGuard
{
    public function handle(Request $request, Closure $next): Response
    {
        if ($request->isMethod('OPTIONS')) {
            return $next($request);
        }

        $rawOrigin = trim((string) $request->headers->get('Origin', ''));
        if ($rawOrigin === '') {
            return $next($request);
        }

        $origin = $this->normalizeOrigin($rawOrigin);
        if ($origin === null) {
            throw ApiException::forbidden('Origin is not allowed');
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
