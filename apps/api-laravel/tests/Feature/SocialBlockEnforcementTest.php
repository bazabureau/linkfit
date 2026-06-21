<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\SocialController;
use App\Http\Controllers\Api\StoriesController;
use App\Models\User;
use App\Support\ApiException;
use Illuminate\Database\Query\Builder;
use Illuminate\Database\Query\Grammars\SQLiteGrammar;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Block enforcement on discovery + story interaction surfaces.
 *
 * Drives the controllers directly (synthetic Request with the `auth_user`
 * attribute set), mirroring StoryReplyAttachmentTest — this exercises the
 * block guards without the JWT middleware/HTTP stack. The schema is the minimal
 * set of tables each query touches.
 */
class SocialBlockEnforcementTest extends TestCase
{
    private const HOST = '00000000-0000-4000-8000-000000000401';

    private const BLOCKER = '00000000-0000-4000-8000-000000000402';

    private const STRANGER = '00000000-0000-4000-8000-000000000403';

    private const AUTHOR = '00000000-0000-4000-8000-000000000404';

    private const STORY = '00000000-0000-4000-8000-000000000405';

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
        config()->set('broadcasting.default', 'log');
        DB::purge('sqlite');
        DB::reconnect('sqlite');

        // The search controller emits Postgres `ILIKE` (case-insensitive). SQLite
        // has no ILIKE operator, so install a grammar that compiles the `ilike`
        // operator down to `like` (already case-insensitive for ASCII in SQLite),
        // letting the unmodified production query run under the in-memory DB.
        $connection = DB::connection('sqlite');
        $grammar = new class($connection) extends SQLiteGrammar
        {
            protected function whereBasic(Builder $query, $where)
            {
                if (strtolower((string) $where['operator']) === 'ilike') {
                    $where['operator'] = 'like';
                }

                return parent::whereBasic($query, $where);
            }
        };
        $connection->setQueryGrammar($grammar);

