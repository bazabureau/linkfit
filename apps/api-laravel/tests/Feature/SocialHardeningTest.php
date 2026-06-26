<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\SocialController;
use App\Models\User;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Hardening for the social write surface (follow / unfollow / block / unblock /
 * removeFollower / blocks). Drives the controller directly (synthetic Request
 * with the `auth_user` attribute set), mirroring SocialNotificationsTest — this
 * exercises the authorization + input guards without the JWT middleware/HTTP
 * stack. The schema is the minimal set of tables the touched paths read/write;
 * `push_notification_jobs` is intentionally NOT created so the best-effort push
 * enqueue no-ops (Schema::hasTable guard) under the in-memory DB.
 */
class SocialHardeningTest extends TestCase
{
    private const ACTOR = '00000000-0000-4000-8000-000000000601';

    private const TARGET = '00000000-0000-4000-8000-000000000602';

    private const OTHER = '00000000-0000-4000-8000-000000000603';

    // A well-formed uuid that is NOT present in the users table.
    private const GHOST = '00000000-0000-4000-8000-0000000006ff';

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
            $table->string('username')->nullable();
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
        Schema::create('conversations', function ($table): void {
            $table->string('id')->primary();
            $table->string('kind')->nullable();
        });
        Schema::create('conversation_participants', function ($table): void {
            $table->string('conversation_id');
            $table->string('user_id');
            $table->timestamp('left_at')->nullable();
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
            ['id' => self::ACTOR, 'username' => 'actor', 'display_name' => 'Actor'],
            ['id' => self::TARGET, 'username' => 'target', 'display_name' => 'Target'],
            ['id' => self::OTHER, 'username' => 'other', 'display_name' => 'Other'],
        ]);
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('notifications');
        Schema::dropIfExists('conversation_participants');
        Schema::dropIfExists('conversations');
        Schema::dropIfExists('user_blocks');
        Schema::dropIfExists('follows');
        Schema::dropIfExists('users');

