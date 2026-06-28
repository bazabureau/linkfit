<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\GamesController;
use App\Http\Controllers\Api\MatchController;
use App\Models\User;
use App\Services\Ratings\ReliabilityService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Reliability recompute pipeline: player_sport_stats.reliability_score is derived
 * from attendance (no-shows on completed games) + peer behaviour ratings, instead
 * of being frozen at the seeded 100 forever. Verifies the formula directly and
 * that both controller hooks (match completion + host-flagged no-show) actually
 * move the score. Mirrors the hand-rolled sqlite harness used by the other Match
 * feature tests (no migrations run; tables created here).
 */
class ReliabilityScoringTest extends TestCase
{
    private const SPORT_ID = 'sport-padel';

    private const HOST = '00000000-0000-4000-8000-000000000001';
    private const PLAYER_A = '00000000-0000-4000-8000-000000000002';
    private const PLAYER_B = '00000000-0000-4000-8000-000000000003';
    private const NOSHOW = '00000000-0000-4000-8000-000000000004';
    private const CLEAN = '00000000-0000-4000-8000-000000000005';

    private ReliabilityService $service;

    private MatchController $match;

    private GamesController $games;

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
        DB::purge('sqlite');
        DB::reconnect('sqlite');

        Schema::create('users', function ($table): void {
            $table->string('id')->primary();
            $table->string('username')->nullable();
            $table->string('display_name')->nullable();
            $table->string('photo_url')->nullable();
            $table->string('email')->nullable();
            $table->timestamp('deleted_at')->nullable();
            $table->timestamp('created_at')->nullable();
        });

        Schema::create('sports', function ($table): void {
            $table->string('id')->primary();
            $table->string('slug');
            $table->string('name')->nullable();
        });

        Schema::create('games', function ($table): void {
            $table->string('id')->primary();
            $table->string('sport_id')->default(self::SPORT_ID);
            $table->string('host_user_id');
            $table->string('court_id')->nullable();
            $table->float('lat')->default(40.0);
            $table->float('lng')->default(49.0);
            $table->timestamp('starts_at')->nullable();
            $table->integer('duration_minutes')->default(60);
            $table->integer('capacity')->default(4);
            $table->string('visibility')->default('public');
            $table->string('match_type')->default('casual');
            $table->integer('skill_min_elo')->nullable();
            $table->integer('skill_max_elo')->nullable();
            $table->string('notes')->nullable();
            $table->string('status')->default('open');
            $table->timestamp('deleted_at')->nullable();
            $table->timestamp('created_at')->nullable();
            $table->timestamp('updated_at')->nullable();
        });

        Schema::create('game_participants', function ($table): void {
            $table->string('game_id');
            $table->string('user_id');
            $table->string('status')->default('confirmed');
            $table->boolean('can_report_result')->default(false);
            $table->timestamp('joined_at')->nullable();
            $table->timestamp('status_changed_at')->nullable();
            $table->primary(['game_id', 'user_id']);
        });

        Schema::create('ratings', function ($table): void {
            $table->string('id')->nullable();
            $table->string('game_id');
            $table->string('rater_user_id');
            $table->string('rated_user_id');
            $table->string('sport_id');
            $table->string('outcome')->nullable();
            $table->boolean('behavior_ok')->default(true);
            $table->timestamp('processed_at')->nullable();
            $table->timestamp('created_at')->nullable();
        });

        Schema::create('player_sport_stats', function ($table): void {
            $table->string('user_id');
            $table->string('sport_id');
            $table->integer('elo_rating')->default(1200);
            $table->integer('games_played')->default(0);
            $table->integer('games_won')->default(0);
            $table->integer('reliability_score')->default(100);
            $table->timestamp('last_recalc_at')->nullable();
            $table->timestamp('updated_at')->nullable();
            $table->primary(['user_id', 'sport_id']);
        });

