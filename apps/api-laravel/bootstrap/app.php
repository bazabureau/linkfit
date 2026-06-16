<?php

use App\Http\Middleware\JwtAuthenticate;
use App\Http\Middleware\RequestId;
use App\Support\ErrorEnvelope;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Routing\Middleware\ThrottleRequests;

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
    ->withMiddleware(function (Middleware $middleware): void {
        // Every API request gets a request_id for
        // the error envelope + logs.
        $middleware->api(prepend: [
            RequestId::class,
        ]);
        $middleware->alias([
            'jwt' => JwtAuthenticate::class,
            'throttle' => ThrottleRequests::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // Every API error leaves as the exact public envelope:
        //   { "error": { "code", "message", "request_id" } }
        $exceptions->render(function (Throwable $e, Request $request) {
            return ErrorEnvelope::fromThrowable($e, $request);
        });
    })->create();
