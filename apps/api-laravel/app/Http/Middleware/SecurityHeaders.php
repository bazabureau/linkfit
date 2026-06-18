<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Baseline security response headers for every API response. The API serves
 * JSON (no embedding, no referrers), so we lock framing and content-sniffing
 * down. TLS/HSTS is handled at the nginx edge.
 */
class SecurityHeaders
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        $response->headers->set('X-Content-Type-Options', 'nosniff');
        $response->headers->set('X-Frame-Options', 'DENY');
        $response->headers->set('Referrer-Policy', 'no-referrer');
        $response->headers->set('X-Permitted-Cross-Domain-Policies', 'none');
        // The API must NEVER be indexed. This is an in-code guarantee that holds
        // even if the Cloudflare edge (which also sets this) is bypassed.
        $response->headers->set('X-Robots-Tag', 'noindex, nofollow, noarchive');

        return $response;
    }
}
