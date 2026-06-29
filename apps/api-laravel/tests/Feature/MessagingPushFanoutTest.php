<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\MessagingController;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Notification + push fan-out on message send (the broadcast/push area).
 *
 * Covers: title = sender name, moderation-safe attachment preview, a push job
 * enqueued with the deep-link payload, and that the sender / left / blocked /
 * suspended / soft-deleted participants never get a notification or push job.
 */
class MessagingPushFanoutTest extends TestCase
{
    private const SENDER = '00000000-0000-4000-8000-000000000301';

    private const RECIPIENT = '00000000-0000-4000-8000-000000000302';

    private const THIRD = '00000000-0000-4000-8000-000000000303';

    private const DIRECT = '00000000-0000-4000-8000-000000000401';

    private const GROUP = '00000000-0000-4000-8000-000000000402';

    private MessagingController $controller;

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
        // 'log' short-circuits the broadcast guards so the fan-out under test
        // runs without a Reverb connection; the notification/push enqueue is
        // unconditional and independent of broadcasting.
        config()->set('broadcasting.default', 'log');
        config()->set('media.allowed_hosts', ['api.linkfit.az']);
        DB::purge('sqlite');
        DB::reconnect('sqlite');

        Schema::create('users', function ($table): void {
            $table->string('id')->primary();
            $table->string('display_name')->nullable();
            $table->string('photo_url')->nullable();
            $table->timestamp('last_seen_at')->nullable();
            $table->timestamp('deleted_at')->nullable();
            $table->timestamp('suspended_at')->nullable();
        });

        Schema::create('conversations', function ($table): void {
            $table->string('id')->primary();
            $table->string('kind')->default('direct');
            $table->string('title')->nullable();
            $table->string('game_id')->nullable();
            $table->string('tournament_id')->nullable();
            $table->timestamp('created_at')->nullable();
            $table->timestamp('last_message_at')->nullable();
        });

        Schema::create('conversation_participants', function ($table): void {
            $table->string('conversation_id');
            $table->string('user_id');
            $table->timestamp('last_read_at')->nullable();
            $table->timestamp('left_at')->nullable();
            $table->primary(['conversation_id', 'user_id']);
        });

        Schema::create('messages', function ($table): void {
            $table->string('id')->primary();
            $table->string('conversation_id');
            $table->string('sender_user_id');
            $table->text('body')->nullable();
            $table->string('attachment_url')->nullable();
            $table->string('attachment_type')->nullable();
            $table->string('idempotency_key')->nullable();
            $table->timestamp('created_at')->nullable();
        });

        Schema::create('api_idempotency_keys', function ($table): void {
            $table->string('id')->primary();
            $table->string('user_id');
            $table->string('route_key');
            $table->string('idempotency_key');
            $table->string('request_hash');
            $table->string('status')->default('processing');
            $table->unsignedSmallInteger('response_status')->nullable();
            $table->text('response_body')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();
            $table->unique(['user_id', 'route_key', 'idempotency_key']);
        });

