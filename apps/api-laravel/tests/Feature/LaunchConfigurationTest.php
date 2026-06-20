<?php

namespace Tests\Feature;

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
}
