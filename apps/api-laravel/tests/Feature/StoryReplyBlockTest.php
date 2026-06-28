<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\StoriesController;
use App\Models\User;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * #8 — a story reply opens/resurrects a 1:1 DM, so it must honour a BIDIRECTIONAL
 * block (mirrors MessagingController::startConversation). A reply is forbidden
 * whether the author blocked the replier OR the replier blocked the author; with
 * no block it succeeds.
 */
class StoryReplyBlockTest extends TestCase
{
    private const AUTHOR = '00000000-0000-4000-8000-000000000601';

    private const VIEWER = '00000000-0000-4000-8000-000000000602';

    private const STORY = '00000000-0000-4000-8000-000000000603';

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
            $table->timestamp('deleted_at')->nullable();
        });
        Schema::create('stories', function ($table): void {
            $table->string('id')->primary();
            $table->string('user_id');
            $table->text('media_url');
            $table->string('media_type');
            $table->text('caption')->nullable();
            $table->text('overlays')->nullable();
            $table->timestamp('created_at')->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->integer('view_count')->default(0);
        });
        Schema::create('conversations', function ($table): void {
            $table->string('id')->primary();
            $table->string('kind')->nullable();
            $table->timestamp('created_at')->nullable();
            $table->timestamp('last_message_at')->nullable();
        });
        Schema::create('conversation_participants', function ($table): void {
            $table->string('conversation_id');
            $table->string('user_id');
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

        DB::table('users')->insert([
            ['id' => self::AUTHOR, 'display_name' => 'Author'],
            ['id' => self::VIEWER, 'display_name' => 'Viewer'],
        ]);
        DB::table('stories')->insert([
            'id' => self::STORY,
            'user_id' => self::AUTHOR,
            'media_url' => 'https://cdn.linkfit.az/s.jpg',
            'media_type' => 'image',
            'caption' => null,
            'overlays' => '[]',
            'created_at' => now(),
            'expires_at' => now()->addDay(),
            'view_count' => 0,
        ]);
    }

    protected function tearDown(): void
    {
        foreach (['user_blocks', 'messages', 'conversation_participants', 'conversations', 'stories', 'users'] as $table) {
            Schema::dropIfExists($table);
        }

        parent::tearDown();
    }

    public function test_reply_forbidden_when_author_blocked_the_replier(): void
    {
        DB::table('user_blocks')->insert(['blocker_user_id' => self::AUTHOR, 'blocked_user_id' => self::VIEWER]);

        $this->assertReplyForbidden();
    }

    public function test_reply_forbidden_when_replier_blocked_the_author(): void
    {
        // The previously-missed direction: the replier blocked the author. A reply
        // must not be usable to resurrect a DM with someone the replier blocked.
        DB::table('user_blocks')->insert(['blocker_user_id' => self::VIEWER, 'blocked_user_id' => self::AUTHOR]);

        $this->assertReplyForbidden();
    }

    public function test_reply_allowed_when_no_block(): void
    {
        $response = app(StoriesController::class)->reply($this->replyRequest(), self::STORY);

        $this->assertSame(201, $response->getStatusCode());
        $this->assertSame(1, DB::table('messages')->count());
    }

    private function assertReplyForbidden(): void
    {
        try {
            app(StoriesController::class)->reply($this->replyRequest(), self::STORY);
            $this->fail('Expected a 403 ApiException');
        } catch (ApiException $e) {
            $this->assertSame(403, $e->getStatusCode());
        }
        $this->assertSame(0, DB::table('messages')->count(), 'a blocked reply must not create a message');
    }

    private function replyRequest(): Request
    {
        $request = Request::create('/api/v1/stories/'.self::STORY.'/reply', 'POST', ['body' => 'hi']);
        $user = new User;
        $user->forceFill(['id' => self::VIEWER]);
        $request->attributes->set('auth_user', $user);

        return $request;
    }
}
