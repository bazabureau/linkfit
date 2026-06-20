<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\DiscoveryController;
use App\Services\Membership\MembershipService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class DiscoveryAccessPayloadTest extends TestCase
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
        });

        DB::table('users')->insert([
            'id' => 'user-access-shape',
            'created_at' => now()->subYear(),
        ]);
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('memberships');
        Schema::dropIfExists('users');

        parent::tearDown();
    }

    public function test_discovery_feature_payload_hides_premium_terminology_while_subscriptions_are_private(): void
    {
        config()->set('membership.public_subscriptions_enabled', false);
        config()->set('membership.global_full_access_until', now()->addDays(50)->toIso8601String());
        config()->set('membership.free_trial_days', 0);

        $payload = $this->payload('user-access-shape', 'advanced_insights', true);

        $this->assertArrayHasKey('access', $payload);
        $this->assertTrue($payload['access']['full_access']);
        $this->assertSame([], $payload['feature_locks']);
        $this->assertArrayNotHasKey('is_premium', $payload);
        $this->assertArrayNotHasKey('premium_locked', $payload);
        $this->assertArrayNotHasKey('locked_features', $payload);
    }

    public function test_discovery_feature_payload_keeps_legacy_fields_when_subscriptions_are_public(): void
    {
        config()->set('membership.public_subscriptions_enabled', true);
        config()->set('membership.global_full_access_until', null);
        config()->set('membership.free_trial_days', 0);

        $payload = $this->payload('user-access-shape', 'advanced_insights', false);

        $this->assertFalse($payload['access']['full_access']);
        $this->assertSame([['feature' => 'advanced_insights', 'locked' => true]], $payload['feature_locks']);
        $this->assertFalse($payload['is_premium']);
        $this->assertTrue($payload['premium_locked']);
        $this->assertSame(['advanced_insights'], $payload['locked_features']);
    }

    private function payload(string $userId, string $feature, bool $allowed): array
    {
        $controller = new class extends DiscoveryController {
            public function expose(MembershipService $membership, string $userId, string $feature, bool $allowed): array
            {
                return $this->featureAccessPayload($membership, $userId, $feature, $allowed);
            }
        };

        return $controller->expose(app(MembershipService::class), $userId, $feature, $allowed);
    }
}
