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
 * Security + validation hardening for the americano slice. Complements
 * AmericanoScoringTest (which covers score/start correctness) by exercising
 * create/registration authorization, input validation, the discovery filter,
 * the per-tournament team cap, and the solo single-entry invariant.
 */
class AmericanoHardeningTest extends TestCase
{
    private const HOST = '00000000-0000-4000-8000-000000000001';

    private const OUTSIDER = '00000000-0000-4000-8000-000000000002';

    private const TOURNAMENT = '11111111-1111-4111-8111-111111111111';

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

    public function test_store_creates_tournament_and_returns_enriched_payload(): void
    {
        $response = $this->controller->store($this->requestFor(self::HOST, [
            'name' => 'Sunday Americano',
            'format' => 'team',
            'court_count' => 3,
            'scoring_system' => 'games',
        ]));
        $payload = $response->getData(true);

        $this->assertSame(201, $response->getStatusCode());
        $this->assertSame('Sunday Americano', $payload['name']);
        $this->assertSame('Sunday Americano', $payload['title']);
        // Generic Tournament clients read format=americano + capacity aliases.
        $this->assertSame('americano', $payload['format']);
        $this->assertSame(3, (int) $payload['capacity']);
        $this->assertSame(0, (int) $payload['teams_count']);
        // The persisted row keeps the caller as host and starts `open`.
        $row = DB::table('americano_tournaments')->where('id', $payload['id'])->first();
        $this->assertSame(self::HOST, (string) $row->host_id);
        $this->assertSame('open', $row->status);
        $this->assertSame('team', $row->format);
    }

    public function test_store_rejects_missing_name_with_422(): void
    {
        $this->expectApiStatus(422, fn () => $this->controller->store($this->requestFor(self::HOST, [
            'court_count' => 1,
        ])));
        $this->assertSame(0, DB::table('americano_tournaments')->count());
    }

    public function test_store_rejects_out_of_range_court_count_and_bad_enums(): void
    {
        $this->expectApiStatus(422, fn () => $this->controller->store($this->requestFor(self::HOST, [
            'name' => 'X',
            'court_count' => 0,
        ])));
        $this->expectApiStatus(422, fn () => $this->controller->store($this->requestFor(self::HOST, [
            'name' => 'X',
            'court_count' => 999,
        ])));
        $this->expectApiStatus(422, fn () => $this->controller->store($this->requestFor(self::HOST, [
            'name' => 'X',
            'format' => 'doubles',
        ])));
        $this->expectApiStatus(422, fn () => $this->controller->store($this->requestFor(self::HOST, [
            'name' => 'X',
            'scoring_system' => 'sets',
        ])));
        $this->assertSame(0, DB::table('americano_tournaments')->count());
    }

    public function test_only_host_can_register_teams(): void
    {
        $this->seedOpenTournament('team');

        $this->expectApiStatus(403, fn () => $this->controller->teams(
            $this->requestFor(self::OUTSIDER, ['display_name' => 'Intruders']),
            self::TOURNAMENT,
        ));
        $this->assertSame(0, DB::table('americano_teams')->count());
    }

    public function test_team_format_requires_display_name(): void
    {
        $this->seedOpenTournament('team');

        $this->expectApiStatus(422, fn () => $this->controller->teams(
            $this->requestFor(self::HOST, []),
            self::TOURNAMENT,
        ));
        $this->assertSame(0, DB::table('americano_teams')->count());
    }

    public function test_cannot_register_teams_once_not_open(): void
    {
        $this->seedOpenTournament('team');
        DB::table('americano_tournaments')->where('id', self::TOURNAMENT)->update(['status' => 'playing']);

        $this->expectApiStatus(409, fn () => $this->controller->teams(
            $this->requestFor(self::HOST, ['display_name' => 'Late entry']),
            self::TOURNAMENT,
        ));
        $this->assertSame(0, DB::table('americano_teams')->count());
    }

    public function test_teams_on_missing_tournament_is_404(): void
    {
        $this->expectApiStatus(404, fn () => $this->controller->teams(
            $this->requestFor(self::HOST, ['display_name' => 'Ghost']),
            'no-such-tournament',
        ));
    }

    public function test_solo_registration_is_single_entry_per_player(): void
    {
        $this->seedOpenTournament('solo');

        $first = $this->controller->teams($this->requestFor(self::HOST), self::TOURNAMENT);
        $this->assertSame(201, $first->getStatusCode());
        $this->assertSame(self::HOST, (string) $first->getData(true)['user_id']);

        // A second solo entry for the same player must be rejected.
        $this->expectApiStatus(409, fn () => $this->controller->teams(
            $this->requestFor(self::HOST),
            self::TOURNAMENT,
        ));
        $this->assertSame(1, DB::table('americano_teams')->count());
    }

