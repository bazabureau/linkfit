<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\MessagingController;
use App\Models\User;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class MessagingReadAuthzTest extends TestCase
{
    private const USER_ONE = '00000000-0000-4000-8000-000000000101';

    private const USER_TWO = '00000000-0000-4000-8000-000000000102';

    private const OUTSIDER = '00000000-0000-4000-8000-000000000103';

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
        Schema::dropIfExists('conversation_participants');
        Schema::dropIfExists('conversations');
        Schema::dropIfExists('users');

        parent::tearDown();
    }

    public function test_active_participant_can_mark_conversation_read(): void
    {
        $this->assertNull(DB::table('conversation_participants')
            ->where('conversation_id', self::CONVERSATION)
            ->where('user_id', self::USER_ONE)
            ->value('last_read_at'));

        $response = $this->controller->markConversationRead($this->requestFor(self::USER_ONE), self::CONVERSATION);

        $this->assertSame(204, $response->getStatusCode());
        $this->assertNotNull(DB::table('conversation_participants')
            ->where('conversation_id', self::CONVERSATION)
            ->where('user_id', self::USER_ONE)
            ->value('last_read_at'));
    }

    public function test_non_participant_cannot_mark_conversation_read(): void
    {
        try {
            $this->controller->markConversationRead($this->requestFor(self::OUTSIDER), self::CONVERSATION);
            $this->fail('Expected a forbidden ApiException for a non-participant.');
        } catch (ApiException $e) {
            $this->assertSame(403, $e->getStatusCode());
        }

        // No participant row exists for the outsider, and the legitimate
        // participants' last_read_at must remain untouched.
        $this->assertFalse(DB::table('conversation_participants')
            ->where('conversation_id', self::CONVERSATION)
            ->where('user_id', self::OUTSIDER)
            ->exists());
        $this->assertNull(DB::table('conversation_participants')
            ->where('conversation_id', self::CONVERSATION)
            ->where('user_id', self::USER_ONE)
            ->value('last_read_at'));
        $this->assertNull(DB::table('conversation_participants')
            ->where('conversation_id', self::CONVERSATION)
            ->where('user_id', self::USER_TWO)
            ->value('last_read_at'));
    }

    public function test_left_participant_cannot_mark_conversation_read(): void
    {
        DB::table('conversation_participants')
            ->where('conversation_id', self::CONVERSATION)
            ->where('user_id', self::USER_TWO)
            ->update(['left_at' => now()]);

        try {
            $this->controller->markConversationRead($this->requestFor(self::USER_TWO), self::CONVERSATION);
            $this->fail('Expected a forbidden ApiException for a participant who has left.');
        } catch (ApiException $e) {
            $this->assertSame(403, $e->getStatusCode());
        }

        $this->assertNull(DB::table('conversation_participants')
            ->where('conversation_id', self::CONVERSATION)
            ->where('user_id', self::USER_TWO)
            ->value('last_read_at'));
    }

    private function requestFor(string $userId, array $body = []): Request
    {
        $request = Request::create('/api/v1/conversations/'.self::CONVERSATION.'/read', 'POST', $body);
        $user = new User;
        $user->forceFill(['id' => $userId]);
        $request->attributes->set('auth_user', $user);

        return $request;
    }
}
