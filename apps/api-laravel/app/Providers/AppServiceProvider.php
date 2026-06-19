<?php

namespace App\Providers;

use App\Mail\GmailApiTransport;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Spatie\Health\Checks\Checks\CacheCheck;
use Spatie\Health\Checks\Checks\DatabaseCheck;
use Spatie\Health\Checks\Checks\DebugModeCheck;
use Spatie\Health\Checks\Checks\HorizonCheck;
use Spatie\Health\Checks\Checks\RedisCheck;
use Spatie\Health\Checks\Checks\UsedDiskSpaceCheck;
use Spatie\Health\Facades\Health;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        $checks = [
            DatabaseCheck::new(),
            CacheCheck::new(),
            RedisCheck::new(),
            UsedDiskSpaceCheck::new()
                ->warnWhenUsedSpaceIsAbovePercentage(80)
                ->failWhenUsedSpaceIsAbovePercentage(90),
        ];

        if ($this->app->isProduction()) {
            $checks[] = DebugModeCheck::new()->expectedToBe(false);
            // Fail fast on a missing/weak/placeholder JWT signing secret — a
            // known secret lets anyone forge access tokens (account takeover).
            $this->assertStrongJwtSecret();
        }

        if ((bool) env('HEALTH_CHECK_HORIZON', false)) {
            $checks[] = HorizonCheck::new();
        }

        Health::checks($checks);

        // Custom "gmail" mail transport — sends via the Gmail API over HTTPS
        // (host blocks SMTP ports). Activated by MAIL_MAILER=gmail.
        Mail::extend('gmail', fn (array $config) => new GmailApiTransport(
            (string) config('services.gmail.client_id'),
            (string) config('services.gmail.client_secret'),
            (string) config('services.gmail.refresh_token'),
        ));

        // Global API rate limit. Keyed by JWT session (per-token) when present so
        // many users behind one carrier/NAT IP don't share a bucket; anonymous
        // traffic uses the real client IP. `$request->ip()` is now trustworthy
        // (TrustProxies is configured in bootstrap/app.php) and NOT spoofable —
        // we no longer trust the raw CF-Connecting-IP header.
        RateLimiter::for('api', function (Request $request) {
            $token = $request->bearerToken();
            $key = $token
                ? 'tok:'.sha1($token)
                : 'ip:'.$request->ip();

            return Limit::perMinute((int) env('API_RATE_LIMIT_PER_MINUTE', 600))->by($key);
        });

        // Login: throttle per-IP AND per-email so neither a single IP nor a
        // distributed spray against one account can brute-force credentials.
        RateLimiter::for('login', function (Request $request) {
            $email = strtolower(trim((string) $request->input('email')));

            return [
                Limit::perMinute(6)->by('login-ip:'.$request->ip()),
                Limit::perMinute(6)->by('login-email:'.($email !== '' ? sha1($email) : 'unknown')),
            ];
        });

        // Password reset has two attack surfaces: code delivery abuse and
        // six-digit code guessing. Limit both per real client IP and per email.
        RateLimiter::for('password-reset-request', function (Request $request) {
            $email = strtolower(trim((string) $request->input('email')));
            $emailKey = $email !== '' ? sha1($email) : 'unknown';

            return [
                Limit::perMinute(3)->by('reset-request-ip:'.$request->ip()),
                Limit::perMinute(3)->by('reset-request-email:'.$emailKey),
            ];
        });

        RateLimiter::for('password-reset', function (Request $request) {
            $email = strtolower(trim((string) $request->input('email')));
            $emailKey = $email !== '' ? sha1($email) : 'unknown';

            return [
                Limit::perMinute(10)->by('reset-code-ip:'.$request->ip()),
                Limit::perMinute(5)->by('reset-code-email:'.$emailKey),
            ];
        });
    }

    /**
     * Abort boot in production if the access-token secret is empty, too short,
     * or still the public dev placeholder shipped in .env.example.
     */
    private function assertStrongJwtSecret(): void
    {
        $secret = (string) config('auth_tokens.access_secret');
        $isPlaceholder = str_starts_with($secret, 'dev-') || str_contains($secret, 'change-in-prod');

        if ($secret === '' || strlen($secret) < 32 || $isPlaceholder) {
            throw new \RuntimeException(
                'JWT_ACCESS_SECRET must be a strong, unique secret (>=32 chars, not the dev placeholder) in production.'
            );
        }
    }
}
