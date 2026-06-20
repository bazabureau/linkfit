<?php

namespace Tests\Feature;

use App\Providers\AppServiceProvider;
use ReflectionMethod;
use Tests\TestCase;

class LaunchConfigurationTest extends TestCase
{
    public function test_membership_defaults_keep_launch_access_without_public_payments(): void
    {
        $this->assertSame(50, (int) config('membership.free_trial_days'));
        $this->assertFalse((bool) config('membership.payments_enabled'));
        $this->assertFalse((bool) config('membership.public_subscriptions_enabled'));
        $this->assertSame('AZN', config('membership.currency'));
        $this->assertSame(0, (int) config('membership.premium_price_minor'));
    }

    public function test_env_example_documents_hash_only_app_keys_and_disabled_billing(): void
    {
        $envExample = (string) file_get_contents(base_path('.env.example'));

        $this->assertStringContainsString('FREE_TRIAL_DAYS=50', $envExample);
        $this->assertStringContainsString('MEMBERSHIP_PAYMENTS_ENABLED=false', $envExample);
        $this->assertStringContainsString('REQUIRE_API_KEY=false', $envExample);
        $this->assertStringContainsString('APP_PUBLIC_API_KEYS=', $envExample);
        $this->assertStringContainsString('APP_PUBLIC_API_KEY_HASHES=', $envExample);
        $this->assertStringContainsString('INTERNAL_API_KEY_HASHES=', $envExample);
    }

    public function test_production_launch_mode_requires_future_global_full_access_window(): void
    {
        $this->app->detectEnvironment(fn () => 'production');
        config()->set('membership.public_subscriptions_enabled', false);
        config()->set('membership.payments_enabled', false);
        config()->set('membership.global_full_access_until', null);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('GLOBAL_FULL_ACCESS_UNTIL must be a future timestamp');

        $this->invokeLaunchMembershipGuard();
    }

    public function test_production_launch_mode_rejects_enabled_payments(): void
    {
        $this->app->detectEnvironment(fn () => 'production');
        config()->set('membership.public_subscriptions_enabled', false);
        config()->set('membership.payments_enabled', true);
        config()->set('membership.global_full_access_until', now()->addDays(50)->toIso8601String());

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('MEMBERSHIP_PAYMENTS_ENABLED must be false');

        $this->invokeLaunchMembershipGuard();
    }

    public function test_production_launch_mode_accepts_future_global_full_access_window(): void
    {
        $this->app->detectEnvironment(fn () => 'production');
        config()->set('membership.public_subscriptions_enabled', false);
        config()->set('membership.payments_enabled', false);
        config()->set('membership.global_full_access_until', now()->addDays(50)->toIso8601String());

        $this->invokeLaunchMembershipGuard();

        $this->assertTrue(true);
    }

    public function test_production_standard_membership_mode_does_not_require_launch_window(): void
    {
        $this->app->detectEnvironment(fn () => 'production');
        config()->set('membership.public_subscriptions_enabled', true);
        config()->set('membership.payments_enabled', true);
        config()->set('membership.global_full_access_until', null);

        $this->invokeLaunchMembershipGuard();

        $this->assertTrue(true);
    }

    private function invokeLaunchMembershipGuard(): void
    {
        $provider = new AppServiceProvider($this->app);
        $method = new ReflectionMethod($provider, 'assertLaunchMembershipConfig');
        $method->setAccessible(true);
        $method->invoke($provider);
    }
}
