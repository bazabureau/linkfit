<?php

namespace Tests\Feature;

use App\Services\Notifications\PushDispatcher;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use ReflectionMethod;
use Tests\TestCase;

/**
 * Push delivery pipeline (the APNs/FCM side of chat notifications).
 *
 * Verifies the dispatcher no-ops cleanly when no provider is configured (FCM
 * creds are intentionally empty in prod), that dry-run respects deliverable
 * device tokens, and that the push policy gate excludes suspended / deleted /
 * push-disabled users even after a job is queued.
 */
class PushDispatcherTest extends TestCase
{
    private const USER = '00000000-0000-4000-8000-000000000501';

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
        // No provider configured: APNs + FCM both inert (matches prod where FCM
        // creds are empty / Android is deferred).
        config()->set('services.apns.key_id', null);
        config()->set('services.apns.team_id', null);
        config()->set('services.apns.bundle_id', null);
        config()->set('services.apns.private_key_path', '');
        config()->set('services.fcm.credentials_path', '');
        DB::purge('sqlite');
        DB::reconnect('sqlite');

        Schema::create('users', function ($table): void {
            $table->string('id')->primary();
            $table->smallInteger('quiet_hours_start')->nullable();
            $table->smallInteger('quiet_hours_end')->nullable();
            $table->string('time_zone')->nullable();
            $table->timestamp('deleted_at')->nullable();
            $table->timestamp('suspended_at')->nullable();
        });

        Schema::create('notification_preferences', function ($table): void {
            $table->string('user_id');
            $table->string('type');
            $table->boolean('push_enabled');
            $table->primary(['user_id', 'type']);
        });

        Schema::create('device_tokens', function ($table): void {
            $table->string('id')->primary();
            $table->string('user_id');
            $table->string('token');
            $table->string('platform');
            $table->timestamp('last_seen')->nullable();
            $table->timestamp('revoked_at')->nullable();
        });

        Schema::create('push_notification_jobs', function ($table): void {
            $table->string('id')->primary();
            $table->string('user_id');
            $table->string('type');
            $table->string('title');
            $table->text('body');
            $table->text('payload')->nullable();
            $table->string('status')->default('pending');
            $table->timestamp('available_at')->nullable();
            $table->timestamp('sent_at')->nullable();
            $table->text('error')->nullable();
            $table->unsignedSmallInteger('attempts')->default(0);
            $table->timestamp('last_attempt_at')->nullable();
            $table->text('provider_response')->nullable();
            $table->timestamp('created_at')->nullable();
            $table->timestamp('updated_at')->nullable();
        });

        DB::table('users')->insert(['id' => self::USER, 'time_zone' => 'Asia/Baku']);
    }

    protected function tearDown(): void
    {
        foreach (['push_notification_jobs', 'device_tokens', 'notification_preferences', 'users'] as $table) {
            Schema::dropIfExists($table);
        }

        parent::tearDown();
    }

    public function test_process_no_ops_cleanly_when_no_provider_configured(): void
    {
        $this->seedJob();

        $stats = app(PushDispatcher::class)->process();

        $this->assertFalse($stats['configured']);
        $this->assertSame(0, $stats['claimed']);
        // The job is left untouched (pending) so it delivers once a provider is wired.
        $this->assertSame('pending', DB::table('push_notification_jobs')->where('user_id', self::USER)->value('status'));
    }

    public function test_dry_run_marks_sent_when_user_has_active_device_token(): void
    {
        $this->seedJob();
        DB::table('device_tokens')->insert([
            'id' => (string) Str::uuid(), 'user_id' => self::USER,
            'token' => 'tok-'.Str::random(40), 'platform' => 'ios', 'last_seen' => now(),
        ]);

        $stats = app(PushDispatcher::class)->process(100, true);

        $this->assertSame(1, $stats['claimed']);
        $this->assertSame(1, $stats['sent']);
    }

    public function test_dry_run_skips_user_without_deliverable_token(): void
    {
        $this->seedJob();

        $stats = app(PushDispatcher::class)->process(100, true);

        $this->assertSame(1, $stats['skipped']);
    }

    public function test_push_policy_enabled_for_normal_user(): void
    {
        $policy = $this->pushPolicy(self::USER);

        $this->assertTrue($policy['enabled']);
        $this->assertNull($policy['defer_until']);
    }

    public function test_push_policy_disabled_for_soft_deleted_user(): void
    {
        DB::table('users')->where('id', self::USER)->update(['deleted_at' => now()]);

        $this->assertFalse($this->pushPolicy(self::USER)['enabled']);
    }

    public function test_push_policy_disabled_for_suspended_user(): void
    {
        DB::table('users')->where('id', self::USER)->update(['suspended_at' => now()]);

        $this->assertFalse($this->pushPolicy(self::USER)['enabled']);
    }

    public function test_push_policy_disabled_when_preference_opts_out(): void
    {
        DB::table('notification_preferences')->insert([
            'user_id' => self::USER, 'type' => 'message_received', 'push_enabled' => false,
        ]);

        $this->assertFalse($this->pushPolicy(self::USER)['enabled']);
    }

    private function seedJob(): void
    {
        DB::table('push_notification_jobs')->insert([
            'id' => (string) Str::uuid(),
            'user_id' => self::USER,
            'type' => 'message_received',
            'title' => 'Aysel',
            'body' => 'Salam',
            'payload' => json_encode(['conversation_id' => 'c-1']),
            'status' => 'pending',
            'available_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function pushPolicy(string $userId): array
    {
        $dispatcher = app(PushDispatcher::class);
        $method = new ReflectionMethod($dispatcher, 'pushPolicy');
        $method->setAccessible(true);

        return $method->invoke($dispatcher, (object) ['user_id' => $userId, 'type' => 'message_received']);
    }
}
