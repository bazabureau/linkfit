<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\MatchController;
use App\Models\User;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class GameResultAccessTest extends TestCase
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

    public function test_confirmed_participant_without_result_access_cannot_report_result(): void
    {
        $this->expectException(ApiException::class);
        $this->expectExceptionMessage('Only the host or a player with result access can record the result');

        $this->controller->reportResult($this->requestFor(self::PLAYER_ONE), 'game-one');
    }

    public function test_host_can_grant_and_revoke_result_access_to_confirmed_player(): void
    {
        $granted = $this->controller->setResultAccess(
            $this->requestFor(self::HOST, ['can_report_result' => true]),
            'game-one',
            self::PLAYER_ONE,
        );

        $this->assertSame(200, $granted->getStatusCode());
        $this->assertTrue((bool) DB::table('game_participants')->where('user_id', self::PLAYER_ONE)->value('can_report_result'));

        $revoked = $this->controller->setResultAccess(
            $this->requestFor(self::HOST, ['can_report_result' => false]),
            'game-one',
            self::PLAYER_ONE,
        );

        $this->assertSame(200, $revoked->getStatusCode());
        $this->assertFalse((bool) DB::table('game_participants')->where('user_id', self::PLAYER_ONE)->value('can_report_result'));
    }

    public function test_non_host_cannot_manage_result_access(): void
    {
        $this->expectException(ApiException::class);
        $this->expectExceptionMessage('Only the host can manage result access');

        $this->controller->setResultAccess(
            $this->requestFor(self::PLAYER_ONE, ['can_report_result' => true]),
            'game-one',
            self::PLAYER_TWO,
        );
    }

    public function test_delegated_player_can_update_live_scoring_but_other_players_cannot(): void
    {
        try {
            $this->controller->point($this->requestFor(self::PLAYER_TWO, ['team' => 'a']), 'game-one');
            $this->fail('Expected non-delegated player to be forbidden.');
        } catch (ApiException $exception) {
            $this->assertSame(403, $exception->getStatusCode());
        }

        DB::table('game_participants')
            ->where('game_id', 'game-one')
            ->where('user_id', self::PLAYER_ONE)
            ->update(['can_report_result' => true]);

        $response = $this->controller->point($this->requestFor(self::PLAYER_ONE, ['team' => 'a']), 'game-one');

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame(['a'], json_decode((string) DB::table('match_scores')->where('game_id', 'game-one')->value('points'), true));
    }

    public function test_delegated_player_can_report_final_result(): void
    {
        DB::table('game_participants')
            ->where('game_id', 'game-one')
            ->where('user_id', self::PLAYER_ONE)
            ->update(['can_report_result' => true]);

        DB::table('match_scores')->where('game_id', 'game-one')->delete();

        $response = $this->controller->reportResult($this->requestFor(self::PLAYER_ONE, $this->resultPayload()), 'game-one');
        $payload = $response->getData(true);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame('completed', $payload['status']);
        $this->assertSame('a', $payload['winning_team']);
        $this->assertSame('completed', DB::table('games')->where('id', 'game-one')->value('status'));
        $this->assertSame(1, (int) DB::table('player_sport_stats')->where('user_id', self::PLAYER_ONE)->value('games_won'));
    }

    public function test_revoked_player_cannot_report_final_result(): void
    {
        DB::table('game_participants')
            ->where('game_id', 'game-one')
            ->where('user_id', self::PLAYER_ONE)
            ->update(['can_report_result' => false]);

        DB::table('match_scores')->where('game_id', 'game-one')->delete();

        $this->expectException(ApiException::class);
        $this->expectExceptionMessage('Only the host or a player with result access can record the result');

        $this->controller->reportResult($this->requestFor(self::PLAYER_ONE, $this->resultPayload()), 'game-one');
    }

    public function test_reporting_a_single_undecided_set_is_rejected_without_applying_elo(): void
    {
        DB::table('match_scores')->where('game_id', 'game-one')->delete();

        // One set 6-3: a winner of a single set has NOT clinched a best-of-N, so
        // the result is undecided and must be rejected before any ELO swing.
        try {
            $this->controller->reportResult($this->requestFor(self::HOST, [
                'team_a_user_ids' => [self::HOST, self::PLAYER_ONE],
                'team_b_user_ids' => [self::PLAYER_TWO],
                'sets' => [['a' => 6, 'b' => 3]],
            ]), 'game-one');
            $this->fail('Expected an undecided single-set result to be rejected.');
        } catch (ApiException $exception) {
            $this->assertSame(422, $exception->getStatusCode());
        }

        // No stats/ELO written and the game stays open (no recorded result).
        $this->assertSame(0, DB::table('player_sport_stats')->count());
        $this->assertSame('open', DB::table('games')->where('id', 'game-one')->value('status'));
        $this->assertSame(0, DB::table('match_scores')->where('game_id', 'game-one')->where('status', 'completed')->count());
    }

    public function test_reporting_a_one_one_set_split_is_rejected(): void
    {
        DB::table('match_scores')->where('game_id', 'game-one')->delete();

        // 6-3, 3-6 → one set each, nobody took the majority: undecided.
        try {
            $this->controller->reportResult($this->requestFor(self::HOST, [
                'team_a_user_ids' => [self::HOST, self::PLAYER_ONE],
                'team_b_user_ids' => [self::PLAYER_TWO],
                'sets' => [['a' => 6, 'b' => 3], ['a' => 3, 'b' => 6]],
            ]), 'game-one');
            $this->fail('Expected a 1-1 set split to be rejected as undecided.');
        } catch (ApiException $exception) {
            $this->assertSame(422, $exception->getStatusCode());
        }

        $this->assertSame(0, DB::table('player_sport_stats')->count());
        $this->assertSame('open', DB::table('games')->where('id', 'game-one')->value('status'));
    }

    private function resultPayload(): array
    {
        return [
            'team_a_user_ids' => [self::HOST, self::PLAYER_ONE],
            'team_b_user_ids' => [self::PLAYER_TWO],
            'sets' => [
                ['a' => 6, 'b' => 3],
                ['a' => 6, 'b' => 4],
            ],
        ];
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