        Schema::create('users', function ($table): void {
            $table->string('id')->primary();
            $table->string('display_name')->nullable();
            $table->timestamp('deleted_at')->nullable();
        });
        Schema::create('sports', function ($table): void {
            $table->string('id')->primary();
            $table->string('slug')->unique();
        });
        Schema::create('venues', function ($table): void {
            $table->string('id')->primary();
            $table->string('name');
        });
        Schema::create('courts', function ($table): void {
            $table->string('id')->primary();
            $table->string('venue_id');
        });
        Schema::create('games', function ($table): void {
            $table->string('id')->primary();
            $table->string('sport_id');
            $table->string('host_user_id');
            $table->string('court_id')->nullable();
            $table->text('notes')->nullable();
            $table->string('status')->nullable();
            $table->timestamp('starts_at')->nullable();
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
        Schema::create('story_reactions', function ($table): void {
            $table->string('story_id');
            $table->string('user_id');
            $table->string('emoji');
            $table->timestamp('created_at')->nullable();
            $table->primary(['story_id', 'user_id']);
        });
        Schema::create('user_blocks', function ($table): void {
            $table->string('blocker_user_id');
            $table->string('blocked_user_id');
            $table->timestamp('created_at')->nullable();
        });

        DB::table('users')->insert([
            ['id' => self::HOST, 'display_name' => 'Padel Host'],
            ['id' => self::BLOCKER, 'display_name' => 'Blocker'],
            ['id' => self::STRANGER, 'display_name' => 'Stranger'],
            ['id' => self::AUTHOR, 'display_name' => 'Story Author'],
        ]);
        DB::table('sports')->insert(['id' => 'sport-padel', 'slug' => 'padel']);
        DB::table('venues')->insert(['id' => 'venue-1', 'name' => 'Central Court']);
        DB::table('courts')->insert(['id' => 'court-1', 'venue_id' => 'venue-1']);
        DB::table('games')->insert([
            'id' => 'game-1',
            'sport_id' => 'sport-padel',
            'host_user_id' => self::HOST,
            'court_id' => 'court-1',
            'notes' => 'Friendly padel match',
            'status' => 'open',
            'starts_at' => now()->addDay(),
        ]);
        DB::table('stories')->insert([
            'id' => self::STORY,
            'user_id' => self::AUTHOR,
            'view_count' => 0,
        ]);
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('user_blocks');
        Schema::dropIfExists('story_reactions');
        Schema::dropIfExists('story_views');
        Schema::dropIfExists('stories');
        Schema::dropIfExists('games');
        Schema::dropIfExists('courts');
        Schema::dropIfExists('venues');
        Schema::dropIfExists('sports');
        Schema::dropIfExists('users');

        parent::tearDown();
    }

    public function test_blocked_user_does_not_see_blockers_hosted_games_in_search(): void
    {
        // BLOCKER blocked HOST; the host's game must drop out of search results.
        DB::table('user_blocks')->insert([
            'blocker_user_id' => self::BLOCKER,
            'blocked_user_id' => self::HOST,
            'created_at' => now(),
        ]);

        $blocked = app(SocialController::class)
            ->search($this->searchRequest(self::BLOCKER, 'Padel'))
            ->getData(true);
        $this->assertSame([], $blocked['games']);

        // A non-blocked viewer still finds the same game (no over-blocking).
        $visible = app(SocialController::class)
            ->search($this->searchRequest(self::STRANGER, 'Padel'))
            ->getData(true);
        $this->assertCount(1, $visible['games']);
        $this->assertSame('game-1', $visible['games'][0]['id']);
        $this->assertSame('Padel Host', $visible['games'][0]['host_display_name']);
    }

    public function test_user_blocked_by_story_author_cannot_view_story(): void
    {
        // AUTHOR blocked STRANGER — the view is forbidden and view_count stays 0.
        DB::table('user_blocks')->insert([
            'blocker_user_id' => self::AUTHOR,
            'blocked_user_id' => self::STRANGER,
            'created_at' => now(),
        ]);

        $this->expectException(ApiException::class);
        try {
            app(StoriesController::class)->view($this->authRequest(self::STRANGER), self::STORY);
        } finally {
            $this->assertSame(0, (int) DB::table('stories')->where('id', self::STORY)->value('view_count'));
            $this->assertSame(0, DB::table('story_views')->where('story_id', self::STORY)->count());
        }
    }

    public function test_user_blocked_by_story_author_cannot_react_to_story(): void
    {
        DB::table('user_blocks')->insert([
            'blocker_user_id' => self::AUTHOR,
            'blocked_user_id' => self::STRANGER,
            'created_at' => now(),
        ]);

        $this->expectException(ApiException::class);
        try {
            app(StoriesController::class)->react($this->reactRequest(self::STRANGER), self::STORY);
        } finally {
            $this->assertSame(0, DB::table('story_reactions')->where('story_id', self::STORY)->count());
        }
    }

    public function test_non_blocked_user_can_view_and_react_to_story(): void
    {
        $viewResponse = app(StoriesController::class)->view($this->authRequest(self::STRANGER), self::STORY);
        $this->assertSame(200, $viewResponse->getStatusCode());
        $this->assertSame(1, (int) DB::table('stories')->where('id', self::STORY)->value('view_count'));
        $this->assertSame(1, DB::table('story_views')->where('story_id', self::STORY)->count());

        $reactResponse = app(StoriesController::class)->react($this->reactRequest(self::STRANGER), self::STORY);
        $this->assertSame(200, $reactResponse->getStatusCode());
        $this->assertSame('fire', $reactResponse->getData(true)['my_reaction']);
        $this->assertSame(1, DB::table('story_reactions')->where('story_id', self::STORY)->count());
    }

    private function searchRequest(string $viewerId, string $q): Request
    {
        $request = Request::create('/api/v1/search', 'GET', ['q' => $q, 'type' => 'games']);

        return $this->withViewer($request, $viewerId);
    }

    private function authRequest(string $userId): Request
    {
        $request = Request::create('/api/v1/stories/'.self::STORY.'/view', 'POST');

        return $this->withViewer($request, $userId);
    }

    private function reactRequest(string $userId): Request
    {
        $request = Request::create('/api/v1/stories/'.self::STORY.'/react', 'POST', ['emoji' => 'fire']);

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
