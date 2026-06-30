<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Route;
use Tests\TestCase;

class ApiSurfaceTest extends TestCase
{
    public function test_all_mutating_api_v1_routes_are_authenticated_unless_explicitly_public(): void
    {
        $violations = [];
        foreach (Route::getRoutes() as $route) {
            $uri = $route->uri();
            $methods = array_diff($route->methods(), ['HEAD', 'OPTIONS']);

            if (! str_starts_with($uri, 'api/v1/') || (count($methods) === 1 && in_array('GET', $methods, true))) {
                continue;
            }

            if (in_array($uri, $this->publicMutatingRoutes(), true)) {
                continue;
            }

            $middleware = $route->gatherMiddleware();
            if (! in_array('jwt', $middleware, true) && ! in_array('internal.key', $middleware, true)) {
                $violations[] = implode('|', $methods).' '.$uri;
            }
        }

        $this->assertSame([], $violations);
    }

    public function test_all_public_api_v1_routes_are_intentionally_allowlisted(): void
    {
        $unexpectedPublicRoutes = [];
        foreach (Route::getRoutes() as $route) {
            $uri = $route->uri();
            if (! str_starts_with($uri, 'api/v1/')) {
                continue;
            }

            $middleware = $route->gatherMiddleware();
            if (in_array('jwt', $middleware, true) || in_array('internal.key', $middleware, true)) {
                continue;
            }

            if (! in_array($uri, $this->publicApiRoutes(), true)) {
                $unexpectedPublicRoutes[] = $route->methods()[0].' '.$uri;
            }
        }

        $this->assertSame([], $unexpectedPublicRoutes);
    }

    public function test_public_mutating_api_v1_routes_are_explicitly_rate_limited(): void
    {
        $missingThrottle = [];
        foreach (Route::getRoutes() as $route) {
            $uri = $route->uri();
            if (! in_array($uri, $this->publicMutatingRoutes(), true)) {
                continue;
            }

            $middleware = $route->gatherMiddleware();
            $hasThrottle = collect($middleware)->contains(
                fn ($name) => is_string($name) && str_starts_with($name, 'throttle:')
            );

            if (! $hasThrottle) {
                $missingThrottle[] = $uri;
            }
        }

        $this->assertSame([], $missingThrottle);
    }

    public function test_public_discovery_routes_use_discovery_rate_limit_bucket(): void
    {
        $missingDiscoveryThrottle = [];
        foreach (Route::getRoutes() as $route) {
            $uri = $route->uri();
            if (! in_array($uri, $this->publicDiscoveryRoutes(), true)) {
                continue;
            }

            $middleware = $route->gatherMiddleware();
            if (in_array('jwt', $middleware, true) || in_array('internal.key', $middleware, true)) {
                continue;
            }

            if (! in_array('throttle:public-discovery', $middleware, true)) {
                $missingDiscoveryThrottle[] = $uri;
            }
        }

        $this->assertSame([], $missingDiscoveryThrottle);
    }

    public function test_health_returns_ok(): void
    {
        $this->getJson('/health')
            ->assertOk()
            ->assertJson(['ok' => true]);
    }

    public function test_api_root_is_closed_and_does_not_render_framework_welcome_page(): void
    {
        $this->getJson('/')
            ->assertNotFound()
            ->assertHeader('X-Robots-Tag', 'noindex, nofollow, noarchive')
            ->assertJsonPath('error.code', 'NOT_FOUND')
            ->assertJsonMissingPath('laravel');
    }

    public function test_app_metadata_reports_laravel_api(): void
    {
        $this->getJson('/api/v1/app/metadata')
            ->assertOk()
            ->assertJsonPath('api', 'laravel')
            ->assertJsonPath('api_key.header', 'X-Linkfit-App-Key')
            ->assertJsonPath('api_key.required', false)
            ->assertJsonPath('api_key.query_string_supported', false)
            ->assertJsonPath('api_key.public_client_key', true)
            ->assertJsonPath('api_key.replaces_user_auth', false);
    }