        Schema::create('match_scores', function ($table): void {
            $table->string('game_id')->primary();
            $table->text('team_a_user_ids');
            $table->text('team_b_user_ids');
            $table->text('sets')->default('[]');
            $table->text('points')->default('[]');
            $table->integer('current_set')->default(0);
            $table->integer('current_game_a')->default(0);
            $table->integer('current_game_b')->default(0);
            $table->integer('point_a')->default(0);
            $table->integer('point_b')->default(0);
            $table->string('status')->default('in_progress');
            $table->timestamp('started_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamp('updated_at')->nullable();
            $table->text('elo_delta_by_user')->nullable();
        });

        // Empty leftJoin targets so GamesController::showResponse (used by noShow)
        // can build its summary payload.
        Schema::create('courts', function ($table): void {
            $table->string('id')->primary();
            $table->string('name')->nullable();
            $table->integer('hourly_price_minor')->nullable();
            $table->string('currency')->nullable();
            $table->string('sport_id')->nullable();
            $table->string('venue_id')->nullable();
        });

        Schema::create('venues', function ($table): void {
            $table->string('id')->primary();
            $table->string('name')->nullable();
            $table->string('address')->nullable();
            $table->string('photo_url')->nullable();
        });

        Schema::create('audit_log', function ($table): void {
            $table->string('id')->primary();
            $table->string('actor_user_id')->nullable();
            $table->string('action');
            $table->string('entity');
            $table->string('entity_id')->nullable();
            $table->text('metadata')->nullable();
            $table->timestamp('created_at')->nullable();
        });

        DB::table('users')->insert(array_map(fn ($id) => ['id' => $id], [
            self::HOST, self::PLAYER_A, self::PLAYER_B, self::NOSHOW, self::CLEAN,
        ]));
        DB::table('sports')->insert(['id' => self::SPORT_ID, 'slug' => 'padel', 'name' => 'Padel']);

        $this->service = app(ReliabilityService::class);
        $this->match = app(MatchController::class);
        $this->games = app(GamesController::class);
    }

    protected function tearDown(): void
    {
        foreach (['audit_log', 'venues', 'courts', 'match_scores', 'player_sport_stats', 'ratings', 'game_participants', 'games', 'sports', 'users'] as $table) {
            Schema::dropIfExists($table);
        }

        parent::tearDown();
    }

    /**
     * The headline requirement: one no-show out of two completed games drops a
     * player below 100, while a player who attended both stays at 100.
     * attendanceRate = 1/2 = 0.5, behaviourRate = 1.0 (no ratings):
     *   round(100 * (0.7*0.5 + 0.3*1.0)) = round(65) = 65.
     */
    public function test_one_no_show_out_of_two_games_drops_reliability_below_100(): void
    {
        $this->completedGame('g-attended', [self::NOSHOW => 'confirmed', self::CLEAN => 'confirmed']);
        $this->completedGame('g-skipped', [self::NOSHOW => 'no_show', self::CLEAN => 'confirmed']);

        $noShowScore = $this->service->recomputeReliability(self::NOSHOW, 'padel');
        $cleanScore = $this->service->recomputeReliability(self::CLEAN, 'padel');

        $this->assertSame(65, $noShowScore);
        $this->assertLessThan(100, $noShowScore);
        $this->assertSame(65, (int) DB::table('player_sport_stats')->where('user_id', self::NOSHOW)->value('reliability_score'));
        $this->assertNotNull(DB::table('player_sport_stats')->where('user_id', self::NOSHOW)->value('last_recalc_at'));

        // A player who showed up to every completed game keeps a perfect score.
        $this->assertSame(100, $cleanScore);
        $this->assertSame(100, (int) DB::table('player_sport_stats')->where('user_id', self::CLEAN)->value('reliability_score'));
    }

    /**
     * Bad-behaviour peer ratings pull the score down via the 0.3 behaviour weight,
     * and the consumed ratings get stamped processed_at (previously dead data).
     * attendanceRate = 1.0, behaviourRate = 0/2 = 0.0:
     *   round(100 * (0.7*1.0 + 0.3*0.0)) = 70.
     */
    public function test_behaviour_ratings_lower_reliability_and_are_marked_processed(): void
    {
        $this->completedGame('g-played', [self::PLAYER_A => 'confirmed']);
        $this->rating(self::HOST, self::PLAYER_A, false);
        $this->rating(self::PLAYER_B, self::PLAYER_A, false);

        $score = $this->service->recomputeReliability(self::PLAYER_A, 'padel');

        $this->assertSame(70, $score);
        $this->assertSame(0, DB::table('ratings')->where('rated_user_id', self::PLAYER_A)->whereNull('processed_at')->count());
    }

    /** Recompute is idempotent: a second call from the same history yields the same score. */
    public function test_recompute_is_idempotent(): void
    {
        $this->completedGame('g-a', [self::NOSHOW => 'confirmed']);
        $this->completedGame('g-b', [self::NOSHOW => 'no_show']);

        $first = $this->service->recomputeReliability(self::NOSHOW, 'padel');
        $second = $this->service->recomputeReliability(self::NOSHOW, 'padel');

        $this->assertSame($first, $second);
        $this->assertSame(65, $second);
    }

