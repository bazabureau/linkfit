<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\AmericanoController;
use App\Models\User;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Correctness of host-run americano scoring + start.
 * Guards verified: first-time score() records the result and recomputes the
 * standings (and auto-completes the tournament on the last match); re-scoring an
 * already-completed match is rejected with 409 (no silent result overwrite);
 * starting an already-playing tournament again does not double-generate the
 * bracket. (Mirrors the in-memory harness in GameScoringEloTest.)
 */
class AmericanoScoringTest extends TestCase
{
    private const HOST = '00000000-0000-4000-8000-000000000001';

    private const OUTSIDER = '00000000-0000-4000-8000-000000000002';

    private const TOURNAMENT = '11111111-1111-4111-8111-111111111111';

    private const TEAM_A = '22222222-2222-4222-8222-222222222221';

    private const TEAM_B = '22222222-2222-4222-8222-222222222222';

    private const MATCH = '33333333-3333-4333-8333-333333333331';

    private AmericanoController $controller;

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
        DB::purge('sqlite');
        DB::reconnect('sqlite');

        Schema::create('users', function ($table): void {
            $table->string('id')->primary();
            $table->string('display_name')->nullable();
            $table->timestamp('created_at')->nullable();
        });

        Schema::create('americano_tournaments', function ($table): void {
            $table->string('id')->primary();
            $table->string('name');
            $table->string('format')->default('solo');
            $table->string('host_id');
            $table->integer('court_count')->default(1);
            $table->string('scoring_system')->default('points');
            $table->string('status')->default('open');
            $table->timestamp('created_at')->nullable();
        });

        Schema::create('americano_teams', function ($table): void {
            $table->string('id')->primary();
            $table->string('tournament_id');
            $table->string('user_id')->nullable();
            $table->string('display_name');
            $table->integer('wins')->default(0);
            $table->integer('draws')->default(0);
            $table->integer('losses')->default(0);
            $table->integer('score')->default(0);
        });

        Schema::create('americano_matches', function ($table): void {
            $table->string('id')->primary();
            $table->string('tournament_id');
            $table->string('court_name');
            $table->integer('round_number');
            $table->string('team_a_id');
            $table->string('team_b_id');
            $table->integer('score_a')->nullable();
            $table->integer('score_b')->nullable();
            $table->string('status')->default('pending');
            $table->timestamp('created_at')->nullable();
        });

        DB::table('users')->insert([
            ['id' => self::HOST, 'display_name' => 'Host'],
            ['id' => self::OUTSIDER, 'display_name' => 'Outsider'],
        ]);

        $this->controller = app(AmericanoController::class);
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('americano_matches');
        Schema::dropIfExists('americano_teams');
        Schema::dropIfExists('americano_tournaments');
        Schema::dropIfExists('users');