        parent::tearDown();
    }

    public function test_follow_happy_path_creates_edge(): void
    {
        $response = app(SocialController::class)->follow($this->authRequest(self::ACTOR), self::TARGET);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertTrue($response->getData(true)['ok']);
        $this->assertSame(1, DB::table('follows')
            ->where('follower_user_id', self::ACTOR)
            ->where('followed_user_id', self::TARGET)
            ->count());
    }

    public function test_follow_by_username_resolves_to_uuid_edge(): void
    {
        app(SocialController::class)->follow($this->authRequest(self::ACTOR), 'target');

        // The stored edge keys off the resolved uuid, never the raw username.
        $this->assertSame(1, DB::table('follows')
            ->where('follower_user_id', self::ACTOR)
            ->where('followed_user_id', self::TARGET)
            ->count());
    }

    public function test_cannot_follow_yourself_by_uuid(): void
    {
        $this->assertThrowsStatus(422, fn () => app(SocialController::class)
            ->follow($this->authRequest(self::ACTOR), self::ACTOR));
        $this->assertSame(0, DB::table('follows')->count());
    }

    public function test_cannot_follow_yourself_by_username(): void
    {
        // Resolving before the self-check stops a self-follow slipping through as a
        // username.
        $this->assertThrowsStatus(422, fn () => app(SocialController::class)
            ->follow($this->authRequest(self::ACTOR), 'actor'));
        $this->assertSame(0, DB::table('follows')->count());
    }

    public function test_follow_unknown_uuid_is_not_found(): void
    {
        $this->assertThrowsStatus(404, fn () => app(SocialController::class)
            ->follow($this->authRequest(self::ACTOR), self::GHOST));
    }

    public function test_follow_garbage_id_is_not_found_not_server_error(): void
    {
        // A non-uuid, non-username param must resolve to a clean 404 — never a
        // Postgres bad-uuid-cast 500.
        $this->assertThrowsStatus(404, fn () => app(SocialController::class)
            ->follow($this->authRequest(self::ACTOR), 'definitely-not-a-uuid'));
        $this->assertSame(0, DB::table('follows')->count());
    }

    public function test_cannot_follow_a_user_who_blocked_you(): void
    {
        DB::table('user_blocks')->insert([
            'blocker_user_id' => self::TARGET,
            'blocked_user_id' => self::ACTOR,
            'created_at' => now(),
        ]);

        $this->assertThrowsStatus(403, fn () => app(SocialController::class)
            ->follow($this->authRequest(self::ACTOR), self::TARGET));
        $this->assertSame(0, DB::table('follows')->count());
    }

    public function test_unfollow_removes_edge(): void
    {
        DB::table('follows')->insert([
            'follower_user_id' => self::ACTOR,
            'followed_user_id' => self::TARGET,
            'created_at' => now(),
        ]);

        $response = app(SocialController::class)->unfollow($this->authRequest(self::ACTOR), self::TARGET);

        $this->assertSame(204, $response->getStatusCode());
        $this->assertSame(0, DB::table('follows')->count());
    }

    public function test_unfollow_garbage_id_is_idempotent_noop(): void
    {
        // Must not throw / 500 on a non-uuid param.
        $response = app(SocialController::class)->unfollow($this->authRequest(self::ACTOR), 'not-a-uuid');
        $this->assertSame(204, $response->getStatusCode());
    }

    public function test_block_creates_block_and_removes_mutual_follows_and_leaves_dm(): void
    {
        // Mutual follow + a shared direct conversation between ACTOR and TARGET.
        DB::table('follows')->insert([
            ['follower_user_id' => self::ACTOR, 'followed_user_id' => self::TARGET, 'created_at' => now()],
            ['follower_user_id' => self::TARGET, 'followed_user_id' => self::ACTOR, 'created_at' => now()],
        ]);
        DB::table('conversations')->insert(['id' => 'conv-1', 'kind' => 'direct']);
        DB::table('conversation_participants')->insert([
            ['conversation_id' => 'conv-1', 'user_id' => self::ACTOR, 'left_at' => null],
            ['conversation_id' => 'conv-1', 'user_id' => self::TARGET, 'left_at' => null],
        ]);

        $response = app(SocialController::class)->block($this->authRequest(self::ACTOR), self::TARGET);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertTrue($response->getData(true)['ok']);
        $this->assertSame(1, DB::table('user_blocks')
            ->where('blocker_user_id', self::ACTOR)
            ->where('blocked_user_id', self::TARGET)
            ->count());
        // Follows in both directions are severed.
        $this->assertSame(0, DB::table('follows')->count());
        // Both participants left the direct conversation.
        $this->assertSame(0, DB::table('conversation_participants')->whereNull('left_at')->count());
    }

    public function test_cannot_block_yourself_by_username(): void
    {
        $this->assertThrowsStatus(422, fn () => app(SocialController::class)
            ->block($this->authRequest(self::ACTOR), 'actor'));
        $this->assertSame(0, DB::table('user_blocks')->count());
    }

    public function test_block_garbage_id_is_not_found_not_server_error(): void
    {
        $this->assertThrowsStatus(404, fn () => app(SocialController::class)
            ->block($this->authRequest(self::ACTOR), 'not-a-uuid'));
        $this->assertSame(0, DB::table('user_blocks')->count());
    }

    public function test_unblock_removes_block(): void
    {
        DB::table('user_blocks')->insert([
            'blocker_user_id' => self::ACTOR,
            'blocked_user_id' => self::TARGET,
            'created_at' => now(),
        ]);

        $response = app(SocialController::class)->unblock($this->authRequest(self::ACTOR), self::TARGET);

        $this->assertSame(204, $response->getStatusCode());
        $this->assertSame(0, DB::table('user_blocks')->count());
    }

    public function test_remove_follower_by_owner_removes_edge(): void
    {
        // TARGET follows ACTOR; the owner (ACTOR) prunes that follower.
        DB::table('follows')->insert([
            'follower_user_id' => self::TARGET,
            'followed_user_id' => self::ACTOR,
            'created_at' => now(),
        ]);

        $response = app(SocialController::class)
            ->removeFollower($this->authRequest(self::ACTOR), self::ACTOR, self::TARGET);

        $this->assertSame(204, $response->getStatusCode());
        $this->assertSame(0, DB::table('follows')->count());
    }

    public function test_remove_follower_by_non_owner_is_forbidden(): void
    {
        // ACTOR tries to prune a follower from OTHER's profile — forbidden, and
        // the edge survives.
        DB::table('follows')->insert([
            'follower_user_id' => self::TARGET,
            'followed_user_id' => self::OTHER,
            'created_at' => now(),
        ]);

        $this->assertThrowsStatus(403, fn () => app(SocialController::class)
            ->removeFollower($this->authRequest(self::ACTOR), self::OTHER, self::TARGET));
        $this->assertSame(1, DB::table('follows')->count());
    }

    public function test_blocks_list_returns_blocked_users(): void
    {
        DB::table('user_blocks')->insert([
            'blocker_user_id' => self::ACTOR,
            'blocked_user_id' => self::TARGET,
            'created_at' => now(),
        ]);

        $data = app(SocialController::class)->blocks($this->authRequest(self::ACTOR))->getData(true);

        $this->assertCount(1, $data['items']);
        $this->assertSame(self::TARGET, $data['items'][0]['user_id']);
        $this->assertSame('Target', $data['items'][0]['display_name']);
    }

    private function assertThrowsStatus(int $status, callable $fn): void
    {
        try {
            $fn();
            $this->fail("Expected an ApiException with status {$status}");
        } catch (ApiException $e) {
            $this->assertSame($status, $e->getStatusCode());
        }
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
            self::OTHER => 'Other',
            default => 'Someone',
        };
    }
}
