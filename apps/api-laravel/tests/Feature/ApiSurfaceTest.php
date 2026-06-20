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
            ->assertJsonPath('access.mode', 'free_launch')
            ->assertJsonPath('features.payments', false)
            ->assertJsonPath('features.membership', false)
            ->assertJsonPath('features.premium', false)
            ->assertJsonPath('features.free_launch_access', true)
            ->assertJsonPath('access.full_access', true)
            ->assertJsonPath('access.on_trial', true)
            ->assertJsonPath('access.trial_ends_at', '2026-08-09T23:59:59Z')
            ->assertJsonPath('access.global_full_access', true)
            ->assertJsonMissingPath('payments')
            ->assertJsonMissingPath('membership.plans');

        $this->assertNotContains('premium_badge', $this->getJson('/api/v1/mobile/config')->json('access.features'));
    }

    public function test_mobile_config_can_expose_membership_flags_after_public_subscriptions_are_enabled(): void
    {
        config()->set('membership.public_subscriptions_enabled', true);
        config()->set('membership.payments_enabled', true);
        config()->set('membership.payment_provider', 'azerbaijan-provider');
        config()->set('membership.global_full_access_until', null);

        $this->getJson('/api/v1/mobile/config')
            ->assertOk()
            ->assertJsonPath('access.mode', 'standard')
            ->assertJsonPath('access.full_access', false)
            ->assertJsonPath('access.on_trial', false)
            ->assertJsonPath('features.payments', true)
            ->assertJsonPath('features.membership', true)
            ->assertJsonPath('features.premium', true)
            ->assertJsonPath('features.free_launch_access', false)
            ->assertJsonPath('membership.plans.free.name', 'Free')
            ->assertJsonPath('membership.plans.premium.name', 'Premium')
            ->assertJsonPath('membership.payments.status', 'adapter_pending');
    }

    public function test_app_capabilities_hide_payment_surface_during_free_access_period(): void
    {
        config()->set('membership.payments_enabled', false);
        config()->set('membership.public_subscriptions_enabled', false);

        $this->getJson('/api/v1/app/capabilities')
            ->assertOk()
            ->assertJsonMissingPath('clients.ios.membership')
            ->assertJsonMissingPath('clients.web.membership')
            ->assertJsonMissingPath('endpoints.membership_plans')
            ->assertJsonMissingPath('endpoints.me_membership')
            ->assertJsonMissingPath('endpoints.membership_subscribe')
            ->assertJsonMissingPath('endpoints.membership_portal')
            ->assertJsonMissingPath('endpoints.membership_cancel')
            ->assertJsonMissingPath('clients.ios.payment_history')
            ->assertJsonMissingPath('clients.web.payment_history')
            ->assertJsonMissingPath('endpoints.payment_history')
            ->assertJsonMissingPath('endpoints.payment_summary');
    }

    public function test_app_capabilities_hide_payment_surface_when_subscriptions_are_private_even_if_payments_are_enabled(): void
    {
        config()->set('membership.payments_enabled', true);
        config()->set('membership.public_subscriptions_enabled', false);

        $this->getJson('/api/v1/app/capabilities')
            ->assertOk()
            ->assertJsonMissingPath('clients.ios.membership')
            ->assertJsonMissingPath('clients.web.membership')
            ->assertJsonMissingPath('endpoints.membership_plans')
            ->assertJsonMissingPath('endpoints.me_membership')
            ->assertJsonMissingPath('endpoints.membership_subscribe')
            ->assertJsonMissingPath('endpoints.membership_portal')
            ->assertJsonMissingPath('endpoints.membership_cancel')
            ->assertJsonMissingPath('clients.ios.payment_history')
            ->assertJsonMissingPath('clients.web.payment_history')
            ->assertJsonMissingPath('endpoints.payment_history')
            ->assertJsonMissingPath('endpoints.payment_summary');
    }

    public function test_app_capabilities_expose_payment_surface_when_public_payments_are_enabled(): void
    {
        config()->set('membership.payments_enabled', true);
        config()->set('membership.public_subscriptions_enabled', true);

        $this->getJson('/api/v1/app/capabilities')
            ->assertOk()
            ->assertJsonPath('clients.ios.membership', true)
            ->assertJsonPath('clients.web.membership', true)
            ->assertJsonPath('endpoints.membership_plans', '/api/v1/membership/plans')
            ->assertJsonPath('endpoints.me_membership', '/api/v1/me/membership')
            ->assertJsonPath('endpoints.membership_subscribe', '/api/v1/membership/subscribe')
            ->assertJsonPath('endpoints.membership_portal', '/api/v1/me/membership/portal')
            ->assertJsonPath('endpoints.membership_cancel', '/api/v1/membership/cancel')
            ->assertJsonPath('clients.ios.payment_history', true)
            ->assertJsonPath('clients.web.payment_history', true)
            ->assertJsonPath('endpoints.payment_history', '/api/v1/payments/history')
            ->assertJsonPath('endpoints.payment_summary', '/api/v1/payments/summary');
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

        $this->assertNotContains('premium_badge', $this->getJson('/api/v1/membership/plans')->json('access.features'));
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