        Schema::create('notifications', function ($table): void {
            $table->string('id')->primary();
            $table->string('user_id');
            $table->string('type');
            $table->string('title');
            $table->text('body');
            $table->text('payload')->nullable();
            $table->timestamp('read_at')->nullable();
            $table->timestamp('created_at')->nullable();
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

        Schema::create('user_blocks', function ($table): void {
            $table->string('blocker_user_id');
            $table->string('blocked_user_id');
        });

        DB::table('users')->insert([
            ['id' => self::SENDER, 'display_name' => 'Aysel', 'photo_url' => 'https://api.linkfit.az/p/aysel.jpg', 'last_seen_at' => now()],
            ['id' => self::RECIPIENT, 'display_name' => 'Murad', 'photo_url' => null, 'last_seen_at' => now()],
            ['id' => self::THIRD, 'display_name' => 'Nigar', 'photo_url' => null, 'last_seen_at' => now()],
        ]);
        DB::table('conversations')->insert([
            ['id' => self::DIRECT, 'kind' => 'direct', 'title' => null, 'created_at' => now()],
            ['id' => self::GROUP, 'kind' => 'group', 'title' => 'Game chat', 'created_at' => now()],
        ]);
        DB::table('conversation_participants')->insert([
            ['conversation_id' => self::DIRECT, 'user_id' => self::SENDER],
            ['conversation_id' => self::DIRECT, 'user_id' => self::RECIPIENT],
            ['conversation_id' => self::GROUP, 'user_id' => self::SENDER],
            ['conversation_id' => self::GROUP, 'user_id' => self::RECIPIENT],
            ['conversation_id' => self::GROUP, 'user_id' => self::THIRD],
        ]);

        $this->controller = app(MessagingController::class);
    }

    protected function tearDown(): void
    {
        foreach (['user_blocks', 'push_notification_jobs', 'notifications', 'api_idempotency_keys', 'messages', 'conversation_participants', 'conversations', 'users'] as $table) {
            Schema::dropIfExists($table);
        }

        parent::tearDown();
    }

    public function test_recipient_notification_titled_with_sender_and_enqueues_push_job(): void
    {
        $response = $this->controller->sendMessage($this->requestFor(self::SENDER, ['body' => 'Salam']), self::DIRECT);
        $this->assertSame(201, $response->getStatusCode());

        $notification = DB::table('notifications')->where('user_id', self::RECIPIENT)->first();
        $this->assertNotNull($notification);
        $this->assertSame('message_received', $notification->type);
        $this->assertSame('Aysel', $notification->title);
        $this->assertSame('Salam', $notification->body);
        $payload = json_decode($notification->payload, true);
        $this->assertSame(self::DIRECT, $payload['conversation_id']);
        $this->assertSame(self::SENDER, $payload['sender_user_id']);
        $this->assertSame('https://api.linkfit.az/p/aysel.jpg', $payload['sender_photo_url']);

        // A matching push job (the APNs/FCM channel) carries the same deep-link
        // payload so a tap opens conversation_id → /chat/{id}.
        $job = DB::table('push_notification_jobs')->where('user_id', self::RECIPIENT)->first();
        $this->assertNotNull($job);
        $this->assertSame('Aysel', $job->title);
        $this->assertSame('Salam', $job->body);
        $this->assertSame(self::DIRECT, json_decode($job->payload, true)['conversation_id']);
    }

    public function test_sender_is_never_notified_of_their_own_message(): void
    {
        $this->controller->sendMessage($this->requestFor(self::SENDER, ['body' => 'Salam']), self::DIRECT);

        $this->assertSame(0, DB::table('notifications')->where('user_id', self::SENDER)->count());
        $this->assertSame(0, DB::table('push_notification_jobs')->where('user_id', self::SENDER)->count());
    }

    public function test_attachment_only_message_uses_moderation_safe_preview(): void
    {
        $this->controller->sendMessage($this->requestFor(self::SENDER, [
            'attachment_url' => 'https://api.linkfit.az/storage/uploads/court.jpg',
            'attachment_type' => 'image',
        ]), self::DIRECT);

        $notification = DB::table('notifications')->where('user_id', self::RECIPIENT)->first();
        $this->assertSame('Sent a photo', $notification->body);
        // The raw attachment URL must never leak into the push body.
        $this->assertStringNotContainsString('court.jpg', (string) $notification->body);
    }

    public function test_left_participant_is_not_notified(): void
    {
        DB::table('conversation_participants')
            ->where('conversation_id', self::GROUP)
            ->where('user_id', self::THIRD)
            ->update(['left_at' => now()]);

        $this->controller->sendMessage($this->requestFor(self::SENDER, ['body' => 'Match at 7?']), self::GROUP);

        $this->assertSame(0, DB::table('notifications')->where('user_id', self::THIRD)->count());
        $this->assertSame(1, DB::table('notifications')->where('user_id', self::RECIPIENT)->count());
    }

    public function test_soft_deleted_recipient_is_not_notified(): void
    {
        DB::table('users')->where('id', self::THIRD)->update(['deleted_at' => now()]);

        $this->controller->sendMessage($this->requestFor(self::SENDER, ['body' => 'Match at 7?']), self::GROUP);

        $this->assertSame(0, DB::table('notifications')->where('user_id', self::THIRD)->count());
        $this->assertSame(0, DB::table('push_notification_jobs')->where('user_id', self::THIRD)->count());
        $this->assertSame(1, DB::table('notifications')->where('user_id', self::RECIPIENT)->count());
    }

    public function test_suspended_recipient_is_not_notified(): void
    {
        DB::table('users')->where('id', self::THIRD)->update(['suspended_at' => now()]);

        $this->controller->sendMessage($this->requestFor(self::SENDER, ['body' => 'Match at 7?']), self::GROUP);

        $this->assertSame(0, DB::table('notifications')->where('user_id', self::THIRD)->count());
        $this->assertSame(1, DB::table('notifications')->where('user_id', self::RECIPIENT)->count());
    }

    public function test_blocked_counterpart_in_direct_thread_is_not_notified(): void
    {
        DB::table('user_blocks')->insert([
            'blocker_user_id' => self::RECIPIENT,
            'blocked_user_id' => self::SENDER,
        ]);

        // The send itself is rejected for a blocked 1:1 pair; assert no
        // notification leaks regardless of how the guard surfaces.
        try {
            $this->controller->sendMessage($this->requestFor(self::SENDER, ['body' => 'Salam']), self::DIRECT);
        } catch (\App\Support\ApiException $e) {
            // expected: blocked
        }

        $this->assertSame(0, DB::table('notifications')->where('user_id', self::RECIPIENT)->count());
        $this->assertSame(0, DB::table('push_notification_jobs')->where('user_id', self::RECIPIENT)->count());
    }

    private function requestFor(string $userId, array $body = []): Request
    {
        $request = Request::create('/api/v1/conversations/x/messages', 'POST', $body);
        $user = new User;
        $user->forceFill(['id' => $userId]);
        $request->attributes->set('auth_user', $user);

        return $request;
    }
}
