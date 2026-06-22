<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\FeedController;
use App\Http\Controllers\Api\SocialController;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Social notifications: follow / like / comment must each enqueue a row in
 * `notifications` for the *recipient*, while self-interaction and blocked pairs
 * produce nothing.
 *
 * Drives the controllers directly (synthetic Request with the `auth_user`
 * attribute set), mirroring SocialBlockEnforcementTest — exercising the
 * notification side-effects without the JWT middleware/HTTP stack. The schema is
 * the minimal set of tables the touched code paths read/write; the
 * `push_notification_jobs` table is intentionally NOT created so the best-effort
 * push enqueue no-ops (Schema::hasTable guard) under the in-memory DB.
 */
class SocialNotificationsTest extends TestCase
{
    private const ACTOR = '00000000-0000-4000-8000-000000000501';

    private const TARGET = '00000000-0000-4000-8000-000000000502';

    private const AUTHOR = '00000000-0000-4000-8000-000000000503';

    private const EVENT = '00000000-0000-4000-8000-000000000504';

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
            $table->timestamp('deleted_at')->nullable();
        });
        Schema::create('follows', function ($table): void {
            $table->string('follower_user_id');
            $table->string('followed_user_id');
            $table->timestamp('created_at')->nullable();
            $table->primary(['follower_user_id', 'followed_user_id']);
        });
        Schema::create('user_blocks', function ($table): void {
            $table->string('blocker_user_id');
            $table->string('blocked_user_id');
            $table->timestamp('created_at')->nullable();
        });
        Schema::create('feed_events', function ($table): void {
            $table->string('id')->primary();
            $table->string('actor_user_id');
            $table->string('type')->nullable();
            $table->text('payload')->nullable();
            $table->string('visibility')->nullable();
            $table->timestamp('created_at')->nullable();
        });
        Schema::create('feed_event_reactions', function ($table): void {
            $table->string('feed_event_id');
            $table->string('user_id');
            $table->timestamp('created_at')->nullable();
            $table->primary(['feed_event_id', 'user_id']);
        });
        Schema::create('feed_comments', function ($table): void {
            $table->string('id')->primary();
            $table->string('event_id');
            $table->string('user_id');
            $table->text('body');
            $table->timestamp('created_at')->nullable();
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

        DB::table('users')->insert([
            ['id' => self::ACTOR, 'display_name' => 'Actor'],
            ['id' => self::TARGET, 'display_name' => 'Target'],
            ['id' => self::AUTHOR, 'display_name' => 'Author'],
        ]);
        DB::table('feed_events')->insert([
            'id' => self::EVENT,
            'actor_user_id' => self::AUTHOR,
            'type' => 'achievement',
            'payload' => '{}',
            'visibility' => 'public',
            'created_at' => now(),
        ]);
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('notifications');
        Schema::dropIfExists('feed_comments');
        Schema::dropIfExists('feed_event_reactions');
        Schema::dropIfExists('feed_events');
        Schema::dropIfExists('user_blocks');
        Schema::dropIfExists('follows');
        Schema::dropIfExists('users');

        parent::tearDown();
    }

    public function test_following_a_user_notifies_the_followed_user(): void
    {
        app(SocialController::class)->follow($this->authRequest(self::ACTOR), self::TARGET);

        $rows = DB::table('notifications')->where('user_id', self::TARGET)->get();
        $this->assertCount(1, $rows);
        $this->assertSame('system', $rows[0]->type);
        $this->assertStringContainsString('Actor', (string) $rows[0]->body);
        $this->assertSame('follow', json_decode((string) $rows[0]->payload, true)['kind']);

        // No notification ever lands on the actor themselves.
        $this->assertSame(0, DB::table('notifications')->where('user_id', self::ACTOR)->count());
    }

    public function test_re_following_does_not_create_a_duplicate_notification(): void
    {
        app(SocialController::class)->follow($this->authRequest(self::ACTOR), self::TARGET);
        // Idempotent re-follow must not re-spam the target.
        app(SocialController::class)->follow($this->authRequest(self::ACTOR), self::TARGET);

        $this->assertSame(1, DB::table('notifications')->where('user_id', self::TARGET)->count());
    }

    public function test_liking_a_feed_event_notifies_the_author(): void
    {
        app(FeedController::class)->like($this->authRequest(self::ACTOR), self::EVENT);

        $rows = DB::table('notifications')->where('user_id', self::AUTHOR)->get();
        $this->assertCount(1, $rows);
        $this->assertSame('system', $rows[0]->type);
        $this->assertStringContainsString('liked', (string) $rows[0]->body);
        $payload = json_decode((string) $rows[0]->payload, true);
        $this->assertSame('feed_like', $payload['kind']);
        $this->assertSame(self::EVENT, $payload['event_id']);
    }

    public function test_self_like_does_not_notify(): void
    {
        // The author likes their own post — no notification.
        app(FeedController::class)->like($this->authRequest(self::AUTHOR), self::EVENT);

        $this->assertSame(0, DB::table('notifications')->count());
    }

    public function test_re_liking_does_not_create_a_duplicate_notification(): void
    {
        app(FeedController::class)->like($this->authRequest(self::ACTOR), self::EVENT);
        // Idempotent re-like must not re-spam the author.
        app(FeedController::class)->like($this->authRequest(self::ACTOR), self::EVENT);

        $this->assertSame(1, DB::table('notifications')->where('user_id', self::AUTHOR)->count());
    }

    public function test_commenting_on_a_feed_event_notifies_the_author(): void
    {
        $request = $this->authRequest(self::ACTOR);
        $request->merge(['body' => 'Nice shot!']);
        app(FeedController::class)->storeComment($request, self::EVENT);

        $rows = DB::table('notifications')->where('user_id', self::AUTHOR)->get();
        $this->assertCount(1, $rows);
        $this->assertStringContainsString('commented', (string) $rows[0]->body);
        $this->assertSame('feed_comment', json_decode((string) $rows[0]->payload, true)['kind']);
    }

    public function test_self_comment_does_not_notify(): void
    {
        $request = $this->authRequest(self::AUTHOR);
        $request->merge(['body' => 'My own post']);
        app(FeedController::class)->storeComment($request, self::EVENT);

        $this->assertSame(0, DB::table('notifications')->count());
    }

    public function test_blocked_actor_does_not_generate_a_like_notification(): void
    {
        // AUTHOR blocked ACTOR — a like from ACTOR must NOT notify the author.
        DB::table('user_blocks')->insert([
            'blocker_user_id' => self::AUTHOR,
            'blocked_user_id' => self::ACTOR,
            'created_at' => now(),
        ]);

        app(FeedController::class)->like($this->authRequest(self::ACTOR), self::EVENT);

        $this->assertSame(0, DB::table('notifications')->count());
    }

    public function test_blocked_actor_does_not_generate_a_comment_notification(): void
    {
        DB::table('user_blocks')->insert([
            'blocker_user_id' => self::AUTHOR,
            'blocked_user_id' => self::ACTOR,
            'created_at' => now(),
        ]);

        $request = $this->authRequest(self::ACTOR);
        $request->merge(['body' => 'Blocked comment']);
        app(FeedController::class)->storeComment($request, self::EVENT);

        $this->assertSame(0, DB::table('notifications')->count());
    }

    private function authRequest(string $userId): Request
    {
        $request = Request::create('/api/v1/test', 'POST');
        $user = new User;
        $user->forceFill(['id' => $userId, 'display_name' => $this->nameFor($userId)]);
        $request->attributes->set('auth_user', $user);

        return $request;
    }

    private function nameFor(string $userId): string
    {
        return match ($userId) {
            self::ACTOR => 'Actor',
            self::TARGET => 'Target',
            self::AUTHOR => 'Author',
            default => 'Someone',
        };
    }
}
