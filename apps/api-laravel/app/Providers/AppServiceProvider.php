<?php

namespace App\Providers;

use App\Mail\GmailApiTransport;
use App\Support\ApiKeyRing;
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
            $this->assertStrongApiKeys();
            $this->assertLaunchMembershipConfig();
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

    /**
     * If the global API-key gate is enabled, refuse to boot with empty, short,
     * or obvious placeholder keys. Public app keys identify our clients; they
     * are not a substitute for JWT/user authorization.
     */
    private function assertStrongApiKeys(): void
    {
        if (! (bool) config('app.require_api_key')) {
            if ($this->app->isProduction()) {
                throw new \RuntimeException(
                    'REQUIRE_API_KEY must be true in production so API routes are limited to Linkfit clients.'
                );
            }

            return;
        }

        $keys = (array) config('app.api_keys', []);
        $hashes = (array) config('app.api_key_hashes', []);
        if ($keys === [] && $hashes === []) {
            throw new \RuntimeException(
                'APP_PUBLIC_API_KEYS or APP_PUBLIC_API_KEY_HASHES must contain at least one strong client key when REQUIRE_API_KEY=true.'
            );
        }

        if ($this->app->isProduction() && $keys !== []) {
            throw new \RuntimeException(
                'APP_PUBLIC_API_KEYS must be empty in production; use APP_PUBLIC_API_KEY_HASHES instead.'
            );
        }

        ApiKeyRing::assertStrongPlainKeys('APP_PUBLIC_API_KEYS', $keys);
        ApiKeyRing::assertValidHashes('APP_PUBLIC_API_KEY_HASHES', $hashes);

        $internalKeys = (array) config('app.internal_api_keys', []);
        if ($this->app->isProduction() && $internalKeys !== []) {
            throw new \RuntimeException(
                'INTERNAL_API_KEYS must be empty in production; use INTERNAL_API_KEY_HASHES instead.'
            );
        }

        ApiKeyRing::assertStrongPlainKeys('INTERNAL_API_KEYS', $internalKeys);
        ApiKeyRing::assertValidHashes('INTERNAL_API_KEY_HASHES', (array) config('app.internal_api_key_hashes', []));
    }

    /**
     * During the launch phase subscription controls are deliberately hidden.
     * In production that mode must also provide a future global full-access
     * window, otherwise existing users could silently fall back to free-tier
     * limits while the upgrade path is not public.
     */
    private function assertLaunchMembershipConfig(): void
    {
        if ((bool) config('membership.public_subscriptions_enabled')) {
            return;
        }

        if ((bool) config('membership.payments_enabled')) {
            throw new \RuntimeException(
                'MEMBERSHIP_PAYMENTS_ENABLED must be false while public subscriptions are disabled in production.'
            );
        }

        if ((int) config('membership.free_trial_days') < 50) {
            throw new \RuntimeException(
                'FREE_TRIAL_DAYS must be at least 50 while public subscriptions are disabled in production.'
            );
        }

        $until = trim((string) config('membership.global_full_access_until'));
        $timestamp = $until !== '' ? strtotime($until) : false;
        if ($timestamp === false || $timestamp <= time()) {
            throw new \RuntimeException(
                'GLOBAL_FULL_ACCESS_UNTIL must be a future timestamp while public subscriptions are disabled in production.'
            );
        }
    }
}
