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
