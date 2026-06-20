<?php

use Illuminate\Support\Facades\Route;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Foundation\Http\Middleware\VerifyCsrfToken;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\Facades\Storage;
use Illuminate\View\Middleware\ShareErrorsFromSession;

Route::get('/storage/{path}', function (string $path) {
    $path = ltrim($path, '/');
    if ($path === '' || str_contains($path, '..') || str_contains($path, '\\')) {
        abort(404);
    }

    $disk = Storage::disk('public');
    if (! $disk->exists($path)) {
        abort(404);
    }

    return response()
        ->file($disk->path($path), [
            'Cache-Control' => 'public, max-age=31536000, immutable',
            'X-Robots-Tag' => 'noindex, nofollow, noarchive',
        ]);
})->where('path', '.*')->withoutMiddleware([
    PreventRequestForgery::class,
    StartSession::class,
    ShareErrorsFromSession::class,
    ValidateCsrfToken::class,
    VerifyCsrfToken::class,
]);

Route::get('/', function () {
    return response()
        ->json([
            'error' => [
                'code' => 'NOT_FOUND',
                'message' => 'Not found',
            ],
        ], 404)
        ->header('X-Robots-Tag', 'noindex, nofollow, noarchive');
})->withoutMiddleware([
    PreventRequestForgery::class,
    StartSession::class,
    ShareErrorsFromSession::class,
    ValidateCsrfToken::class,
    VerifyCsrfToken::class,
]);