    /**
     * Match-completion hook: reportResult() completes the game and recomputes
     * reliability for EVERY participant — including a no-show who never took the
     * court — so the no-show finally counts once its game is completed.
     */
    public function test_completing_a_match_recomputes_reliability_for_all_participants(): void
    {
        DB::table('games')->insert([
            'id' => 'g-live', 'sport_id' => self::SPORT_ID, 'host_user_id' => self::HOST,
            'status' => 'open', 'starts_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('game_participants')->insert([
            ['game_id' => 'g-live', 'user_id' => self::HOST, 'status' => 'confirmed', 'joined_at' => now(), 'status_changed_at' => now()],
            ['game_id' => 'g-live', 'user_id' => self::PLAYER_A, 'status' => 'confirmed', 'joined_at' => now(), 'status_changed_at' => now()],
            ['game_id' => 'g-live', 'user_id' => self::PLAYER_B, 'status' => 'confirmed', 'joined_at' => now(), 'status_changed_at' => now()],
            // Flagged a no-show before the match; not on either team.
            ['game_id' => 'g-live', 'user_id' => self::NOSHOW, 'status' => 'no_show', 'joined_at' => now(), 'status_changed_at' => now()],
        ]);

        $response = $this->match->reportResult($this->requestFor(self::HOST, [
            'team_a_user_ids' => [self::HOST, self::PLAYER_A],
            'team_b_user_ids' => [self::PLAYER_B],
            'sets' => [['a' => 6, 'b' => 0], ['a' => 6, 'b' => 0]],
        ]), 'g-live');

        $this->assertSame('completed', $response->getData(true)['status']);

        // The no-show on a now-completed game: attended 0 / no_show 1 → rate 0.0 →
        // round(100 * 0.3) = 30.
        $this->assertSame(30, (int) DB::table('player_sport_stats')->where('user_id', self::NOSHOW)->value('reliability_score'));
        $this->assertNotNull(DB::table('player_sport_stats')->where('user_id', self::NOSHOW)->value('last_recalc_at'));

        // Players who actually showed up stay at a perfect reliability.
        $this->assertSame(100, (int) DB::table('player_sport_stats')->where('user_id', self::HOST)->value('reliability_score'));
        $this->assertSame(100, (int) DB::table('player_sport_stats')->where('user_id', self::PLAYER_B)->value('reliability_score'));
    }

    /**
     * No-show hook: when a host flags a no-show on an already-completed game,
     * GamesController::noShow recomputes that player's reliability immediately.
     * The recompute runs before the trailing showResponse(), which is Postgres-only
     * under sqlite — so we ignore that final failure and assert the side effects
     * (same convention as GamesHardeningTest::test_leave_is_idempotent...).
     */
    public function test_host_no_show_flag_recomputes_reliability(): void
    {
        // A completed game where PLAYER_A is still a (non-playing) confirmed
        // participant the host now flags as a no-show.
        DB::table('games')->insert([
            'id' => 'g-done', 'sport_id' => self::SPORT_ID, 'host_user_id' => self::HOST,
            'status' => 'completed', 'starts_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('game_participants')->insert([
            ['game_id' => 'g-done', 'user_id' => self::HOST, 'status' => 'confirmed', 'joined_at' => now(), 'status_changed_at' => now()],
            ['game_id' => 'g-done', 'user_id' => self::PLAYER_A, 'status' => 'confirmed', 'joined_at' => now(), 'status_changed_at' => now()],
        ]);

        try {
            $this->games->noShow($this->requestFor(self::HOST), 'g-done', self::PLAYER_A);
        } catch (\Throwable $e) {
            // showResponse() runs Postgres-only SQL under sqlite; ignore that.
        }

        $this->assertSame('no_show', DB::table('game_participants')->where('game_id', 'g-done')->where('user_id', self::PLAYER_A)->value('status'));
        // 0 attended / 1 no_show on a completed game → reliability 30.
        $this->assertSame(30, (int) DB::table('player_sport_stats')->where('user_id', self::PLAYER_A)->value('reliability_score'));
    }

    /** Insert a completed game with the given {user_id => participant_status} roster. */
    private function completedGame(string $gameId, array $roster): void
    {
        DB::table('games')->insert([
            'id' => $gameId, 'sport_id' => self::SPORT_ID, 'host_user_id' => self::HOST,
            'status' => 'completed', 'starts_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);
        foreach ($roster as $userId => $status) {
            DB::table('game_participants')->insert([
                'game_id' => $gameId, 'user_id' => $userId, 'status' => $status,
                'joined_at' => now(), 'status_changed_at' => now(),
            ]);
        }
    }

    private function rating(string $rater, string $rated, bool $behaviorOk): void
    {
        DB::table('ratings')->insert([
            'id' => (string) \Illuminate\Support\Str::uuid(),
            'game_id' => 'g-played',
            'rater_user_id' => $rater,
            'rated_user_id' => $rated,
            'sport_id' => self::SPORT_ID,
            'outcome' => 'win',
            'behavior_ok' => $behaviorOk,
            'created_at' => now(),
        ]);
    }

    private function requestFor(string $userId, array $body = []): Request
    {
        $request = Request::create('/api/v1/test', 'POST', $body);
        $user = new User();
        $user->forceFill(['id' => $userId]);
        $request->attributes->set('auth_user', $user);

        return $request;
    }
}
