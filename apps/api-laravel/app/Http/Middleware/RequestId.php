<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * Assigns a request_id to every request so the
 * error envelope and logs can correlate. Honours an inbound X-Request-Id.
 */
class RequestId
{
    public function handle(Request $request, Closure $next)
    {
        // Only honour a well-formed inbound id (safe token, bounded length).
        // Anything else is replaced with a fresh UUID so a client cannot inject
        // control characters into logs or the reflected response header via
        // X-Request-Id (log/header splitting).
        $inbound = (string) $request->header('X-Request-Id', '');
        $id = preg_match('/^[A-Za-z0-9._-]{1,128}$/', $inbound) === 1
            ? $inbound
            : (string) Str::uuid();
        $request->attributes->set('request_id', $id);

        $response = $next($request);
        $response->headers->set('X-Request-Id', $id);

        return $response;
    }
}
