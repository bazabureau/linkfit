<?php

namespace Tests\Feature;

use App\Events\ConversationUpdated;
use App\Events\MessageSent;
use App\Http\Controllers\Api\StoriesController;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class StoryReplyAttachmentTest extends TestCase
{
    private const AUTHOR = '00000000-0000-4000-8000-000000000301';
    private const VIEWER = '00000000-0000-4000-8000-000000000302';
    private const STORY = '00000000-0000-4000-8000-000000000303';

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
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('user_blocks');
        Schema::dropIfExists('messages');
        Schema::dropIfExists('conversation_participants');
        Schema::dropIfExists('conversations');
        Schema::dropIfExists('stories');
        Schema::dropIfExists('users');

        parent::tearDown();
    }

    public function test_video_story_reply_creates_message_with_video_attachment_and_realtime_events(): void
    {
        Event::fake();
        DB::table('stories')->insert([
            'id' => self::STORY,
            'user_id' => self::AUTHOR,
            'media_url' => 'https://cdn.linkfit.az/story.mp4',
            'media_type' => 'video',
            'caption' => null,
            'overlays' => '[]',
            'created_at' => now(),
            'expires_at' => now()->addDay(),
            'view_count' => 0,
        ]);

        $response = app(StoriesController::class)->reply($this->requestFor(self::VIEWER, ['body' => 'Looks good']), self::STORY);
        $payload = $response->getData(true);

        $this->assertSame(201, $response->getStatusCode());
        $this->assertNotEmpty($payload['conversation_id']);

        $message = DB::table('messages')->where('id', $payload['message_id'])->first();
        $this->assertSame('↩ Story reply: Looks good', $message->body);
        $this->assertSame('https://cdn.linkfit.az/story.mp4', $message->attachment_url);
        $this->assertSame('video', $message->attachment_type);

        Event::assertDispatched(MessageSent::class, fn (MessageSent $event) => $event->message['attachment_type'] === 'video');
        Event::assertDispatched(ConversationUpdated::class, fn (ConversationUpdated $event) => $event->reason === 'story_reply'
            && in_array(self::AUTHOR, $event->userIds, true)
            && in_array(self::VIEWER, $event->userIds, true));
    }

    private function requestFor(string $userId, array $payload): Request
    {
        $request = Request::create('/api/v1/stories/'.self::STORY.'/reply', 'POST', $payload);
        $user = new User();
        $user->forceFill(['id' => $userId]);
        $request->attributes->set('auth_user', $user);

        return $request;
    }
}
