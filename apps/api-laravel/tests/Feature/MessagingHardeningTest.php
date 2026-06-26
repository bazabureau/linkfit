<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\MessagingController;
use App\Models\User;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Authorization / validation / robustness coverage for the messaging +
 * notifications surface that the realtime/read tests don't already exercise:
 * notification ownership (IDOR), start-conversation guards, group-join
 * membership, owner-only participant management, and the uuid route guards
 * that turn a malformed conversation id into a clean 4xx instead of a 500.
 */
class MessagingHardeningTest extends TestCase
{
    private const USER_ONE = '00000000-0000-4000-8000-000000000101';

    private const USER_TWO = '00000000-0000-4000-8000-000000000102';

    private const OUTSIDER = '00000000-0000-4000-8000-000000000103';

    private const CONVERSATION = '00000000-0000-4000-8000-000000000201';

    private const GAME = '00000000-0000-4000-8000-000000000301';

    private MessagingController $controller;

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
        // 'log' keeps broadcastingEnabled() false so write paths don't need a
        // faked Reverb connection — we only assert HTTP/DB behaviour here.
        config()->set('broadcasting.default', 'log');
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

        Schema::create('games', function ($table): void {
            $table->string('id')->primary();
            $table->string('host_user_id')->nullable();
            $table->string('name')->nullable();
        });

        Schema::create('game_participants', function ($table): void {
            $table->string('game_id');
            $table->string('user_id');
            $table->string('status')->nullable();
        });

