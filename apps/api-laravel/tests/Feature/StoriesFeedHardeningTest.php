<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\FeedController;
use App\Http\Controllers\Api\StoriesController;
use App\Models\User;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Hardening coverage for the stories + feed slice. Drives the controllers
 * directly with a synthetic Request (the `auth_user` attribute set for an
 * authenticated viewer, omitted for anonymous), mirroring
 * SocialBlockEnforcementTest / StoryReplyAttachmentTest. The schema is the
 * minimal set of tables each query touches.
 *
 * Focus:
 *   - Feed visibility tiers: a followed user's `private` event must NOT leak to
 *     a follower (only `public` + `followers`); anonymous sees `public` only.
 *   - Comment thread reads honour the same visibility tiers.
 *   - storeComment rejects a whitespace-only body.
 *   - A story author viewing their OWN story never records a view / inflates
 *     view_count.
 */
class StoriesFeedHardeningTest extends TestCase
{
    private const AUTHOR = '00000000-0000-4000-8000-0000000005a1';

    private const FOLLOWER = '00000000-0000-4000-8000-0000000005a2';

    private const STRANGER = '00000000-0000-4000-8000-0000000005a3';

    private const EV_PUBLIC = '00000000-0000-4000-8000-0000000005b1';

    private const EV_FOLLOWERS = '00000000-0000-4000-8000-0000000005b2';

    private const EV_PRIVATE = '00000000-0000-4000-8000-0000000005b3';

