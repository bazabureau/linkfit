<?php

use Illuminate\Support\Facades\Route;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Foundation\Http\Middleware\VerifyCsrfToken;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\View\Middleware\ShareErrorsFromSession;

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
