<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\MessagingController;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * #4 — the inbox (conversations()) last-message preview must redact a message an
 * active moderation hide covers, mirroring thread()'s per-message redaction, so
 * a removed body/attachment never leaks through the conversation list. Drives
 * the controller directly over in-memory sqlite (mirrors MessagingHardeningTest).
 */
class MessagingInboxModerationTest extends TestCase
{
    private const ME = '00000000-0000-4000-8000-000000000201';

    private const OTHER = '00000000-0000-4000-8000-000000000202';

    private const CONVERSATION = '00000000-0000-4000-8000-000000000301';

    private const MESSAGE = '00000000-0000-4000-8000-000000000401';

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
            $table->timestamp('last_message_at')->nullable();
            $table->timestamp('created_at')->nullable();
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

        DB::table('users')->insert([
            ['id' => self::ME, 'display_name' => 'Me', 'last_seen_at' => now()],
            ['id' => self::OTHER, 'display_name' => 'Other', 'last_seen_at' => now()],
        ]);
        DB::table('conversations')->insert([
            'id' => self::CONVERSATION,
            'kind' => 'direct',
            'last_message_at' => now(),
            'created_at' => now(),
        ]);
        DB::table('conversation_participants')->insert([
            ['conversation_id' => self::CONVERSATION, 'user_id' => self::ME],
            ['conversation_id' => self::CONVERSATION, 'user_id' => self::OTHER],
        ]);
        DB::table('messages')->insert([
            'id' => self::MESSAGE,
            'conversation_id' => self::CONVERSATION,
            'sender_user_id' => self::OTHER,
            'body' => 'an abusive last message',
            'attachment_url' => 'https://cdn.linkfit.az/bad.jpg',
            'attachment_type' => 'image',
            'created_at' => now(),
        ]);
    }

    protected function tearDown(): void
    {
        foreach (['moderation_hides', 'user_blocks', 'messages', 'conversation_participants', 'conversations', 'users'] as $table) {
            Schema::dropIfExists($table);
        }

        parent::tearDown();
    }

    public function test_inbox_preview_shows_real_body_when_not_hidden(): void
    {
        $item = $this->inboxItem();

        $this->assertSame('an abusive last message', $item['last_message_body']);
        $this->assertSame('https://cdn.linkfit.az/bad.jpg', $item['last_message_attachment_url']);
        $this->assertSame('image', $item['last_message_attachment_type']);
    }

    public function test_inbox_preview_redacts_a_hidden_last_message(): void
    {
        DB::table('moderation_hides')->insert([
            'id' => '00000000-0000-4000-8000-000000000501',
            'target_kind' => 'message',
            'target_id' => self::MESSAGE,
            'cleared_at' => null,
        ]);

        $item = $this->inboxItem();

        $this->assertSame('[This message was removed by moderation]', $item['last_message_body']);
        $this->assertNull($item['last_message_attachment_url']);
        $this->assertNull($item['last_message_attachment_type']);
        // Non-content fields are unaffected — only the body/attachment is redacted.
        $this->assertSame(self::OTHER, $item['last_message_sender_id']);
    }

    public function test_inbox_preview_unredacted_once_hide_is_cleared(): void
    {
        DB::table('moderation_hides')->insert([
            'id' => '00000000-0000-4000-8000-000000000502',
            'target_kind' => 'message',
            'target_id' => self::MESSAGE,
            'cleared_at' => now(),
        ]);

        $item = $this->inboxItem();

        $this->assertSame('an abusive last message', $item['last_message_body']);
    }

    private function inboxItem(): array
    {
        $request = Request::create('/api/v1/conversations', 'GET');
        $user = new User;
        $user->forceFill(['id' => self::ME]);
        $request->attributes->set('auth_user', $user);

        $data = app(MessagingController::class)->conversations($request)->getData(true);
        $this->assertCount(1, $data['items']);

        return $data['items'][0];
    }
}