        parent::tearDown();
    }

    public function test_first_time_scoring_records_result_and_recomputes_standings(): void
    {
        // A two-team `playing` tournament with a single match: scoring it must
        // record the score, recompute both standings from the completed match,
        // and (it being the last match) auto-complete the tournament.
        $this->seedPlayingTournamentWithOneMatch();

        $response = $this->controller->score(
            $this->requestFor(self::HOST, ['score_a' => 6, 'score_b' => 2]),
            self::MATCH,
        );
        $payload = $response->getData(true);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame('completed', $payload['status']);
        $this->assertSame(6, (int) $payload['score_a']);
        $this->assertSame(2, (int) $payload['score_b']);

        // Standings recomputed: team A won (points scoring → 6), team B lost (2).
        $teamA = DB::table('americano_teams')->where('id', self::TEAM_A)->first();
        $teamB = DB::table('americano_teams')->where('id', self::TEAM_B)->first();
        $this->assertSame(1, (int) $teamA->wins);
        $this->assertSame(0, (int) $teamA->losses);
        $this->assertSame(6, (int) $teamA->score);
        $this->assertSame(0, (int) $teamB->wins);
        $this->assertSame(1, (int) $teamB->losses);
        $this->assertSame(2, (int) $teamB->score);

        // Last match scored → tournament auto-completes.
        $this->assertSame('completed', DB::table('americano_tournaments')->where('id', self::TOURNAMENT)->value('status'));
    }

    public function test_rescoring_an_already_completed_match_is_rejected_with_conflict(): void
    {
        $this->seedPlayingTournamentWithOneMatch();
        $this->controller->score($this->requestFor(self::HOST, ['score_a' => 6, 'score_b' => 2]), self::MATCH);

        $standingsAfterFirst = DB::table('americano_teams')->orderBy('id')->get(['wins', 'losses', 'score'])->toArray();

        // Re-POSTing a (different) score on the now-completed match must be
        // rejected with 409 — a finished result cannot be silently rewritten.
        try {
            $this->controller->score($this->requestFor(self::HOST, ['score_a' => 0, 'score_b' => 7]), self::MATCH);
            $this->fail('Expected re-scoring a completed match to conflict.');
        } catch (ApiException $exception) {
            $this->assertSame(409, $exception->getStatusCode());
        }

        // The original result and standings are untouched by the rejected write.
        $match = DB::table('americano_matches')->where('id', self::MATCH)->first();
        $this->assertSame(6, (int) $match->score_a);
        $this->assertSame(2, (int) $match->score_b);
        $this->assertEquals(
            $standingsAfterFirst,
            DB::table('americano_teams')->orderBy('id')->get(['wins', 'losses', 'score'])->toArray(),
        );
    }

    public function test_starting_an_already_playing_tournament_does_not_double_generate_fixtures(): void
    {
        // An `open` solo tournament with two registered teams, no fixtures yet.
        DB::table('americano_tournaments')->insert([
            'id' => self::TOURNAMENT,
            'name' => 'Friday Americano',
            'format' => 'solo',
            'host_id' => self::HOST,
            'court_count' => 1,
            'scoring_system' => 'points',
            'status' => 'open',
            'created_at' => now(),
        ]);
        DB::table('americano_teams')->insert([
            ['id' => self::TEAM_A, 'tournament_id' => self::TOURNAMENT, 'display_name' => 'A'],
            ['id' => self::TEAM_B, 'tournament_id' => self::TOURNAMENT, 'display_name' => 'B'],
        ]);

        // First start draws the round-robin (two teams → exactly one match).
        $this->controller->start($this->requestFor(self::HOST), self::TOURNAMENT);
        $this->assertSame('playing', DB::table('americano_tournaments')->where('id', self::TOURNAMENT)->value('status'));
        $this->assertSame(1, DB::table('americano_matches')->where('tournament_id', self::TOURNAMENT)->count());

        // Starting again is rejected and must NOT append a second bracket.
        try {
            $this->controller->start($this->requestFor(self::HOST), self::TOURNAMENT);
            $this->fail('Expected starting an already-playing tournament to conflict.');
        } catch (ApiException $exception) {
            $this->assertSame(409, $exception->getStatusCode());
        }
        $this->assertSame(1, DB::table('americano_matches')->where('tournament_id', self::TOURNAMENT)->count());
    }

    public function test_only_the_host_can_submit_scores(): void
    {
        $this->seedPlayingTournamentWithOneMatch();

        try {
            $this->controller->score($this->requestFor(self::OUTSIDER, ['score_a' => 6, 'score_b' => 2]), self::MATCH);
            $this->fail('Expected a non-host scoring attempt to be forbidden.');
        } catch (ApiException $exception) {
            $this->assertSame(403, $exception->getStatusCode());
        }

        // Match untouched by the rejected attempt.
        $this->assertSame('pending', DB::table('americano_matches')->where('id', self::MATCH)->value('status'));
    }

    /** A `playing` 2-team tournament holding a single pending match. */
    private function seedPlayingTournamentWithOneMatch(): void
    {
        DB::table('americano_tournaments')->insert([
            'id' => self::TOURNAMENT,
            'name' => 'Friday Americano',
            'format' => 'solo',
            'host_id' => self::HOST,
            'court_count' => 1,
            'scoring_system' => 'points',
            'status' => 'playing',
            'created_at' => now(),
        ]);
        DB::table('americano_teams')->insert([
            ['id' => self::TEAM_A, 'tournament_id' => self::TOURNAMENT, 'display_name' => 'A'],
            ['id' => self::TEAM_B, 'tournament_id' => self::TOURNAMENT, 'display_name' => 'B'],
        ]);
        DB::table('americano_matches')->insert([
            'id' => self::MATCH,
            'tournament_id' => self::TOURNAMENT,
            'court_name' => 'Court 1',
            'round_number' => 1,
            'team_a_id' => self::TEAM_A,
            'team_b_id' => self::TEAM_B,
            'score_a' => null,
            'score_b' => null,
            'status' => 'pending',
            'created_at' => now(),
        ]);
    }

    private function requestFor(string $userId, array $body = []): Request
    {
        $request = Request::create('/api/v1/test', 'POST', $body);
        $user = new User;
        $user->forceFill(['id' => $userId]);
        $request->attributes->set('auth_user', $user);

        return $request;
    }
}
