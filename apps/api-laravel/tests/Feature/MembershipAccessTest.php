<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\MembershipController;
use App\Models\User;
use App\Services\Membership\MembershipService;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class MembershipAccessTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
        DB::purge('sqlite');
        DB::reconnect('sqlite');

        Schema::create('users', function ($table): void {
            $table->string('id')->primary();
            $table->timestamp('created_at')->nullable();
        });

        Schema::create('memberships', function ($table): void {
            $table->string('user_id')->primary();
            $table->string('tier')->default('free');
            $table->timestamp('current_period_end')->nullable();
            $table->boolean('cancel_at_period_end')->default(false);
            $table->string('payment_provider')->nullable();
            $table->string('provider_customer_id')->nullable();
            $table->string('provider_subscription_id')->nullable();
            $table->string('subscription_status')->nullable();
            $table->timestamp('trial_ends_at')->nullable();
            $table->timestamp('subscribed_at')->nullable();
            $table->timestamp('updated_at')->nullable();
        });

        Schema::create('games', function ($table): void {
            $table->string('id')->primary();
            $table->string('host_user_id');
            $table->timestamp('created_at')->nullable();
            $table->timestamp('deleted_at')->nullable();
        });

        Schema::create('bookings', function ($table): void {
            $table->string('id')->primary();
            $table->string('user_id');
            $table->string('status');
            $table->timestamp('created_at')->nullable();
        });
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('bookings');
        Schema::dropIfExists('games');
        Schema::dropIfExists('memberships');
        Schema::dropIfExists('users');

        parent::tearDown();
    }

    public function test_global_full_access_makes_existing_users_effectively_premium(): void
    {
        config()->set('membership.global_full_access_until', now()->addDays(50)->toIso8601String());
        config()->set('membership.free_trial_days', 0);

        DB::table('users')->insert([
            'id' => 'user-old',
            'created_at' => now()->subYears(2),
        ]);

        $state = app(MembershipService::class)->resolve('user-old');

        $this->assertSame('free', $state->tier);
        $this->assertTrue($state->is_premium);
        $this->assertTrue($state->on_trial);
        $this->assertTrue($state->global_full_access);
        $this->assertNotNull($state->trial_ends_at);
    }

    public function test_new_users_receive_50_day_full_access_from_registration(): void
    {
        config()->set('membership.global_full_access_until', null);
        config()->set('membership.free_trial_days', 50);

        DB::table('users')->insert([
            'id' => 'user-new',
            'created_at' => now()->subDays(10),
        ]);

        $state = app(MembershipService::class)->resolve('user-new');

        $this->assertSame('free', $state->tier);
        $this->assertTrue($state->is_premium);
        $this->assertTrue($state->on_trial);
        $this->assertFalse($state->global_full_access);
    }

    public function test_free_user_limits_apply_after_free_access_expires(): void
    {
        config()->set('membership.global_full_access_until', null);
        config()->set('membership.free_trial_days', 0);
        config()->set('membership.free_games_per_month', 1);

        DB::table('users')->insert([
            'id' => 'user-free',
            'created_at' => now()->subYears(2),
        ]);
        DB::table('games')->insert([
            'id' => 'game-1',
            'host_user_id' => 'user-free',
            'created_at' => now(),
            'deleted_at' => null,
        ]);

        try {
            app(MembershipService::class)->ensureCanHostGame('user-free');
            $this->fail('Expected free host-game limit to be enforced.');
        } catch (ApiException $exception) {
            $this->assertSame('PREMIUM_REQUIRED', $exception->wireCode());
            $this->assertSame(403, $exception->getStatusCode());
            $this->assertSame('This feature is not available on your current access.', $exception->getMessage());
            $this->assertFalse($exception->getDetails()['upgrade'] ?? true);
        }
    }

    public function test_effective_premium_gets_premium_feature_matrix_during_launch_access(): void
    {
        config()->set('membership.global_full_access_until', now()->addDays(50)->toIso8601String());
        config()->set('membership.free_trial_days', 0);

        DB::table('users')->insert([
            'id' => 'user-feature-launch',
            'created_at' => now()->subYear(),
        ]);

        $service = app(MembershipService::class);

        $this->assertTrue($service->canUseFeature('user-feature-launch', 'advanced_insights'));
        $this->assertTrue($service->canUseFeature('user-feature-launch', 'priority_matchmaking'));
        $this->assertContains('premium_badge', $service->featuresForUser('user-feature-launch'));
        $this->assertNotContains('premium_badge', $service->publicFeaturesForUser('user-feature-launch'));
    }

    public function test_public_user_payload_hides_subscription_state(): void
    {
        DB::table('users')->insert([
            'id' => 'user-public-shape',
            'created_at' => now()->subDay(),
        ]);
        DB::table('memberships')->insert([
            'user_id' => 'user-public-shape',
            'tier' => 'premium',
            'current_period_end' => now()->addMonth(),
            'provider_subscription_id' => 'sub_public_shape',
            'subscription_status' => 'active',
            'cancel_at_period_end' => false,
            'updated_at' => now(),
        ]);

        $user = new User();
        $user->forceFill([
            'id' => 'user-public-shape',
            'email' => 'player@example.test',
            'username' => 'player_shape',
            'display_name' => 'Player Shape',
            'created_at' => now()->subDay(),
        ]);

        $payload = $user->toPublicUser();

        $this->assertArrayNotHasKey('membership_tier', $payload);
        $this->assertArrayNotHasKey('is_premium', $payload);
        $this->assertArrayNotHasKey('on_trial', $payload);
        $this->assertArrayNotHasKey('trial_ends_at', $payload);
    }

    public function test_free_user_without_access_window_is_blocked_from_premium_features(): void
    {
        config()->set('membership.global_full_access_until', null);
        config()->set('membership.free_trial_days', 0);

        DB::table('users')->insert([
            'id' => 'user-feature-free',
            'created_at' => now()->subYear(),
        ]);

        $service = app(MembershipService::class);
        $this->assertFalse($service->canUseFeature('user-feature-free', 'advanced_insights'));

        try {
            $service->ensureFeature('user-feature-free', 'advanced_insights');
            $this->fail('Expected premium feature gate to be enforced.');
        } catch (ApiException $exception) {
            $this->assertSame('PREMIUM_REQUIRED', $exception->wireCode());
            $this->assertSame(403, $exception->getStatusCode());
            $this->assertSame('This feature is not available on your current access.', $exception->getMessage());
            $this->assertSame('advanced_insights', $exception->getDetails()['feature'] ?? null);
            $this->assertFalse($exception->getDetails()['upgrade'] ?? true);
        }
    }

    public function test_premium_required_message_mentions_upgrade_only_when_subscriptions_are_public(): void
    {
        config()->set('membership.public_subscriptions_enabled', true);
        config()->set('membership.global_full_access_until', null);
        config()->set('membership.free_trial_days', 0);

        DB::table('users')->insert([
            'id' => 'user-feature-public-subscriptions',
            'created_at' => now()->subYear(),
        ]);

        try {
            app(MembershipService::class)->ensureFeature('user-feature-public-subscriptions', 'advanced_insights');
            $this->fail('Expected premium feature gate to be enforced.');
        } catch (ApiException $exception) {
            $this->assertSame('PREMIUM_REQUIRED', $exception->wireCode());
            $this->assertSame('This feature requires Premium.', $exception->getMessage());
            $this->assertTrue($exception->getDetails()['upgrade'] ?? false);
        }
    }

    public function test_cancel_rejects_free_launch_access_without_paid_subscription(): void
    {
        config()->set('membership.public_subscriptions_enabled', true);
        config()->set('membership.global_full_access_until', now()->addDays(50)->toIso8601String());
        config()->set('membership.free_trial_days', 0);

        DB::table('users')->insert([
            'id' => 'user-free-launch',
            'created_at' => now()->subYear(),
        ]);
        DB::table('memberships')->insert([
            'user_id' => 'user-free-launch',
            'tier' => 'free',
            'cancel_at_period_end' => false,
            'updated_at' => now(),
        ]);

        try {
            app(MembershipController::class)->cancel($this->requestForUser('user-free-launch'));
            $this->fail('Expected cancel to reject non-paid launch access.');
        } catch (ApiException $exception) {
            $this->assertSame('NO_ACTIVE_SUBSCRIPTION', $exception->wireCode());
            $this->assertSame(409, $exception->getStatusCode());
        }

        $this->assertFalse((bool) DB::table('memberships')->where('user_id', 'user-free-launch')->value('cancel_at_period_end'));
    }

    public function test_cancel_rejects_manual_premium_grant_without_provider_subscription(): void
    {
        config()->set('membership.public_subscriptions_enabled', true);

        DB::table('users')->insert([
            'id' => 'user-manual-premium',
            'created_at' => now()->subYear(),
        ]);
        DB::table('memberships')->insert([
            'user_id' => 'user-manual-premium',
            'tier' => 'premium',
            'current_period_end' => now()->addMonth(),
            'provider_subscription_id' => null,
            'subscription_status' => 'manual_grant',
            'cancel_at_period_end' => false,
            'updated_at' => now(),
        ]);

        try {
            app(MembershipController::class)->cancel($this->requestForUser('user-manual-premium'));
            $this->fail('Expected cancel to reject a manual premium grant without a provider subscription.');
        } catch (ApiException $exception) {
            $this->assertSame('NO_ACTIVE_SUBSCRIPTION', $exception->wireCode());
            $this->assertSame(409, $exception->getStatusCode());
        }

        $this->assertFalse((bool) DB::table('memberships')->where('user_id', 'user-manual-premium')->value('cancel_at_period_end'));
        $this->assertTrue(app(MembershipService::class)->isPremium('user-manual-premium'));
    }

    public function test_legacy_plus_tier_is_normalized_to_premium_access(): void
    {
        config()->set('membership.public_subscriptions_enabled', true);
        config()->set('membership.global_full_access_until', null);
        config()->set('membership.free_trial_days', 0);

        DB::table('users')->insert([
            'id' => 'user-legacy-plus',
            'created_at' => now()->subYear(),
        ]);
        DB::table('memberships')->insert([
            'user_id' => 'user-legacy-plus',
            'tier' => 'plus',
            'current_period_end' => now()->addMonth(),
            'provider_subscription_id' => 'sub_legacy_plus',
            'subscription_status' => 'active',
            'cancel_at_period_end' => false,
            'updated_at' => now(),
        ]);

        $state = app(MembershipService::class)->resolve('user-legacy-plus');
        $this->assertSame('premium', $state->tier);
        $this->assertTrue($state->is_premium);

        $response = app(MembershipController::class)->show($this->requestForUser('user-legacy-plus'));
        $payload = $response->getData(true);

        $this->assertSame('premium', $payload['tier']);
        $this->assertTrue($payload['is_premium']);
        $this->assertContains('host_unlimited_games', $payload['features']);
    }

    public function test_cancel_marks_active_paid_subscription_for_period_end(): void
    {
        config()->set('membership.public_subscriptions_enabled', true);

        DB::table('users')->insert([
            'id' => 'user-paid',
            'created_at' => now()->subYear(),
        ]);
        DB::table('memberships')->insert([
            'user_id' => 'user-paid',
            'tier' => 'premium',
            'current_period_end' => now()->addMonth(),
            'provider_subscription_id' => 'sub_123',
            'subscription_status' => 'active',
            'cancel_at_period_end' => false,
            'updated_at' => now(),
        ]);

        $response = app(MembershipController::class)->cancel($this->requestForUser('user-paid'));
        $payload = $response->getData(true);

        $this->assertSame('premium', $payload['tier']);
        $this->assertTrue($payload['cancel_at_period_end']);
        $this->assertTrue((bool) DB::table('memberships')->where('user_id', 'user-paid')->value('cancel_at_period_end'));
        $this->assertSame('cancel_at_period_end', DB::table('memberships')->where('user_id', 'user-paid')->value('subscription_status'));
    }

    public function test_payment_state_stays_free_launch_while_subscriptions_are_private(): void
    {
        config()->set('membership.public_subscriptions_enabled', false);
        config()->set('membership.payments_enabled', true);
        config()->set('membership.payment_provider', 'hidden-provider');

        $freeLaunch = app(MembershipService::class)->paymentState();
        $this->assertSame('free_launch', $freeLaunch['status']);
        $this->assertFalse($freeLaunch['enabled']);
        $this->assertFalse($freeLaunch['checkout_available']);
        $this->assertFalse($freeLaunch['provider_configured']);
        $this->assertNull($freeLaunch['provider']);
    }

    public function test_payment_state_distinguishes_provider_missing_when_subscriptions_are_public(): void
    {
        config()->set('membership.public_subscriptions_enabled', true);
        config()->set('membership.payments_enabled', false);
        config()->set('membership.payment_provider', null);

        $freeLaunch = app(MembershipService::class)->paymentState();
        $this->assertSame('free_launch', $freeLaunch['status']);
        $this->assertFalse($freeLaunch['enabled']);
        $this->assertFalse($freeLaunch['checkout_available']);
        $this->assertFalse($freeLaunch['provider_configured']);

        config()->set('membership.payments_enabled', true);

        $providerMissing = app(MembershipService::class)->paymentState();
        $this->assertSame('provider_missing', $providerMissing['status']);
        $this->assertTrue($providerMissing['enabled']);
        $this->assertFalse($providerMissing['checkout_available']);
        $this->assertFalse($providerMissing['provider_configured']);
    }

    public function test_subscription_actions_are_hidden_until_public_subscriptions_are_enabled(): void
    {
        config()->set('membership.public_subscriptions_enabled', false);

        DB::table('users')->insert([
            'id' => 'user-hidden-subscriptions',
            'created_at' => now()->subYear(),
        ]);

        try {
            app(MembershipController::class)->cancel($this->requestForUser('user-hidden-subscriptions'));
            $this->fail('Expected subscription actions to be hidden.');
        } catch (ApiException $exception) {
            $this->assertSame('SUBSCRIPTIONS_NOT_AVAILABLE', $exception->wireCode());
            $this->assertSame(404, $exception->getStatusCode());
        }
    }

    public function test_membership_plans_hide_subscription_details_during_private_launch(): void
    {
        config()->set('membership.public_subscriptions_enabled', false);
        config()->set('membership.payments_enabled', true);
        config()->set('membership.payment_provider', 'hidden-provider');
        config()->set('membership.global_full_access_until', now()->addDays(50)->toIso8601String());

        $response = app(MembershipController::class)->plans();
        $payload = $response->getData(true);

        $this->assertSame('free_launch', $payload['mode']);
        $this->assertTrue($payload['access']['full_access']);
        $this->assertTrue($payload['features']['free_launch_access']);
        $this->assertFalse($payload['features']['payments']);
        $this->assertFalse($payload['features']['membership']);
        $this->assertSame('Free', $payload['feature_matrix']['free']['name']);
        $this->assertSame('Premium', $payload['feature_matrix']['premium']['name']);
        $this->assertArrayNotHasKey('plans', $payload);
        $this->assertArrayNotHasKey('payments', $payload);
    }

    public function test_subscribe_returns_free_launch_when_public_subscriptions_are_ready_but_payments_are_disabled(): void
    {
        config()->set('membership.public_subscriptions_enabled', true);
        config()->set('membership.payments_enabled', false);
        config()->set('membership.payment_provider', null);

        DB::table('users')->insert([
            'id' => 'user-public-no-payments',
            'created_at' => now()->subYear(),
        ]);

        $response = app(MembershipController::class)->subscribe($this->requestForUser(
            'user-public-no-payments',
            '/api/v1/membership/subscribe',
            ['tier' => 'premium']
        ));
        $payload = $response->getData(true);

        $this->assertSame(202, $response->getStatusCode());
        $this->assertSame('free_launch', $payload['mode']);
        $this->assertNull($payload['checkout_url']);
        $this->assertSame('premium', $payload['tier']);
        $this->assertFalse($payload['payments']['enabled']);
        $this->assertFalse($payload['payments']['checkout_available']);
    }

    public function test_subscribe_is_hidden_before_body_validation_when_subscriptions_are_disabled(): void
    {
        config()->set('membership.public_subscriptions_enabled', false);

        DB::table('users')->insert([
            'id' => 'user-hidden-subscribe',
            'created_at' => now()->subYear(),
        ]);

        try {
            app(MembershipController::class)->subscribe($this->requestForUser(
                'user-hidden-subscribe',
                '/api/v1/membership/subscribe',
                ['tier' => 'enterprise']
            ));
            $this->fail('Expected subscribe to be hidden before validating subscription fields.');
        } catch (ApiException $exception) {
            $this->assertSame('SUBSCRIPTIONS_NOT_AVAILABLE', $exception->wireCode());
            $this->assertSame(404, $exception->getStatusCode());
            $this->assertNull($exception->getDetails());
        }
    }

    public function test_billing_portal_is_hidden_until_public_subscriptions_are_enabled(): void
    {
        config()->set('membership.public_subscriptions_enabled', false);

        DB::table('users')->insert([
            'id' => 'user-hidden-portal',
            'created_at' => now()->subYear(),
        ]);

        try {
            app(MembershipController::class)->portal($this->requestForUser('user-hidden-portal', '/api/v1/me/membership/portal'));
            $this->fail('Expected billing portal to be hidden.');
        } catch (ApiException $exception) {
            $this->assertSame('SUBSCRIPTIONS_NOT_AVAILABLE', $exception->wireCode());
            $this->assertSame(404, $exception->getStatusCode());
            $this->assertNull($exception->getDetails());
        }
    }

    public function test_membership_show_returns_launch_access_without_subscription_details(): void
    {
        config()->set('membership.public_subscriptions_enabled', false);
        config()->set('membership.global_full_access_until', now()->addDays(50)->toIso8601String());
        config()->set('membership.free_trial_days', 0);

        DB::table('users')->insert([
            'id' => 'user-launch-membership',
            'created_at' => now()->subYear(),
        ]);
        DB::table('games')->insert([
            'id' => 'launch-game-1',
            'host_user_id' => 'user-launch-membership',
            'created_at' => now(),
            'deleted_at' => null,
        ]);
        DB::table('bookings')->insert([
            'id' => 'launch-booking-1',
            'user_id' => 'user-launch-membership',
            'status' => 'paid',
            'created_at' => now(),
        ]);

        $response = app(MembershipController::class)->show($this->requestForUser('user-launch-membership'));
        $payload = $response->getData(true);

        $this->assertSame('free_launch', $payload['mode']);
        $this->assertTrue($payload['access']['full_access']);
        $this->assertTrue($payload['access']['on_trial']);
        $this->assertTrue($payload['access']['global_full_access']);
        $this->assertNotNull($payload['access']['trial_ends_at']);
        $this->assertSame(1, $payload['usage']['games_this_month']);
        $this->assertSame(1, $payload['usage']['bookings_this_month']);
        $this->assertNull($payload['usage']['games_limit']);
        $this->assertSame('Free', $payload['feature_matrix']['free']['name']);
        $this->assertSame('Premium', $payload['feature_matrix']['premium']['name']);
        $this->assertFalse($payload['features']['payments']);
        $this->assertFalse($payload['features']['membership']);
        $this->assertFalse($payload['features']['premium']);
        $this->assertArrayNotHasKey('tier', $payload);
        $this->assertArrayNotHasKey('is_premium', $payload);
        $this->assertArrayNotHasKey('billing', $payload);
        $this->assertArrayNotHasKey('plans', $payload);
        $this->assertArrayNotHasKey('payments', $payload);
    }

    private function requestForUser(
        string $userId,
        string $path = '/api/v1/membership/cancel',
        array $payload = []
    ): Request
    {
        $request = Request::create($path, 'POST', $payload);
        $user = new User();
        $user->forceFill(['id' => $userId]);
        $request->attributes->set('auth_user', $user);

        return $request;
    }
}
