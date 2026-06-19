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
        }
    }

    public function test_cancel_rejects_free_launch_access_without_paid_subscription(): void
    {
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

    public function test_cancel_marks_active_paid_subscription_for_period_end(): void
    {
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

    public function test_payment_state_distinguishes_provider_missing_from_free_launch(): void
    {
        config()->set('membership.payments_enabled', false);
        config()->set('membership.payment_provider', null);

        $freeLaunch = app(MembershipController::class)->plans()->getData(true);
        $this->assertSame('free_launch', $freeLaunch['payments']['status']);
        $this->assertFalse($freeLaunch['payments']['checkout_available']);
        $this->assertFalse($freeLaunch['payments']['provider_configured']);

        config()->set('membership.payments_enabled', true);

        $providerMissing = app(MembershipController::class)->plans()->getData(true);
        $this->assertSame('provider_missing', $providerMissing['payments']['status']);
        $this->assertFalse($providerMissing['payments']['checkout_available']);
        $this->assertFalse($providerMissing['payments']['provider_configured']);
    }

    private function requestForUser(string $userId): Request
    {
        $request = Request::create('/api/v1/membership/cancel', 'POST');
        $user = new User();
        $user->forceFill(['id' => $userId]);
        $request->attributes->set('auth_user', $user);

        return $request;
    }
}
