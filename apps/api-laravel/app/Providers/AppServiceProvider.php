<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
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
        }

        if ((bool) env('HEALTH_CHECK_HORIZON', false)) {
            $checks[] = HorizonCheck::new();
        }

        Health::checks($checks);

        // Global API rate limit. Keyed by JWT session (per-token) when present so
        // many users behind one carrier/NAT IP don't share a bucket; anonymous
        // traffic falls back to the real client IP (Cloudflare-resolved). The
        // limit is generous — it only catches scraping/abuse, not normal use.
        RateLimiter::for('api', function (Request $request) {
            $token = $request->bearerToken();
            $key = $token
                ? 'tok:'.sha1($token)
                : 'ip:'.($request->header('CF-Connecting-IP') ?: $request->ip());

            return Limit::perMinute((int) env('API_RATE_LIMIT_PER_MINUTE', 600))->by($key);
        });
    }
}