    public function test_any_player_can_self_register_for_a_solo_tournament(): void
    {
        // A solo tournament is self-registration: a non-host player adds THEMSELVES
        // (without this fix only the host could be added once, so a solo event
        // could never reach the two entries start() needs).
        $this->seedOpenTournament('solo');

        $response = $this->controller->teams($this->requestFor(self::OUTSIDER), self::TOURNAMENT);

        $this->assertSame(201, $response->getStatusCode());
        $this->assertSame(self::OUTSIDER, (string) $response->getData(true)['user_id']);
        $this->assertSame(1, DB::table('americano_teams')->where('tournament_id', self::TOURNAMENT)->where('user_id', self::OUTSIDER)->count());
    }

    public function test_solo_tournament_with_two_self_registered_players_can_start(): void
    {
        $this->seedOpenTournament('solo');

        // Two DIFFERENT players self-register, each as their own one-person entry.
        $this->controller->teams($this->requestFor(self::HOST), self::TOURNAMENT);
        $this->controller->teams($this->requestFor(self::OUTSIDER), self::TOURNAMENT);
        $this->assertSame(2, DB::table('americano_teams')->where('tournament_id', self::TOURNAMENT)->count());

        // The host can now start the draw — two entries → exactly one match.
        $response = $this->controller->start($this->requestFor(self::HOST), self::TOURNAMENT);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame('playing', DB::table('americano_tournaments')->where('id', self::TOURNAMENT)->value('status'));
        $this->assertSame(1, DB::table('americano_matches')->where('tournament_id', self::TOURNAMENT)->count());

        // mine() resolves the self-registered player's joined event.
        $mineIds = array_column($this->controller->mine($this->requestFor(self::OUTSIDER))->getData(true)['items'], 'id');
        $this->assertContains(self::TOURNAMENT, $mineIds);
    }

    public function test_team_roster_is_capped(): void
    {
        $this->seedOpenTournament('team');

        // Fill the roster to the cap directly, then the next add must 409.
        $rows = [];
        for ($i = 0; $i < 64; $i++) {
            $rows[] = [
                'id' => sprintf('44444444-4444-4444-8444-%012d', $i),
                'tournament_id' => self::TOURNAMENT,
                'display_name' => 'T'.$i,
                'wins' => 0,
                'draws' => 0,
                'losses' => 0,
                'score' => 0,
            ];
        }
        DB::table('americano_teams')->insert($rows);

        $this->expectApiStatus(409, fn () => $this->controller->teams(
            $this->requestFor(self::HOST, ['display_name' => 'One too many']),
            self::TOURNAMENT,
        ));
        $this->assertSame(64, DB::table('americano_teams')->where('tournament_id', self::TOURNAMENT)->count());
    }

    public function test_start_requires_host(): void
    {
        $this->seedOpenTournament('team');
        DB::table('americano_teams')->insert([
            ['id' => 'aaaa1111-1111-4111-8111-111111111111', 'tournament_id' => self::TOURNAMENT, 'display_name' => 'A'],
            ['id' => 'aaaa2222-2222-4222-8222-222222222222', 'tournament_id' => self::TOURNAMENT, 'display_name' => 'B'],
        ]);

        $this->expectApiStatus(403, fn () => $this->controller->start(
            $this->requestFor(self::OUTSIDER),
            self::TOURNAMENT,
        ));
        $this->assertSame('open', DB::table('americano_tournaments')->where('id', self::TOURNAMENT)->value('status'));
    }

    public function test_start_requires_at_least_two_teams(): void
    {
        $this->seedOpenTournament('team');
        DB::table('americano_teams')->insert([
            ['id' => 'aaaa1111-1111-4111-8111-111111111111', 'tournament_id' => self::TOURNAMENT, 'display_name' => 'A'],
        ]);

        $this->expectApiStatus(409, fn () => $this->controller->start(
            $this->requestFor(self::HOST),
            self::TOURNAMENT,
        ));
        $this->assertSame(0, DB::table('americano_matches')->count());
    }

    public function test_score_validation_rejects_out_of_range_and_missing_scores(): void
    {
        $this->seedPlayingTournamentWithOneMatch();

        $this->expectApiStatus(422, fn () => $this->controller->score(
            $this->requestFor(self::HOST, ['score_a' => 6]),
            'match-1',
        ));
        $this->expectApiStatus(422, fn () => $this->controller->score(
            $this->requestFor(self::HOST, ['score_a' => -1, 'score_b' => 2]),
            'match-1',
        ));
        $this->expectApiStatus(422, fn () => $this->controller->score(
            $this->requestFor(self::HOST, ['score_a' => 100, 'score_b' => 2]),
            'match-1',
        ));
        $this->assertSame('pending', DB::table('americano_matches')->where('id', 'match-1')->value('status'));
    }

    public function test_score_on_missing_match_is_404(): void
    {
        $this->expectApiStatus(404, fn () => $this->controller->score(
            $this->requestFor(self::HOST, ['score_a' => 1, 'score_b' => 0]),
            'no-such-match',
        ));
    }

