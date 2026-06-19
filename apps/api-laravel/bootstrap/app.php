<?php

use App\Http\Middleware\ApiKeyGuard;
use App\Http\Middleware\JwtAuthenticate;
use App\Http\Middleware\RequestId;
use App\Http\Middleware\SecurityHeaders;
use App\Support\ErrorEnvelope;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Sentry\Laravel\Integration;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        // iOS hits absolute paths like `/api/v1/auth/login`, so we mount the
        // API route file with NO extra prefix and write the full `/api/v1/...`
        // paths in routes/api.php, matching the public API contract 1:1.
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        apiPrefix: '',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    // Real-time broadcasting: the /broadcasting/auth route is gated by our JWT
    // middleware so private channel auth uses the same Bearer token as the API.
    ->withBroadcasting(
        __DIR__.'/../routes/channels.php',
        ['middleware' => ['jwt']],
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Trust the local nginx reverse proxy + Cloudflare edge so $request->ip()
        // resolves the REAL client IP from X-Forwarded-For and can't be spoofed
        // via a forged CF-Connecting-IP / XFF header from an untrusted source.
        // Override with TRUSTED_PROXIES (comma-separated CIDRs) if the edge changes.
        $configuredProxies = array_values(array_filter(array_map(
            'trim',
            explode(',', (string) env('TRUSTED_PROXIES', '')),
        )));
        $middleware->trustProxies(
            at: $configuredProxies !== [] ? $configuredProxies : [
                '127.0.0.1', '::1',
                // Cloudflare IPv4 ranges
                '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22',
                '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18',
                '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22',
                '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
                '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
                // Cloudflare IPv6 ranges
                '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32',
                '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29',
                '2c0f:f248::/32',
            ],
            headers: Request::HEADER_X_FORWARDED_FOR
                | Request::HEADER_X_FORWARDED_HOST
                | Request::HEADER_X_FORWARDED_PORT
                | Request::HEADER_X_FORWARDED_PROTO,
        );

        // Every API request gets a request_id for
        // the error envelope + logs.
        $middleware->api(prepend: [
            RequestId::class,
        ]);
        // Rate limit (per JWT session / client IP), optional API-key gate, and
        // baseline security headers on every API response.
        $middleware->api(append: [
            'throttle:api',
            ApiKeyGuard::class,
            SecurityHeaders::class,
        ]);
        $middleware->alias([
            'jwt' => JwtAuthenticate::class,
            'throttle' => ThrottleRequests::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // Report unhandled exceptions to Sentry (no-op unless SENTRY_LARAVEL_DSN
        // is set). Capture happens before our custom render below.
        Integration::handles($exceptions);

        // Every API error leaves as the exact public envelope:
        //   { "error": { "code", "message", "request_id" } }
        $exceptions->render(function (Throwable $e, Request $request) {
            return ErrorEnvelope::fromThrowable($e, $request);
        });
    })->create();