    public function test_app_metadata_reports_api_key_requirement_when_gate_is_enabled(): void
    {
        config()->set('app.require_api_key', true);
        config()->set('app.api_keys', ['test-public-client-key-1234567890abcdef']);

        $this->getJson('/api/v1/app/metadata', [
            'X-Linkfit-App-Key' => 'test-public-client-key-1234567890abcdef',
        ])
            ->assertOk()
            ->assertJsonPath('api_key.required', true)
            ->assertJsonPath('api_key.header', 'X-Linkfit-App-Key');
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

    public function test_mobile_config_exposes_full_mobile_api_contract(): void
    {
        $this->getJson('/api/v1/mobile/config')
            ->assertOk()
            ->assertJsonPath('features.messaging', true)
            ->assertJsonPath('features.voice_messages', true)
            ->assertJsonPath('features.follow_graph', true)
            ->assertJsonPath('endpoints.app.bootstrap', '/api/v1/mobile/bootstrap')
            ->assertJsonPath('endpoints.auth.login', '/api/v1/auth/login')
            ->assertJsonPath('endpoints.social.players', '/api/v1/players?q={query}&limit={limit}')
            ->assertJsonPath('endpoints.social.follow', '/api/v1/users/{id}/follow')
            ->assertJsonPath('endpoints.messaging.send_message', '/api/v1/conversations/{id}/messages')
            ->assertJsonPath('endpoints.messaging.upload_media', '/api/v1/media')
            ->assertJsonPath('endpoints.bookings.create', '/api/v1/bookings')
            ->assertJsonPath('endpoints.games.join', '/api/v1/games/{id}/join')
            ->assertJsonPath('endpoints.stories.reply', '/api/v1/stories/{id}/reply')
            ->assertJsonPath('contracts.media.multipart_field', 'file')
            ->assertJsonPath('contracts.media.message_attachment_aliases.audio', 'voice')
            ->assertJsonPath('contracts.media.max_bytes.voice', 26214400)
            ->assertJsonPath('contracts.messaging.audio_attachment_type_is_accepted_as_alias', true)
            ->assertJsonPath('contracts.payments.bank_transfer_enabled', false);
    }

    public function test_mobile_config_hides_subscription_details_during_free_access_period(): void
    {
        config()->set('membership.payments_enabled', false);
        config()->set('membership.payment_provider', null);
        config()->set('membership.free_trial_days', 50);
        config()->set('membership.global_full_access_until', '2026-08-09T23:59:59Z');

        $this->getJson('/api/v1/mobile/config')
            ->assertOk()
            ->assertJsonPath('api.auth_scheme', 'Bearer')
            ->assertJsonPath('api.user_auth_required_for_private_actions', true)
            ->assertJsonMissingPath('api.app_key_header')
            ->assertJsonPath('access.mode', 'free_launch')
            ->assertJsonPath('features.payments', false)
            ->assertJsonPath('features.membership', false)
            ->assertJsonPath('features.premium', false)
            ->assertJsonPath('features.free_launch_access', true)
            ->assertJsonPath('launch.monetization_enabled', false)
            ->assertJsonPath('launch.premium_unlocked_for_all', true)
            ->assertJsonPath('launch.booking_fee_enabled', false)
            ->assertJsonPath('launch.service_fee_minor', 0)
            ->assertJsonPath('launch.online_payment_enabled', false)
            ->assertJsonPath('launch.referral_enabled', true)
            ->assertJsonPath('launch.promo_enabled', true)
            ->assertJsonMissingPath('endpoints.membership')
            ->assertJsonPath('access.full_access', true)
            ->assertJsonPath('access.on_trial', true)
            ->assertJsonPath('access.trial_ends_at', '2026-08-09T23:59:59Z')
            ->assertJsonPath('access.global_full_access', true)
            ->assertJsonMissingPath('payments')
            ->assertJsonMissingPath('membership.plans');

        $this->assertContains('premium_badge', $this->getJson('/api/v1/mobile/config')->json('access.features'));
    }

    public function test_mobile_config_can_expose_membership_flags_after_public_subscriptions_are_enabled(): void
    {
        config()->set('membership.public_subscriptions_enabled', true);
        config()->set('membership.payments_enabled', true);
        config()->set('membership.payment_provider', 'azerbaijan-provider');
        config()->set('membership.global_full_access_until', null);
        config()->set('launch.monetization_enabled', true);
        config()->set('launch.online_payment_enabled', true);

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
        config()->set('membership.global_full_access_until', '2026-08-09T23:59:59Z');

        $this->getJson('/api/v1/app/capabilities')
            ->assertOk()
            ->assertJsonPath('api_key.header', 'X-Linkfit-App-Key')
            ->assertJsonPath('api_key.query_string_supported', false)
            ->assertJsonPath('features.monetization_enabled', false)
            ->assertJsonPath('features.premium_unlocked_for_all', true)
            ->assertJsonPath('features.booking_fee_enabled', false)
            ->assertJsonPath('features.service_fee_minor', 0)
            ->assertJsonPath('features.online_payment_enabled', false)
            ->assertJsonPath('features.referral_enabled', true)
            ->assertJsonPath('features.promo_enabled', true)
            ->assertJsonPath('launch.window_days', 50)
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
        config()->set('membership.global_full_access_until', '2026-08-09T23:59:59Z');

        $this->getJson('/api/v1/membership/plans')
            ->assertOk()
            ->assertJsonPath('access.full_access', true)
            ->assertJsonPath('features.payments', false)
            ->assertJsonPath('features.membership', false)
            ->assertJsonPath('features.premium', false)
            ->assertJsonPath('feature_matrix.free.name', 'Free')
            ->assertJsonPath('feature_matrix.premium.name', 'Premium')
            ->assertJsonPath('launch.monetization_enabled', false)
            ->assertJsonPath('launch.premium_unlocked_for_all', true)
            ->assertJsonMissingPath('plans')
            ->assertJsonMissingPath('payments');

        $this->assertContains('premium_badge', $this->getJson('/api/v1/membership/plans')->json('access.features'));
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

    /**
     * @return list<string>
     */
    private function publicApiRoutes(): array
    {
        return [
            ...$this->publicMutatingRoutes(),
            'api/v1/app/capabilities',
            'api/v1/app/metadata',
            'api/v1/app/version',
            'api/v1/auth/check',
            'api/v1/mobile/config',
            'api/v1/membership/plans',
            // Private chat media: public URL but gated by a valid temporary
            // signature ('signed' middleware), minted only for authorised viewers
            // by the message serializers — not a discovery (throttled) endpoint.
            'api/v1/media/{media}',
            'api/v1/og/{path?}',
            'api/v1/realtime/health',
            'api/v1/realtime/sse',
            'api/v1/sports',
            'api/v1/web/bootstrap',
            ...$this->publicDiscoveryRoutes(),
        ];
    }

    /**
     * @return list<string>
     */
    private function publicMutatingRoutes(): array
    {
        return [
            'api/v1/analytics/events',
            'api/v1/auth/admin/login',
            'api/v1/auth/apple',
            'api/v1/auth/coach/login',
            'api/v1/auth/google',
            'api/v1/auth/login',
            'api/v1/auth/logout',
            'api/v1/auth/owner/login',
            'api/v1/auth/refresh',
            'api/v1/auth/register',
            'api/v1/auth/request-password-reset',
            'api/v1/auth/reset-password',
            'api/v1/auth/verify-email',
            'api/v1/auth/verify-password-reset-code',
            'api/v1/bookings/quote',
            'api/v1/launch-waitlist',
            'api/v1/promo-codes/validate',
            'api/v1/support/contact',
        ];
    }

    /**
     * @return list<string>
     */
    private function publicDiscoveryRoutes(): array
    {
        return [
            'api/v1/coaches',
            'api/v1/coaches/{id}',
            'api/v1/courts',
            'api/v1/courts/{id}',
            'api/v1/courts/{id}/availability',
            'api/v1/courts/{id}/suggested-slots',
            'api/v1/feed',
            'api/v1/feed/{eventId}/comments',
            'api/v1/games',
            'api/v1/games/{id}',
            'api/v1/leaderboards/elo',
            'api/v1/lessons',
            'api/v1/lessons/{id}',
            'api/v1/links/resolve',
            'api/v1/players',
            'api/v1/rankings',
            'api/v1/search',
            'api/v1/stats',
            'api/v1/tournaments',
            'api/v1/tournaments/{id}',
            'api/v1/users/{id}/achievements',
            'api/v1/users/{id}/followers',
            'api/v1/users/{id}/following',
            'api/v1/users/{id}/profile',
            'api/v1/users/{id}/streaks',
            'api/v1/venues',
            'api/v1/venues/{id}',
            'api/v1/venues/{id}/availability',
            'api/v1/venues/{id}/rating-summary',
            'api/v1/venues/{id}/reviews',
            'api/v1/web/checkout/courts/{courtId}',
        ];
    }
}