    public function test_index_lists_only_open_and_playing_and_requires_auth(): void
    {
        DB::table('americano_tournaments')->insert([
            $this->tournamentRow('t-open', 'open'),
            $this->tournamentRow('t-playing', 'playing'),
            $this->tournamentRow('t-done', 'completed'),
        ]);

        $payload = $this->controller->index($this->requestFor(self::HOST))->getData(true);
        $ids = array_column($payload['items'], 'id');
        sort($ids);
        $this->assertSame(['t-open', 't-playing'], $ids);

        // Unauthenticated index is rejected.
        $this->expectApiStatus(401, fn () => $this->controller->index(Request::create('/api/v1/test', 'GET')));
    }

    public function test_index_clamps_limit(): void
    {
        DB::table('americano_tournaments')->insert([
            $this->tournamentRow('t-1', 'open'),
            $this->tournamentRow('t-2', 'open'),
        ]);

        $request = Request::create('/api/v1/test', 'GET', ['limit' => 1]);
        $user = new User;
        $user->forceFill(['id' => self::HOST]);
        $request->attributes->set('auth_user', $user);

        $payload = $this->controller->index($request)->getData(true);
        $this->assertCount(1, $payload['items']);
    }

    public function test_mine_returns_hosted_and_joined_tournaments(): void
    {
        DB::table('americano_tournaments')->insert([
            $this->tournamentRow('t-hosted', 'open', self::HOST),
            $this->tournamentRow('t-joined', 'playing', self::OUTSIDER),
            $this->tournamentRow('t-other', 'open', self::OUTSIDER),
        ]);
        // HOST joined t-joined as a team member.
        DB::table('americano_teams')->insert([
            'id' => 'team-joined', 'tournament_id' => 't-joined', 'user_id' => self::HOST, 'display_name' => 'Me',
        ]);

        $payload = $this->controller->mine($this->requestFor(self::HOST))->getData(true);
        $ids = array_column($payload['items'], 'id');
        sort($ids);
        $this->assertSame(['t-hosted', 't-joined'], $ids);
    }

    public function test_show_returns_full_details_shape(): void
    {
        $this->seedPlayingTournamentWithOneMatch();

        $payload = $this->controller->show($this->requestFor(self::HOST), self::TOURNAMENT)->getData(true);
        $this->assertArrayHasKey('tournament', $payload);
        $this->assertArrayHasKey('teams', $payload);
        $this->assertArrayHasKey('matches', $payload);
        $this->assertArrayHasKey('leaderboard', $payload);
        $this->assertCount(2, $payload['teams']);
        $this->assertCount(1, $payload['matches']);
        $this->assertCount(2, $payload['leaderboard']);
    }

    public function test_show_on_missing_tournament_is_404(): void
    {
        $this->expectApiStatus(404, fn () => $this->controller->show(
            $this->requestFor(self::HOST),
            'no-such-tournament',
        ));
    }

    // ---- helpers ---------------------------------------------------------

    private function seedOpenTournament(string $format): void
    {
        DB::table('americano_tournaments')->insert($this->tournamentRow(self::TOURNAMENT, 'open', self::HOST, $format));
    }

    private function seedPlayingTournamentWithOneMatch(): void
    {
        DB::table('americano_tournaments')->insert($this->tournamentRow(self::TOURNAMENT, 'playing'));
        DB::table('americano_teams')->insert([
            ['id' => 'team-a', 'tournament_id' => self::TOURNAMENT, 'display_name' => 'A'],
            ['id' => 'team-b', 'tournament_id' => self::TOURNAMENT, 'display_name' => 'B'],
        ]);
        DB::table('americano_matches')->insert([
            'id' => 'match-1',
            'tournament_id' => self::TOURNAMENT,
            'court_name' => 'Court 1',
            'round_number' => 1,
            'team_a_id' => 'team-a',
            'team_b_id' => 'team-b',
            'score_a' => null,
            'score_b' => null,
            'status' => 'pending',
            'created_at' => now(),
        ]);
    }

    private function tournamentRow(string $id, string $status, string $hostId = self::HOST, string $format = 'solo'): array
    {
        return [
            'id' => $id,
            'name' => 'T '.$id,
            'format' => $format,
            'host_id' => $hostId,
            'court_count' => 1,
            'scoring_system' => 'points',
            'status' => $status,
            'created_at' => now(),
        ];
    }

    private function requestFor(string $userId, array $body = []): Request
    {
        $request = Request::create('/api/v1/test', 'POST', $body);
        $user = new User;
        $user->forceFill(['id' => $userId]);
        $request->attributes->set('auth_user', $user);

        return $request;
    }

    private function expectApiStatus(int $status, callable $fn): void
    {
        try {
            $fn();
            $this->fail("Expected ApiException with status {$status}.");
        } catch (ApiException $exception) {
            $this->assertSame($status, $exception->getStatusCode());
        }
    }
}