        DB::table('users')->insert([
            ['id' => self::USER_ONE, 'display_name' => 'One', 'last_seen_at' => now()],
            ['id' => self::USER_TWO, 'display_name' => 'Two', 'last_seen_at' => now()->subMinutes(5)],
            ['id' => self::OUTSIDER, 'display_name' => 'Outsider', 'last_seen_at' => now()],
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
        Schema::dropIfExists('game_participants');
        Schema::dropIfExists('games');
        Schema::dropIfExists('user_blocks');
        Schema::dropIfExists('notifications');
        Schema::dropIfExists('conversation_participants');
        Schema::dropIfExists('conversations');
        Schema::dropIfExists('users');

        parent::tearDown();
    }

    public function test_notifications_returns_only_callers_rows_with_unread_count(): void
    {
        DB::table('notifications')->insert([
            ['id' => (string) \Illuminate\Support\Str::uuid(), 'user_id' => self::USER_ONE, 'type' => 'a', 'title' => 'T', 'body' => 'mine-unread', 'read_at' => null, 'created_at' => now()],
            ['id' => (string) \Illuminate\Support\Str::uuid(), 'user_id' => self::USER_ONE, 'type' => 'a', 'title' => 'T', 'body' => 'mine-read', 'read_at' => now(), 'created_at' => now()->subMinute()],
            ['id' => (string) \Illuminate\Support\Str::uuid(), 'user_id' => self::USER_TWO, 'type' => 'a', 'title' => 'T', 'body' => 'theirs', 'read_at' => null, 'created_at' => now()],
        ]);

        $data = $this->controller->notifications($this->req(self::USER_ONE))->getData(true);

        $bodies = array_column($data['items'], 'body');
        $this->assertCount(2, $data['items']);
        $this->assertContains('mine-unread', $bodies);
        $this->assertNotContains('theirs', $bodies, 'must not leak another user notifications');
        $this->assertSame(1, $data['unread_count']);
    }

    public function test_mark_notification_read_is_scoped_to_owner(): void
    {
        $theirs = (string) \Illuminate\Support\Str::uuid();
        DB::table('notifications')->insert([
            'id' => $theirs, 'user_id' => self::USER_TWO, 'type' => 'a', 'title' => 'T', 'body' => 'theirs', 'created_at' => now(),
        ]);

        // USER_ONE attempts to mark USER_TWO's notification read.
        $response = $this->controller->markNotificationRead($this->req(self::USER_ONE, 'POST'), $theirs);

        $this->assertSame(204, $response->getStatusCode());
        $this->assertNull(DB::table('notifications')->where('id', $theirs)->value('read_at'), 'cross-user mark must be a no-op');
    }

    public function test_mark_notification_read_with_malformed_id_is_noop_204(): void
    {
        $response = $this->controller->markNotificationRead($this->req(self::USER_ONE, 'POST'), 'not-a-uuid');
        $this->assertSame(204, $response->getStatusCode());
    }

    public function test_delete_notification_is_scoped_to_owner(): void
    {
        $theirs = (string) \Illuminate\Support\Str::uuid();
        DB::table('notifications')->insert([
            'id' => $theirs, 'user_id' => self::USER_TWO, 'type' => 'a', 'title' => 'T', 'body' => 'theirs', 'created_at' => now(),
        ]);

        $this->controller->deleteNotification($this->req(self::USER_ONE, 'DELETE'), $theirs);

        $this->assertTrue(DB::table('notifications')->where('id', $theirs)->exists(), 'cross-user delete must be a no-op');
    }

    public function test_start_conversation_with_self_is_rejected(): void
    {
        $this->expectExceptionApiStatus(422, fn () => $this->controller->startConversation(
            $this->req(self::USER_ONE, 'POST', ['other_user_id' => self::USER_ONE])
        ));
    }

    public function test_start_conversation_with_unknown_user_is_404(): void
    {
        $this->expectExceptionApiStatus(404, fn () => $this->controller->startConversation(
            $this->req(self::USER_ONE, 'POST', ['other_user_id' => '00000000-0000-4000-8000-0000000009ff'])
        ));
    }

    public function test_start_conversation_with_blocked_user_is_forbidden(): void
    {
        DB::table('user_blocks')->insert(['blocker_user_id' => self::USER_TWO, 'blocked_user_id' => self::USER_ONE]);

        $this->expectExceptionApiStatus(403, fn () => $this->controller->startConversation(
            $this->req(self::USER_ONE, 'POST', ['other_user_id' => self::USER_TWO])
        ));
    }

    public function test_start_conversation_happy_path_returns_conversation_id(): void
    {
        $data = $this->controller->startConversation(
            $this->req(self::USER_ONE, 'POST', ['other_user_id' => self::OUTSIDER])
        )->getData(true);

        $this->assertArrayHasKey('conversation_id', $data);
        $this->assertTrue(DB::table('conversation_participants')
            ->where('conversation_id', $data['conversation_id'])
            ->where('user_id', self::USER_ONE)
            ->exists());
        $this->assertTrue(DB::table('conversation_participants')
            ->where('conversation_id', $data['conversation_id'])
            ->where('user_id', self::OUTSIDER)
            ->exists());
    }

    public function test_thread_for_non_participant_is_forbidden(): void
    {
        $this->expectExceptionApiStatus(403, fn () => $this->controller->thread($this->req(self::OUTSIDER), self::CONVERSATION));
    }

    public function test_thread_with_malformed_id_is_forbidden_not_500(): void
    {
        $this->expectExceptionApiStatus(403, fn () => $this->controller->thread($this->req(self::USER_ONE), 'not-a-uuid'));
    }

    public function test_send_message_with_malformed_id_is_forbidden_not_500(): void
    {
        $this->expectExceptionApiStatus(403, fn () => $this->controller->sendMessage(
            $this->req(self::USER_ONE, 'POST', ['body' => 'hi']),
            'not-a-uuid'
        ));
    }

    public function test_open_group_conversation_for_non_member_is_forbidden(): void
    {
        DB::table('games')->insert(['id' => self::GAME, 'host_user_id' => self::USER_TWO, 'name' => 'Padel night']);

        // OUTSIDER is neither host nor a game participant.
        $this->expectExceptionApiStatus(403, fn () => $this->controller->openGroupConversation(
            $this->req(self::OUTSIDER, 'POST', ['kind' => 'game', 'target_id' => self::GAME])
        ));
        $this->assertSame(0, DB::table('conversations')->where('game_id', self::GAME)->count());
    }

    public function test_open_group_conversation_for_game_host_creates_group(): void
    {
        DB::table('games')->insert(['id' => self::GAME, 'host_user_id' => self::USER_ONE, 'name' => 'Padel night']);

        $response = $this->controller->openGroupConversation(
            $this->req(self::USER_ONE, 'POST', ['kind' => 'game', 'target_id' => self::GAME])
        );
        $data = $response->getData(true);

        $this->assertSame(201, $response->getStatusCode());
        $this->assertTrue($data['created']);
        $this->assertSame('game', $data['kind']); // response echoes the request kind
        $this->assertSame(self::GAME, $data['game_id']);
        $this->assertTrue(DB::table('conversation_participants')
            ->where('conversation_id', $data['conversation_id'])
            ->where('user_id', self::USER_ONE)
            ->whereNull('left_at')
            ->exists());
    }

    public function test_add_participant_by_non_owner_non_admin_is_forbidden(): void
    {
        // Group chat for a game whose host (owner) is USER_TWO; USER_ONE is a
        // plain participant with no admin role and must not be able to add others.
        $group = '00000000-0000-4000-8000-000000000202';
        DB::table('games')->insert(['id' => self::GAME, 'host_user_id' => self::USER_TWO, 'name' => 'Padel night']);
        DB::table('conversations')->insert(['id' => $group, 'kind' => 'group', 'title' => 'Padel night', 'game_id' => self::GAME, 'created_at' => now()]);
        DB::table('conversation_participants')->insert([
            ['conversation_id' => $group, 'user_id' => self::USER_ONE],
            ['conversation_id' => $group, 'user_id' => self::USER_TWO],
        ]);

        $this->expectExceptionApiStatus(403, fn () => $this->controller->addParticipant(
            $this->req(self::USER_ONE, 'POST', ['user_id' => self::OUTSIDER]),
            $group
        ));
        $this->assertFalse(DB::table('conversation_participants')->where('conversation_id', $group)->where('user_id', self::OUTSIDER)->exists());
    }

    public function test_add_participant_with_malformed_conversation_id_is_404(): void
    {
        $this->expectExceptionApiStatus(404, fn () => $this->controller->addParticipant(
            $this->req(self::USER_ONE, 'POST', ['user_id' => self::OUTSIDER]),
            'not-a-uuid'
        ));
    }

    private function expectExceptionApiStatus(int $status, \Closure $fn): void
    {
        try {
            $fn();
            $this->fail("Expected an ApiException with status {$status}.");
        } catch (ApiException $e) {
            $this->assertSame($status, $e->getStatusCode());
        }
    }

    private function req(string $userId, string $method = 'GET', array $params = []): Request
    {
        $request = Request::create('/api/v1/test', $method, $params);
        $user = new User;
        $user->forceFill(['id' => $userId]);
        $request->attributes->set('auth_user', $user);

        return $request;
    }
}
