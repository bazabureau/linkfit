<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class LaunchAnalyticsTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
        DB::purge('sqlite');
        DB::reconnect('sqlite');

        Schema::create('launch_analytics_events', function ($table): void {
            $table->string('id')->primary();
            $table->string('event', 160);
            $table->string('distinct_id', 120)->nullable();
            $table->string('user_id')->nullable();
            $table->json('properties')->nullable();
            $table->string('source', 40)->nullable();
            $table->string('ip_hash', 80)->nullable();
            $table->timestamp('occurred_at');
            $table->timestamp('created_at')->nullable();
        });
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('launch_analytics_events');
        parent::tearDown();
    }

    public function test_analytics_events_are_accepted_and_persisted_for_launch_metrics(): void
    {
        $this->postJson('/api/v1/analytics/events', [
            'events' => [
                [
                    'event' => 'launch.signup_started',
                    'distinct_id' => 'visitor-1',
                    'properties' => ['source' => 'web', 'step' => 'sport'],
                    'ts' => now('UTC')->toIso8601String(),
                ],
            ],
        ])->assertAccepted()->assertJsonPath('accepted', 1);

        $this->assertDatabaseHas('launch_analytics_events', [
            'event' => 'launch.signup_started',
            'distinct_id' => 'visitor-1',
            'source' => 'web',
        ]);
    }
}
