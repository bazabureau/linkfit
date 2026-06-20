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
            ['id' => 'host-user'],
            ['id' => 'player-one'],
            ['id' => 'player-two'],
        ]);
        DB::table('games')->insert([
            'id' => 'game-one',
            'sport_id' => 'sport-padel',
            'host_user_id' => 'host-user',
            'status' => 'open',
        ]);
        DB::table('game_participants')->insert([
            ['game_id' => 'game-one', 'user_id' => 'host-user', 'status' => 'confirmed', 'joined_at' => now(), 'status_changed_at' => now()],
            ['game_id' => 'game-one', 'user_id' => 'player-one', 'status' => 'confirmed', 'joined_at' => now(), 'status_changed_at' => now()],
            ['game_id' => 'game-one', 'user_id' => 'player-two', 'status' => 'confirmed', 'joined_at' => now(), 'status_changed_at' => now()],
        ]);
        DB::table('match_scores')->insert([
            'game_id' => 'game-one',
            'team_a_user_ids' => '{host-user,player-one}',
            'team_b_user_ids' => '{player-two}',
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

        $this->controller->reportResult($this->requestFor('player-one'), 'game-one');
    }

    public function test_host_can_grant_and_revoke_result_access_to_confirmed_player(): void
    {
        $granted = $this->controller->setResultAccess(
            $this->requestFor('host-user', ['can_report_result' => true]),
            'game-one',
            'player-one',
        );

        $this->assertSame(200, $granted->getStatusCode());
        $this->assertTrue((bool) DB::table('game_participants')->where('user_id', 'player-one')->value('can_report_result'));

        $revoked = $this->controller->setResultAccess(
            $this->requestFor('host-user', ['can_report_result' => false]),
            'game-one',
            'player-one',
        );

        $this->assertSame(200, $revoked->getStatusCode());
        $this->assertFalse((bool) DB::table('game_participants')->where('user_id', 'player-one')->value('can_report_result'));
    }

    public function test_non_host_cannot_manage_result_access(): void
    {
        $this->expectException(ApiException::class);
        $this->expectExceptionMessage('Only the host can manage result access');

        $this->controller->setResultAccess(
            $this->requestFor('player-one', ['can_report_result' => true]),
            'game-one',
            'player-two',
        );
    }

    public function test_delegated_player_can_update_live_scoring_but_other_players_cannot(): void
    {
        try {
            $this->controller->point($this->requestFor('player-two', ['team' => 'a']), 'game-one');
            $this->fail('Expected non-delegated player to be forbidden.');
        } catch (ApiException $exception) {
            $this->assertSame(403, $exception->getStatusCode());
        }

        DB::table('game_participants')
            ->where('game_id', 'game-one')
            ->where('user_id', 'player-one')
            ->update(['can_report_result' => true]);

        $response = $this->controller->point($this->requestFor('player-one', ['team' => 'a']), 'game-one');

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame(['a'], json_decode((string) DB::table('match_scores')->where('game_id', 'game-one')->value('points'), true));
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
