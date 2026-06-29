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
 * End-to-end completeness coverage for the chat data/CRUD/read-state surface
 * that the existing messaging suites don't already exercise:
 *   - blocked-user rejection on the SEND path (either block direction),
 *   - attachment access control + moderation redaction in the thread,
 *   - per-conversation unread_count + /me/unread-counts consistency + mark-read,
 *   - keyset pagination stability when many messages share one timestamp.
 *
 * Drives the controller directly over in-memory sqlite (mirrors the sibling
 * Messaging* tests). 'log' broadcast keeps broadcastingEnabled() false so no
 * Reverb connection is needed.
 */
class MessagingChatCompletenessTest extends TestCase
{
    private const USER_ONE = '00000000-0000-4000-8000-000000000101';

    private const USER_TWO = '00000000-0000-4000-8000-000000000102';

    private const OUTSIDER = '00000000-0000-4000-8000-000000000103';

    private const CONVERSATION = '00000000-0000-4000-8000-000000000201';

    private const MESSAGE = '00000000-0000-4000-8000-000000000301';

    private MessagingController $controller;

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
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
            $table->text('attachment_url')->nullable();
            $table->string('attachment_type')->nullable();
            $table->string('idempotency_key')->nullable();
            $table->timestamp('created_at')->nullable();
        });
        Schema::create('user_blocks', function ($table): void {
            $table->string('blocker_user_id');
            $table->string('blocked_user_id');
        });
        Schema::create('moderation_hides', function ($table): void {
            $table->string('id')->primary();
            $table->string('target_kind');
            $table->string('target_id');
            $table->timestamp('cleared_at')->nullable();
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
        Schema::create('game_invitations', function ($table): void {
            $table->string('invitee_user_id');
            $table->string('status');
        });
        Schema::create('squad_members', function ($table): void {
            $table->string('user_id');
            $table->string('status');
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
        foreach ([
            'squad_members', 'game_invitations', 'notifications', 'moderation_hides',
            'user_blocks', 'messages', 'conversation_participants', 'conversations', 'users',
        ] as $table) {
            Schema::dropIfExists($table);
        }

        parent::tearDown();
    }

    // --- Blocked-user enforcement on the SEND path ---------------------------

    public function test_send_message_rejected_when_recipient_blocked_me(): void
    {
        DB::table('user_blocks')->insert(['blocker_user_id' => self::USER_TWO, 'blocked_user_id' => self::USER_ONE]);

        $this->expectExceptionApiStatus(403, fn () => $this->controller->sendMessage(
            $this->req(self::USER_ONE, 'POST', ['body' => 'hi']),
            self::CONVERSATION
        ));
        $this->assertSame(0, DB::table('messages')->count(), 'no message may persist when blocked');
    }

    public function test_send_message_rejected_when_i_blocked_recipient(): void
    {
        DB::table('user_blocks')->insert(['blocker_user_id' => self::USER_ONE, 'blocked_user_id' => self::USER_TWO]);

        $this->expectExceptionApiStatus(403, fn () => $this->controller->sendMessage(
            $this->req(self::USER_ONE, 'POST', ['body' => 'hi']),
            self::CONVERSATION
        ));
        $this->assertSame(0, DB::table('messages')->count());
    }

    // --- Attachment access control + moderation redaction --------------------

    public function test_thread_returns_attachment_url_to_participant(): void
    {
        $this->seedAttachmentMessage();

        $data = $this->controller->thread($this->req(self::USER_ONE), self::CONVERSATION)->getData(true);

        $this->assertCount(1, $data['messages']);
        $this->assertSame('https://cdn.linkfit.az/a.jpg', $data['messages'][0]['attachment_url']);
        $this->assertSame('image', $data['messages'][0]['attachment_type']);
    }

    public function test_thread_attachment_is_forbidden_for_non_participant(): void
    {
        $this->seedAttachmentMessage();

        // The outsider cannot read the thread at all -> the attachment_url is
        // never disclosed to a non-participant.
        $this->expectExceptionApiStatus(403, fn () => $this->controller->thread($this->req(self::OUTSIDER), self::CONVERSATION));
    }

    public function test_thread_redacts_moderation_hidden_attachment(): void
    {
        $this->seedAttachmentMessage();
        DB::table('moderation_hides')->insert([
            'id' => '00000000-0000-4000-8000-000000000401',
            'target_kind' => 'message',
            'target_id' => self::MESSAGE,
            'cleared_at' => null,
        ]);

        $data = $this->controller->thread($this->req(self::USER_ONE), self::CONVERSATION)->getData(true);
        $msg = $data['messages'][0];

        $this->assertSame('[This message was removed by moderation]', $msg['body']);
        $this->assertNull($msg['attachment_url']);
        $this->assertNull($msg['attachment_type']);
        $this->assertTrue($msg['moderated']);
    }

    // --- Unread counts + mark-read ------------------------------------------

    public function test_inbox_unread_count_and_badge_reflect_messages_from_other(): void
    {
        $this->seedUnreadMessagesFromOther(2);

        $item = $this->inboxItem(self::USER_ONE);
        $this->assertTrue($item['unread']);
        $this->assertSame(2, $item['unread_count'], 'two unread messages from the other side');

        $counts = $this->controller->unreadCounts($this->req(self::USER_ONE))->getData(true);
        // The badge counts unread CONVERSATIONS (1), not unread messages (2).
        $this->assertSame(1, $counts['messages']);
    }

    public function test_mark_read_clears_unread_count_and_badge(): void
    {
        $this->seedUnreadMessagesFromOther(2);

        $this->controller->markConversationRead($this->req(self::USER_ONE, 'POST'), self::CONVERSATION);

        $item = $this->inboxItem(self::USER_ONE);
        $this->assertFalse($item['unread']);
        $this->assertSame(0, $item['unread_count']);

        $counts = $this->controller->unreadCounts($this->req(self::USER_ONE))->getData(true);
        $this->assertSame(0, $counts['messages']);
    }

    public function test_own_last_message_is_never_unread_for_sender(): void
    {
        // A message I sent must not inflate MY unread_count/badge.
        DB::table('messages')->insert([
            'id' => self::MESSAGE,
            'conversation_id' => self::CONVERSATION,
            'sender_user_id' => self::USER_ONE,
            'body' => 'mine',
            'created_at' => now()->subMinute(),
        ]);
        DB::table('conversations')->where('id', self::CONVERSATION)->update(['last_message_at' => now()->subMinute()]);
        DB::table('conversation_participants')
            ->where('conversation_id', self::CONVERSATION)
            ->where('user_id', self::USER_ONE)
            ->update(['last_read_at' => now()]);

        $item = $this->inboxItem(self::USER_ONE);
        $this->assertFalse($item['unread']);
        $this->assertSame(0, $item['unread_count']);
        $this->assertTrue($item['last_message_mine']);
    }

    // --- Keyset pagination stability across equal timestamps -----------------

    public function test_thread_pagination_is_stable_across_same_timestamp_messages(): void
    {
        // Five messages sharing ONE created_at; only the id tie-break orders
        // them. Paging must not skip or repeat a row.
        $ts = '2026-06-20T11:00:00.000Z';
        $rows = [];
        foreach (range(1, 5) as $i) {
            $rows[] = [
                'id' => "msg-{$i}",
                'conversation_id' => self::CONVERSATION,
                'sender_user_id' => self::USER_ONE,
                'body' => "m{$i}",
                'created_at' => $ts,
            ];
        }
        DB::table('messages')->insert($rows);

        $page1 = $this->controller->thread($this->req(self::USER_ONE, 'GET', ['limit' => 2]), self::CONVERSATION)->getData(true);
        $this->assertSame(['m4', 'm5'], array_column($page1['messages'], 'body'));
        $this->assertNotNull($page1['next_cursor']);

        $page2 = $this->controller->thread($this->req(self::USER_ONE, 'GET', ['before' => $page1['next_cursor'], 'limit' => 2]), self::CONVERSATION)->getData(true);
        $this->assertSame(['m2', 'm3'], array_column($page2['messages'], 'body'));
        $this->assertNotNull($page2['next_cursor']);

        $page3 = $this->controller->thread($this->req(self::USER_ONE, 'GET', ['before' => $page2['next_cursor'], 'limit' => 2]), self::CONVERSATION)->getData(true);
        $this->assertSame(['m1'], array_column($page3['messages'], 'body'));
        $this->assertNull($page3['next_cursor']);
    }

    // --- helpers -------------------------------------------------------------

    private function seedAttachmentMessage(): void
    {
        DB::table('messages')->insert([
            'id' => self::MESSAGE,
            'conversation_id' => self::CONVERSATION,
            'sender_user_id' => self::USER_TWO,
            'body' => 'check this out',
            'attachment_url' => 'https://cdn.linkfit.az/a.jpg',
            'attachment_type' => 'image',
            'created_at' => now()->subMinute(),
        ]);
    }

    private function seedUnreadMessagesFromOther(int $count): void
    {
        $rows = [];
        for ($i = 0; $i < $count; $i++) {
            $rows[] = [
                'id' => sprintf('00000000-0000-4000-8000-0000000003%02d', $i),
                'conversation_id' => self::CONVERSATION,
                'sender_user_id' => self::USER_TWO,
                'body' => "unread-{$i}",
                'created_at' => now()->subMinutes($count - $i + 1),
            ];
        }
        DB::table('messages')->insert($rows);
        DB::table('conversations')->where('id', self::CONVERSATION)->update(['last_message_at' => now()->subMinute()]);
    }

    private function inboxItem(string $userId): array
    {
        $data = $this->controller->conversations($this->req($userId))->getData(true);
        $rows = array_values(array_filter($data['items'], fn ($i) => $i['id'] === self::CONVERSATION));
        $this->assertCount(1, $rows);

        return $rows[0];
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
