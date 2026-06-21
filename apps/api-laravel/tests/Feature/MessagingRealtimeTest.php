<?php

namespace Tests\Feature;

use App\Events\ConversationTyping;
use App\Events\ConversationUpdated;
use App\Events\MessageSent;
use App\Http\Controllers\Api\MessagingController;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class MessagingRealtimeTest extends TestCase
{
    private const USER_ONE = '00000000-0000-4000-8000-000000000101';

    private const USER_TWO = '00000000-0000-4000-8000-000000000102';

    private const CONVERSATION = '00000000-0000-4000-8000-000000000201';

    private MessagingController $controller;

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
        config()->set('broadcasting.default', 'reverb');
        DB::purge('sqlite');
        DB::reconnect('sqlite');

        Schema::create('users', function ($table): void {
            $table->string('id')->primary();
            $table->string('display_name')->nullable();
            $table->string('photo_url')->nullable();
            $table->timestamp('last_seen_at')->nullable();
            $table->timestamp('deleted_at')->nullable();
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

        Schema::create('user_blocks', function ($table): void {
            $table->string('blocker_user_id');
            $table->string('blocked_user_id');
        });

        DB::table('users')->insert([
            ['id' => self::USER_ONE, 'display_name' => 'One', 'last_seen_at' => now()],
            ['id' => self::USER_TWO, 'display_name' => 'Two', 'last_seen_at' => now()->subMinutes(5)],
        ]);
        DB::table('conversations')->insert([
            'id' => self::CONVERSATION,
            'kind' => 'direct',
            'created_at' => now(),
        ]);
        DB::table('conversation_participants')->insert([
            ['conversation_id' => self::CONVERSATION, 'user_id' => self::USER_ONE],
            ['conversation_id' => self::CONVERSATION, 'user_id' => self::USER_TWO],
        ]);

        $this->controller = app(MessagingController::class);
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('user_blocks');
        Schema::dropIfExists('notifications');
        Schema::dropIfExists('api_idempotency_keys');
        Schema::dropIfExists('messages');
        Schema::dropIfExists('conversation_participants');
        Schema::dropIfExists('conversations');
        Schema::dropIfExists('users');

        parent::tearDown();
    }

    public function test_sending_message_broadcasts_message_and_inbox_update(): void
    {
        Event::fake();

        $response = $this->controller->sendMessage($this->requestFor(self::USER_ONE, ['body' => 'Salam']), self::CONVERSATION);

        $this->assertSame(201, $response->getStatusCode());
        Event::assertDispatched(MessageSent::class, fn (MessageSent $event) => $event->conversationId === self::CONVERSATION);
        Event::assertDispatched(ConversationUpdated::class, fn (ConversationUpdated $event) => $event->conversationId === self::CONVERSATION
            && $event->reason === 'message_sent'
            && in_array(self::USER_ONE, $event->userIds, true)
            && in_array(self::USER_TWO, $event->userIds, true));
    }

    public function test_audio_attachment_type_is_accepted_as_voice_alias(): void
    {
        Event::fake();

        $response = $this->controller->sendMessage($this->requestFor(self::USER_ONE, [
            'attachment_url' => 'https://api.linkfit.az/storage/uploads/voice.m4a',
            'attachment_type' => 'audio',
        ]), self::CONVERSATION);
        $payload = $response->getData(true);

        $this->assertSame(201, $response->getStatusCode());
        $this->assertSame('voice', $payload['attachment_type']);
        $this->assertSame('voice', DB::table('messages')->where('id', $payload['id'])->value('attachment_type'));
    }

    public function test_idempotency_key_replays_message_response_without_duplicate_insert(): void
    {
        Event::fake();

        $first = $this->requestFor(self::USER_ONE, ['body' => 'Retry-safe']);
        $first->headers->set('Idempotency-Key', 'message-key-123');
        $second = $this->requestFor(self::USER_ONE, ['body' => 'Retry-safe']);
        $second->headers->set('Idempotency-Key', 'message-key-123');

        $firstResponse = $this->controller->sendMessage($first, self::CONVERSATION);
        $secondResponse = $this->controller->sendMessage($second, self::CONVERSATION);

        $this->assertSame(201, $firstResponse->getStatusCode());
        $this->assertSame(201, $secondResponse->getStatusCode());
        $this->assertSame($firstResponse->getData(true)['id'], $secondResponse->getData(true)['id']);
        $this->assertSame(1, DB::table('messages')->where('body', 'Retry-safe')->count());
    }

    public function test_typing_broadcasts_to_conversation_channel(): void
    {
        Event::fake();

        $response = $this->controller->typing($this->requestFor(self::USER_ONE, ['is_typing' => true]), self::CONVERSATION);

        $this->assertSame(204, $response->getStatusCode());
        Event::assertDispatched(ConversationTyping::class, fn (ConversationTyping $event) => $event->conversationId === self::CONVERSATION
            && $event->userId === self::USER_ONE
            && $event->isTyping === true);
    }

    private function requestFor(string $userId, array $body = []): Request
    {
        $request = Request::create('/api/v1/conversations/'.self::CONVERSATION.'/messages', 'POST', $body);
        $user = new User;
        $user->forceFill(['id' => $userId]);
        $request->attributes->set('auth_user', $user);

        return $request;
    }
}
