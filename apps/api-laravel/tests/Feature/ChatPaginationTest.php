<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\MessagingController;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Covers the additive keyset pagination on MessagingController@thread:
 *  - With NO query params it stays backward compatible (most-recent window,
 *    ascending) and still exposes the new (additive) next_cursor field.
 *  - With ?before=<cursor>&limit=N it returns the window of messages strictly
 *    OLDER than the cursor, ascending, with the next-older cursor (or null).
 *
 * Timestamps are stored as the exact zulu-millisecond ISO strings iso() emits
 * so the keyset comparison is lexical-correct under SQLite (which compares the
 * timestamp column as TEXT) — mirroring Postgres' temporal comparison in prod.
 */
class ChatPaginationTest extends TestCase
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
        // 'log' keeps broadcastingEnabled() false — thread() is read-only here.
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

        Schema::create('messages', function ($table): void {
            $table->string('id')->primary();
            $table->string('conversation_id');
            $table->string('sender_user_id');
            $table->text('body')->nullable();
            $table->string('attachment_url')->nullable();
            $table->string('attachment_type')->nullable();
            $table->timestamp('created_at')->nullable();
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

        // Five messages m1..m5, oldest -> newest, each on a distinct day so the
        // ISO timestamps order unambiguously.
        $rows = [];
        foreach (range(1, 5) as $i) {
            $rows[] = [
                'id' => "msg-{$i}",
                'conversation_id' => self::CONVERSATION,
                'sender_user_id' => self::USER_ONE,
                'body' => "m{$i}",
                'created_at' => sprintf('2026-06-%02dT11:00:00.000Z', 19 + $i),
            ];
        }
        DB::table('messages')->insert($rows);

        $this->controller = app(MessagingController::class);
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('messages');
        Schema::dropIfExists('conversation_participants');
        Schema::dropIfExists('conversations');
        Schema::dropIfExists('users');

        parent::tearDown();
    }

    public function test_thread_without_params_returns_recent_messages_ascending_and_next_cursor_field(): void
    {
        $data = $this->controller->thread($this->req(self::USER_ONE), self::CONVERSATION)->getData(true);

        // Legacy behaviour: all messages (< 500), ascending by created_at.
        $this->assertSame(['m1', 'm2', 'm3', 'm4', 'm5'], array_column($data['messages'], 'body'));
        // next_cursor is additive and present; null because no older history remains.
        $this->assertArrayHasKey('next_cursor', $data);
        $this->assertNull($data['next_cursor']);
    }

    public function test_thread_with_limit_returns_newest_window_and_a_next_cursor(): void
    {
        $data = $this->controller->thread(
            $this->req(self::USER_ONE, ['limit' => 2]),
            self::CONVERSATION
        )->getData(true);

        // Newest two, re-sorted ascending.
        $this->assertSame(['m4', 'm5'], array_column($data['messages'], 'body'));
        // Older history remains -> a cursor pointing at the oldest in the window (m4).
        $this->assertNotNull($data['next_cursor']);
    }

    public function test_thread_before_cursor_returns_the_older_window(): void
    {
        // Page 1: newest two (m4, m5) -> cursor for the next-older page.
        $page1 = $this->controller->thread(
            $this->req(self::USER_ONE, ['limit' => 2]),
            self::CONVERSATION
        )->getData(true);
        $cursor = $page1['next_cursor'];

        // Page 2: the two messages strictly OLDER than the cursor (m2, m3).
        $page2 = $this->controller->thread(
            $this->req(self::USER_ONE, ['before' => $cursor, 'limit' => 2]),
            self::CONVERSATION
        )->getData(true);

        $this->assertSame(['m2', 'm3'], array_column($page2['messages'], 'body'));
        $this->assertNotNull($page2['next_cursor'], 'm1 still remains older');

        // Page 3: only m1 is left; the cursor terminates (null).
        $page3 = $this->controller->thread(
            $this->req(self::USER_ONE, ['before' => $page2['next_cursor'], 'limit' => 2]),
            self::CONVERSATION
        )->getData(true);

        $this->assertSame(['m1'], array_column($page3['messages'], 'body'));
        $this->assertNull($page3['next_cursor']);
    }

    private function req(string $userId, array $query = []): Request
    {
        // GET params land in the query string, which is what thread() reads.
        $request = Request::create('/api/v1/test', 'GET', $query);
        $user = new User;
        $user->forceFill(['id' => $userId]);
        $request->attributes->set('auth_user', $user);

        return $request;
    }
}
