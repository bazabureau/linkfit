<?php

namespace Tests\Feature;

use Tests\TestCase;

class ApiSurfaceTest extends TestCase
{
    public function test_health_returns_ok(): void
    {
        $this->getJson('/health')
            ->assertOk()
            ->assertJson(['ok' => true]);
    }

    public function test_app_metadata_reports_laravel_api(): void
    {
        $this->getJson('/api/v1/app/metadata')
            ->assertOk()
            ->assertJsonPath('api', 'laravel');
    }

    public function test_realtime_health_returns_polling_status(): void
    {
        $this->getJson('/api/v1/realtime/health')
            ->assertOk()
            ->assertJsonPath('transport', 'polling');
    }

    public function test_mobile_config_reports_google_login_when_any_google_client_id_is_configured(): void
    {
        config()->set('services.google.client_id', null);
        config()->set('services.google.client_ids', [
            'ios-client.apps.googleusercontent.com',
            'android-client.apps.googleusercontent.com',
        ]);

        $this->getJson('/api/v1/mobile/config')
            ->assertOk()
            ->assertJsonPath('features.google_login', true);
    }

    public function test_mobile_config_hides_subscription_details_during_free_access_period(): void
    {
        config()->set('membership.payments_enabled', false);
        config()->set('membership.payment_provider', null);
        config()->set('membership.free_trial_days', 50);
        config()->set('membership.global_full_access_until', '2026-08-09T23:59:59Z');

        $this->getJson('/api/v1/mobile/config')
            ->assertOk()
            ->assertJsonPath('api.requires_app_key', false)
            ->assertJsonPath('features.payments', false)
            ->assertJsonPath('features.membership', false)
            ->assertJsonPath('features.premium', false)
            ->assertJsonPath('features.free_launch_access', true)
            ->assertJsonPath('access.full_access', true)
            ->assertJsonMissingPath('payments')
            ->assertJsonMissingPath('membership.plans');
    }

    public function test_membership_plans_hide_subscription_details_during_free_access_period(): void
    {
        config()->set('membership.public_subscriptions_enabled', false);

        $this->getJson('/api/v1/membership/plans')
            ->assertOk()
            ->assertJsonPath('access.full_access', true)
            ->assertJsonPath('features.payments', false)
            ->assertJsonPath('features.membership', false)
            ->assertJsonPath('features.premium', false)
            ->assertJsonMissingPath('plans')
            ->assertJsonMissingPath('payments');
    }

    public function test_membership_plans_can_be_exposed_when_public_subscriptions_are_enabled(): void
    {
        config()->set('membership.public_subscriptions_enabled', true);

        $this->getJson('/api/v1/membership/plans')
            ->assertOk()
            ->assertJsonPath('plans.free.name', 'Free')
            ->assertJsonPath('plans.premium.name', 'Premium')
            ->assertJsonPath('payments.free_trial_days', 50);
    }
}
