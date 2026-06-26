<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\MatchController;
use App\Models\User;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Authorization + validation hardening for the rating/scoring write paths:
 * peer-rating eligibility (started match + confirmed participant), self/
 * non-participant exclusion, soft-deleted game rejection, and strict uuid
 * validation on the scoring-start team rosters (the values that feed the raw
 * pg uuid[] literal). Mirrors the in-memory harness used by GameScoringEloTest.
 */
class MatchScoringHardeningTest extends TestCase
{
    private const HOST = '00000000-0000-4000-8000-000000000001';
    private const PLAYER_ONE = '00000000-0000-4000-8000-000000000002';
    private const PLAYER_TWO = '00000000-0000-4000-8000-000000000003';
    private const OUTSIDER = '00000000-0000-4000-8000-000000000009';

    private MatchController $controller;

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
        DB::purge('sqlite');
        DB::reconnect('sqlite');

        Schema::create('users', function ($table): void {
            $table->string('id')->primary();
            $table->string('email')->nullable();
            $table->timestamp('created_at')->nullable();
        });

        Schema::create('games', function ($table): void {
            $table->string('id')->primary();
            $table->string('sport_id')->default('sport-padel');
            $table->string('host_user_id');
            $table->string('status')->default('open');
            $table->string('visibility')->default('public');
            $table->timestamp('deleted_at')->nullable();
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

        Schema::create('ratings', function ($table): void {
            $table->string('game_id');
            $table->string('rater_user_id');
            $table->string('rated_user_id');
            $table->string('sport_id')->nullable();
            $table->string('outcome');
            $table->boolean('behavior_ok')->default(true);
            $table->timestamp('created_at')->nullable();
            $table->primary(['game_id', 'rater_user_id', 'rated_user_id']);
        });

        Schema::create('player_sport_stats', function ($table): void {
            $table->string('user_id');
            $table->string('sport_id');
            $table->integer('elo_rating')->default(1200);
            $table->integer('games_played')->default(0);
            $table->integer('games_won')->default(0);
            $table->timestamp('updated_at')->nullable();
            $table->primary(['user_id', 'sport_id']);
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

        DB::table('users')->insert([
            ['id' => self::HOST],
            ['id' => self::PLAYER_ONE],
            ['id' => self::PLAYER_TWO],
            ['id' => self::OUTSIDER],
        ]);
        DB::table('games')->insert([
            'id' => 'game-one',
            'sport_id' => 'sport-padel',
            'host_user_id' => self::HOST,
            'status' => 'open',
            'visibility' => 'public',
        ]);
        DB::table('game_participants')->insert([
            ['game_id' => 'game-one', 'user_id' => self::HOST, 'status' => 'confirmed', 'joined_at' => now(), 'status_changed_at' => now()],
            ['game_id' => 'game-one', 'user_id' => self::PLAYER_ONE, 'status' => 'confirmed', 'joined_at' => now(), 'status_changed_at' => now()],
            ['game_id' => 'game-one', 'user_id' => self::PLAYER_TWO, 'status' => 'confirmed', 'joined_at' => now(), 'status_changed_at' => now()],
        ]);
        DB::table('match_scores')->insert([
            'game_id' => 'game-one',
            'team_a_user_ids' => '{'.self::HOST.','.self::PLAYER_ONE.'}',
            'team_b_user_ids' => '{'.self::PLAYER_TWO.'}',
            'sets' => '[]',
            'points' => '[]',
            'status' => 'in_progress',
            'started_at' => now(),
            'updated_at' => now(),
        ]);

        $this->controller = app(MatchController::class);
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('audit_log');
        Schema::dropIfExists('player_sport_stats');
        Schema::dropIfExists('ratings');
        Schema::dropIfExists('match_scores');
        Schema::dropIfExists('game_participants');
        Schema::dropIfExists('games');
        Schema::dropIfExists('users');

        parent::tearDown();
    }

    public function test_submit_ratings_records_peers_and_skips_self_and_non_participants(): void
    {
        $response = $this->controller->submitRatings($this->requestFor(self::HOST, [
            'ratings' => [
                ['rated_user_id' => self::PLAYER_ONE, 'outcome' => 'win', 'behavior_ok' => true],
                ['rated_user_id' => self::PLAYER_TWO, 'outcome' => 'loss', 'behavior_ok' => true],
                ['rated_user_id' => self::HOST, 'outcome' => 'draw', 'behavior_ok' => true],
                ['rated_user_id' => self::OUTSIDER, 'outcome' => 'win', 'behavior_ok' => false],
            ],
        ]), 'game-one');
        $payload = $response->getData(true);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame(2, $payload['recorded']);
        $this->assertSame(2, $payload['skipped_duplicates']);

        // Exactly the two valid peers persisted; never a self-rating row.
        $this->assertSame(2, DB::table('ratings')->where('rater_user_id', self::HOST)->count());
        $this->assertSame(0, DB::table('ratings')->where('rated_user_id', self::HOST)->count());
        // Ratings must NOT touch ELO/stats — that is complete()'s job alone.
        $this->assertSame(0, DB::table('player_sport_stats')->count());
    }

    public function test_submit_ratings_rejected_before_match_starts(): void
    {
        // No started/completed scoring row and the game is still open.
        DB::table('match_scores')->where('game_id', 'game-one')->delete();

        try {
            $this->controller->submitRatings($this->requestFor(self::HOST, [
                'ratings' => [['rated_user_id' => self::PLAYER_ONE, 'outcome' => 'win', 'behavior_ok' => true]],
            ]), 'game-one');
            $this->fail('Expected ratings before match start to be rejected.');
        } catch (ApiException $exception) {
            $this->assertSame(422, $exception->getStatusCode());
            $this->assertSame('Ratings can only be submitted after the game has started', $exception->getMessage());
        }

        $this->assertSame(0, DB::table('ratings')->count());
    }

    public function test_submit_ratings_forbidden_for_non_participant(): void
    {
        $this->expectException(ApiException::class);
        $this->expectExceptionMessage('Only confirmed participants can submit ratings');

        $this->controller->submitRatings($this->requestFor(self::OUTSIDER, [
            'ratings' => [['rated_user_id' => self::PLAYER_ONE, 'outcome' => 'win', 'behavior_ok' => true]],
        ]), 'game-one');
    }

    public function test_submit_ratings_404_for_missing_or_deleted_game(): void
    {
        try {
            $this->controller->submitRatings($this->requestFor(self::HOST, [
                'ratings' => [['rated_user_id' => self::PLAYER_ONE, 'outcome' => 'win', 'behavior_ok' => true]],
            ]), 'does-not-exist');
            $this->fail('Expected missing game to 404.');
        } catch (ApiException $exception) {
            $this->assertSame(404, $exception->getStatusCode());
        }

        // Soft-deleted game is treated as not found, not a ratable game.
        DB::table('games')->where('id', 'game-one')->update(['deleted_at' => now()]);
        try {
            $this->controller->submitRatings($this->requestFor(self::HOST, [
                'ratings' => [['rated_user_id' => self::PLAYER_ONE, 'outcome' => 'win', 'behavior_ok' => true]],
            ]), 'game-one');
            $this->fail('Expected soft-deleted game to 404.');
        } catch (ApiException $exception) {
            $this->assertSame(404, $exception->getStatusCode());
        }
    }

    public function test_submit_ratings_rejects_invalid_outcome(): void
    {
        try {
            $this->controller->submitRatings($this->requestFor(self::HOST, [
                'ratings' => [['rated_user_id' => self::PLAYER_ONE, 'outcome' => 'forfeit', 'behavior_ok' => true]],
            ]), 'game-one');
            $this->fail('Expected an invalid outcome enum to be rejected.');
        } catch (ApiException $exception) {
            $this->assertSame(422, $exception->getStatusCode());
        }
    }

    public function test_start_scoring_happy_path_initialises_rosters(): void
    {
        $response = $this->controller->startScoring($this->requestFor(self::HOST, [
            'team_a_user_ids' => [self::HOST, self::PLAYER_ONE],
            'team_b_user_ids' => [self::PLAYER_TWO],
        ]), 'game-one');
        $payload = $response->getData(true);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame('in_progress', $payload['status']);
        $this->assertSame([self::HOST, self::PLAYER_ONE], $payload['team_a_user_ids']);
        $this->assertSame([self::PLAYER_TWO], $payload['team_b_user_ids']);
    }

    public function test_start_scoring_rejects_non_uuid_team_member(): void
    {
        try {
            $this->controller->startScoring($this->requestFor(self::HOST, [
                'team_a_user_ids' => ['not-a-uuid'],
                'team_b_user_ids' => [self::PLAYER_TWO],
            ]), 'game-one');
            $this->fail('Expected a non-uuid team member to be rejected.');
        } catch (ApiException $exception) {
            $this->assertSame(422, $exception->getStatusCode());
        }
    }

    public function test_start_scoring_forbidden_for_non_delegated_player(): void
    {
        try {
            $this->controller->startScoring($this->requestFor(self::PLAYER_TWO, [
                'team_a_user_ids' => [self::HOST, self::PLAYER_ONE],
                'team_b_user_ids' => [self::PLAYER_TWO],
            ]), 'game-one');
            $this->fail('Expected a non-delegated player to be forbidden from starting scoring.');
        } catch (ApiException $exception) {
            $this->assertSame(403, $exception->getStatusCode());
        }
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