    private const STORY = '00000000-0000-4000-8000-0000000005c1';

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
            // Mirrors the production users.admin_role column the feed query filters
            // on: staff/partner/coach accounts are excluded from the public feed.
            $table->string('admin_role')->nullable();
            $table->timestamp('deleted_at')->nullable();
        });
        Schema::create('feed_events', function ($table): void {
            $table->string('id')->primary();
            $table->string('type');
            $table->string('actor_user_id');
            $table->text('payload')->nullable();
            $table->string('visibility')->default('followers');
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
            $table->text('body')->nullable();
            $table->timestamp('created_at')->nullable();
        });
        Schema::create('follows', function ($table): void {
            $table->string('follower_user_id');
            $table->string('followed_user_id');
            $table->primary(['follower_user_id', 'followed_user_id']);
        });
        Schema::create('notifications', function ($table): void {
            $table->string('id')->primary();
            $table->string('user_id');
            $table->string('type');
            $table->string('title')->nullable();
            $table->text('body')->nullable();
            $table->text('payload')->nullable();
            $table->timestamp('created_at')->nullable();
        });
        Schema::create('stories', function ($table): void {
            $table->string('id')->primary();
            $table->string('user_id');
            $table->integer('view_count')->default(0);
        });
        Schema::create('story_views', function ($table): void {
            $table->string('story_id');
            $table->string('viewer_user_id');
            $table->timestamp('viewed_at')->nullable();
            $table->primary(['story_id', 'viewer_user_id']);
        });
        Schema::create('user_blocks', function ($table): void {
            $table->string('blocker_user_id');
            $table->string('blocked_user_id');
            $table->timestamp('created_at')->nullable();
        });

        DB::table('users')->insert([
            ['id' => self::AUTHOR, 'display_name' => 'Author'],
            ['id' => self::FOLLOWER, 'display_name' => 'Follower'],
            ['id' => self::STRANGER, 'display_name' => 'Stranger'],
        ]);
        // FOLLOWER follows AUTHOR; STRANGER does not.
        DB::table('follows')->insert([
            'follower_user_id' => self::FOLLOWER,
            'followed_user_id' => self::AUTHOR,
        ]);
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('user_blocks');
        Schema::dropIfExists('story_views');
        Schema::dropIfExists('stories');
        Schema::dropIfExists('notifications');
        Schema::dropIfExists('follows');
        Schema::dropIfExists('feed_comments');
        Schema::dropIfExists('feed_event_reactions');
        Schema::dropIfExists('feed_events');
        Schema::dropIfExists('users');

        parent::tearDown();
    }

    private function seedThreeEvents(): void
    {
        DB::table('feed_events')->insert([
            ['id' => self::EV_PUBLIC, 'type' => 'won_match', 'actor_user_id' => self::AUTHOR, 'payload' => '{}', 'visibility' => 'public', 'created_at' => now()->subMinutes(3)],
            ['id' => self::EV_FOLLOWERS, 'type' => 'won_match', 'actor_user_id' => self::AUTHOR, 'payload' => '{}', 'visibility' => 'followers', 'created_at' => now()->subMinutes(2)],
            ['id' => self::EV_PRIVATE, 'type' => 'won_match', 'actor_user_id' => self::AUTHOR, 'payload' => '{}', 'visibility' => 'private', 'created_at' => now()->subMinute()],
        ]);
    }

    private function feedIndexIds(?string $viewerId): array
    {
        $request = Request::create('/api/v1/feed', 'GET');
        if ($viewerId !== null) {
            $this->withViewer($request, $viewerId);
        }
        $data = app(FeedController::class)->index($request)->getData(true);

        return collect($data['items'])->pluck('id')->all();
    }

    public function test_feed_index_respects_visibility_tiers(): void
    {
        $this->seedThreeEvents();

        // A follower sees public + followers, but NEVER the author's private event.
        $follower = $this->feedIndexIds(self::FOLLOWER);
        $this->assertContains(self::EV_PUBLIC, $follower);
        $this->assertContains(self::EV_FOLLOWERS, $follower);
        $this->assertNotContains(self::EV_PRIVATE, $follower);

        // A non-follower sees only the public event.
        $this->assertSame([self::EV_PUBLIC], $this->feedIndexIds(self::STRANGER));

        // Anonymous sees only the public event.
        $this->assertSame([self::EV_PUBLIC], $this->feedIndexIds(null));

        // The author sees all three of their own events (any visibility).
        $author = $this->feedIndexIds(self::AUTHOR);
        $this->assertContains(self::EV_PUBLIC, $author);
        $this->assertContains(self::EV_FOLLOWERS, $author);
        $this->assertContains(self::EV_PRIVATE, $author);
    }

    public function test_comments_on_followers_event_gated_to_followers_and_author(): void
    {
        DB::table('feed_events')->insert([
            'id' => self::EV_FOLLOWERS, 'type' => 'won_match', 'actor_user_id' => self::AUTHOR,
            'payload' => '{}', 'visibility' => 'followers', 'created_at' => now(),
        ]);
        DB::table('feed_comments')->insert([
            'id' => (string) \Illuminate\Support\Str::uuid(), 'event_id' => self::EV_FOLLOWERS,
            'user_id' => self::AUTHOR, 'body' => 'Nice', 'created_at' => now(),
        ]);

        // Follower + author can read the thread.
        $this->assertCount(1, app(FeedController::class)
            ->comments($this->withViewer(Request::create('/api/v1/feed/'.self::EV_FOLLOWERS.'/comments', 'GET'), self::FOLLOWER), self::EV_FOLLOWERS)
            ->getData(true)['comments']);
        $this->assertCount(1, app(FeedController::class)
            ->comments($this->withViewer(Request::create('/api/v1/feed/'.self::EV_FOLLOWERS.'/comments', 'GET'), self::AUTHOR), self::EV_FOLLOWERS)
            ->getData(true)['comments']);

        // A non-follower is refused (404) — never leak the thread.
        try {
            app(FeedController::class)->comments(
                $this->withViewer(Request::create('/api/v1/feed/'.self::EV_FOLLOWERS.'/comments', 'GET'), self::STRANGER),
                self::EV_FOLLOWERS,
            );
            $this->fail('Expected ApiException for a non-follower reading a followers-only comment thread');
        } catch (ApiException $e) {
            $this->assertSame(404, $e->getStatusCode());
        }

        // Anonymous is refused (404) too.
        try {
            app(FeedController::class)->comments(
                Request::create('/api/v1/feed/'.self::EV_FOLLOWERS.'/comments', 'GET'),
                self::EV_FOLLOWERS,
            );
            $this->fail('Expected ApiException for anonymous reading a followers-only comment thread');
        } catch (ApiException $e) {
            $this->assertSame(404, $e->getStatusCode());
        }
    }

    public function test_comments_on_private_event_are_author_only(): void
    {
        DB::table('feed_events')->insert([
            'id' => self::EV_PRIVATE, 'type' => 'won_match', 'actor_user_id' => self::AUTHOR,
            'payload' => '{}', 'visibility' => 'private', 'created_at' => now(),
        ]);

        // The author can read it; a follower cannot.
        $this->assertSame(200, app(FeedController::class)
            ->comments($this->withViewer(Request::create('/api/v1/feed/'.self::EV_PRIVATE.'/comments', 'GET'), self::AUTHOR), self::EV_PRIVATE)
            ->getStatusCode());

        $this->expectException(ApiException::class);
        app(FeedController::class)->comments(
            $this->withViewer(Request::create('/api/v1/feed/'.self::EV_PRIVATE.'/comments', 'GET'), self::FOLLOWER),
            self::EV_PRIVATE,
        );
    }

    public function test_store_comment_rejects_whitespace_only_body(): void
    {
        DB::table('feed_events')->insert([
            'id' => self::EV_PUBLIC, 'type' => 'won_match', 'actor_user_id' => self::AUTHOR,
            'payload' => '{}', 'visibility' => 'public', 'created_at' => now(),
        ]);

        $request = Request::create('/api/v1/feed/'.self::EV_PUBLIC.'/comments', 'POST', ['body' => '   ']);
        $this->withViewer($request, self::FOLLOWER);

        try {
            app(FeedController::class)->storeComment($request, self::EV_PUBLIC);
            $this->fail('Expected ApiException for a whitespace-only comment body');
        } catch (ApiException $e) {
            $this->assertSame(422, $e->getStatusCode());
        }
        $this->assertSame(0, DB::table('feed_comments')->count());
    }

    public function test_store_comment_happy_path_persists_trimmed_body(): void
    {
        DB::table('feed_events')->insert([
            'id' => self::EV_PUBLIC, 'type' => 'won_match', 'actor_user_id' => self::AUTHOR,
            'payload' => '{}', 'visibility' => 'public', 'created_at' => now(),
        ]);

        $request = Request::create('/api/v1/feed/'.self::EV_PUBLIC.'/comments', 'POST', ['body' => '  Great game  ']);
        $this->withViewer($request, self::FOLLOWER);

        $response = app(FeedController::class)->storeComment($request, self::EV_PUBLIC);
        $payload = $response->getData(true);

        $this->assertSame(201, $response->getStatusCode());
        $this->assertSame('Great game', $payload['body']);
        $this->assertSame(self::FOLLOWER, $payload['user_id']);
        $this->assertSame('Great game', DB::table('feed_comments')->where('id', $payload['id'])->value('body'));
    }

    public function test_author_viewing_own_story_does_not_record_view(): void
    {
        DB::table('stories')->insert([
            'id' => self::STORY,
            'user_id' => self::AUTHOR,
            'view_count' => 0,
        ]);

        // Author views their own story → no story_views row, count stays 0.
        $authorView = app(StoriesController::class)->view($this->ownViewRequest(self::AUTHOR), self::STORY);
        $this->assertSame(200, $authorView->getStatusCode());
        $this->assertSame(0, DB::table('story_views')->where('story_id', self::STORY)->count());
        $this->assertSame(0, (int) DB::table('stories')->where('id', self::STORY)->value('view_count'));

        // A real viewer records exactly one view; a re-view is idempotent.
        app(StoriesController::class)->view($this->ownViewRequest(self::FOLLOWER), self::STORY);
        app(StoriesController::class)->view($this->ownViewRequest(self::FOLLOWER), self::STORY);
        $this->assertSame(1, DB::table('story_views')->where('story_id', self::STORY)->count());
        $this->assertSame(1, (int) DB::table('stories')->where('id', self::STORY)->value('view_count'));
    }

    private function ownViewRequest(string $userId): Request
    {
        $request = Request::create('/api/v1/stories/'.self::STORY.'/view', 'POST');

        return $this->withViewer($request, $userId);
    }

    private function withViewer(Request $request, string $userId): Request
    {
        $user = new User;
        $user->forceFill(['id' => $userId]);
        $request->attributes->set('auth_user', $user);

        return $request;
    }
}
