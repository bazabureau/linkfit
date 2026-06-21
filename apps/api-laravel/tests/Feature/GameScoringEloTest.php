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
 * Correctness of point-by-point scoring → complete() → ELO/stats application.
 * Guards verified: canonical replayState winner drives ELO; ELO applied exactly
 * once; an incomplete match cannot be completed; a completed match cannot be
 * re-scored to double-apply ELO. (Mirrors the harness in GameResultAccessTest.)
 */
class GameScoringEloTest extends TestCase
{
    private const HOST = '00000000-0000-4000-8000-000000000001';
    private const PLAYER_ONE = '00000000-0000-4000-8000-000000000002';
    private const PLAYER_TWO = '00000000-0000-4000-8000-000000000003';

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
        ]);
        DB::table('games')->insert([
            'id' => 'game-one',
            'sport_id' => 'sport-padel',
            'host_user_id' => self::HOST,
            'status' => 'open',
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
        Schema::dropIfExists('match_scores');
        Schema::dropIfExists('game_participants');
        Schema::dropIfExists('games');
        Schema::dropIfExists('users');

        parent::tearDown();
    }

    public function test_completing_a_fully_played_match_records_winner_and_applies_elo_once(): void
    {
        // Play a decisive best-of-3: team A sweeps two 6-0 sets (golden point
        // means 4 straight points wins each game; 6 games wins each set).
        $this->playMatch($this->straightSetSweepForTeamA());

        $response = $this->controller->complete($this->requestFor(self::HOST), 'game-one');
        $payload = $response->getData(true);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame('completed', $payload['status']);
        $this->assertSame('a', $payload['winning_team']);
        $this->assertSame('completed', DB::table('games')->where('id', 'game-one')->value('status'));

        // ELO applied exactly once: winners (host + player one) on team A gain,
        // the loser (player two) on team B drops, each played one game.
        $hostElo = (int) DB::table('player_sport_stats')->where('user_id', self::HOST)->value('elo_rating');
        $loserElo = (int) DB::table('player_sport_stats')->where('user_id', self::PLAYER_TWO)->value('elo_rating');
        $this->assertGreaterThan(1200, $hostElo);
        $this->assertLessThan(1200, $loserElo);
        $this->assertSame(1, (int) DB::table('player_sport_stats')->where('user_id', self::HOST)->value('games_played'));
        $this->assertSame(1, (int) DB::table('player_sport_stats')->where('user_id', self::HOST)->value('games_won'));
        $this->assertSame(1, (int) DB::table('player_sport_stats')->where('user_id', self::PLAYER_TWO)->value('games_played'));
        $this->assertSame(0, (int) DB::table('player_sport_stats')->where('user_id', self::PLAYER_TWO)->value('games_won'));
    }

    public function test_second_complete_or_rescore_attempt_does_not_apply_elo_again(): void
    {
        $this->playMatch($this->straightSetSweepForTeamA());
        $this->controller->complete($this->requestFor(self::HOST), 'game-one');

        $hostEloAfterFirst = (int) DB::table('player_sport_stats')->where('user_id', self::HOST)->value('elo_rating');
        $hostPlayedAfterFirst = (int) DB::table('player_sport_stats')->where('user_id', self::HOST)->value('games_played');

        // A second complete() must NOT mutate stats: the row is completed, so the
        // scoring-not-in-progress conflict guard fires before any ELO write.
        try {
            $this->controller->complete($this->requestFor(self::HOST), 'game-one');
            $this->fail('Expected second complete() on a completed match to conflict.');
        } catch (ApiException $exception) {
            $this->assertSame(409, $exception->getStatusCode());
        }

        // Re-scoring (startScoring) a completed match is also rejected, so a host
        // cannot reset → re-complete to double-apply ELO.
        try {
            $this->controller->startScoring($this->requestFor(self::HOST, [
                'team_a_user_ids' => [self::HOST, self::PLAYER_ONE],
                'team_b_user_ids' => [self::PLAYER_TWO],
            ]), 'game-one');
            $this->fail('Expected startScoring on a completed match to conflict.');
        } catch (ApiException $exception) {
            $this->assertSame(409, $exception->getStatusCode());
        }

        // Stats unchanged after both rejected attempts.
        $this->assertSame($hostEloAfterFirst, (int) DB::table('player_sport_stats')->where('user_id', self::HOST)->value('elo_rating'));
        $this->assertSame($hostPlayedAfterFirst, (int) DB::table('player_sport_stats')->where('user_id', self::HOST)->value('games_played'));
        $this->assertSame(1, $hostPlayedAfterFirst);
    }

    public function test_completing_an_incomplete_match_is_rejected_without_applying_elo(): void
    {
        // A handful of points — nowhere near two decided sets, so no winner.
        $this->playMatch(['a', 'b', 'a', 'a']);

        try {
            $this->controller->complete($this->requestFor(self::HOST), 'game-one');
            $this->fail('Expected completing an undecided match to be rejected.');
        } catch (ApiException $exception) {
            $this->assertSame(422, $exception->getStatusCode());
            $this->assertSame('Match is not complete', $exception->getMessage());
        }

        // No ELO/stats row written for an undecided match.
        $this->assertSame(0, DB::table('player_sport_stats')->count());
        $this->assertSame('in_progress', DB::table('match_scores')->where('game_id', 'game-one')->value('status'));
        $this->assertNotSame('completed', DB::table('games')->where('id', 'game-one')->value('status'));
    }

    /** Feed a chronological points log through point() to drive scoring state. */
    private function playMatch(array $points): void
    {
        foreach ($points as $team) {
            $this->controller->point($this->requestFor(self::HOST, ['team' => $team]), 'game-one');
        }
    }

    /**
     * Points for team A to win two straight 6-0 sets (best-of-3 decided).
     * Golden point: 4 points = 1 game; 6 games = 1 set; 2 sets = match.
     */
    private function straightSetSweepForTeamA(): array
    {
        // 2 sets * 6 games * 4 points, all to team A.
        return array_fill(0, 2 * 6 * 4, 'a');
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
