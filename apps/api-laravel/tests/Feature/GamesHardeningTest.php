<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\GamesController;
use App\Models\User;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Authorization + state-machine hardening for GamesController join/leave/cancel/
 * update/destroy. Mirrors GameResultAccessTest's sqlite-in-memory, direct-
 * controller pattern. We deliberately exercise the guard/throw paths and the
 * 204-returning paths (cancel/destroy) only — the showResponse() success paths
 * use Postgres-only SQL (earth_distance, ::int casts) that does not run on
 * sqlite.
 */
class GamesHardeningTest extends TestCase
{
    private const HOST = '00000000-0000-4000-8000-000000000001';
    private const PLAYER_ONE = '00000000-0000-4000-8000-000000000002';
    private const PLAYER_TWO = '00000000-0000-4000-8000-000000000003';
    private const OUTSIDER = '00000000-0000-4000-8000-000000000004';

    private GamesController $controller;

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
        DB::purge('sqlite');
        DB::reconnect('sqlite');

        Schema::create('users', function ($table): void {
            $table->string('id')->primary();
            $table->timestamp('created_at')->nullable();
        });

        Schema::create('games', function ($table): void {
            $table->string('id')->primary();
            $table->string('sport_id')->default('sport-padel');
            $table->string('host_user_id');
            $table->integer('capacity')->default(4);
            $table->string('status')->default('open');
            $table->string('visibility')->default('public');
            $table->timestamp('starts_at')->nullable();
            $table->integer('duration_minutes')->default(90);
            $table->integer('skill_min_elo')->nullable();
            $table->integer('skill_max_elo')->nullable();
            $table->text('notes')->nullable();
            $table->timestamp('deleted_at')->nullable();
            $table->timestamp('updated_at')->nullable();
        });

        Schema::create('game_participants', function ($table): void {
            $table->string('game_id');
            $table->string('user_id');
            $table->string('status')->default('confirmed');
            $table->timestamp('joined_at')->nullable();
            $table->timestamp('status_changed_at')->nullable();
            $table->primary(['game_id', 'user_id']);
        });

        Schema::create('match_scores', function ($table): void {
            $table->string('game_id')->primary();
            $table->string('status')->default('in_progress');
        });

        Schema::create('notifications', function ($table): void {
            $table->string('id')->primary();
            $table->string('user_id');
            $table->string('type');
            $table->string('title');
            $table->text('body');
            $table->text('payload')->nullable();
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
            'capacity' => 2,
            'status' => 'full',
            'visibility' => 'public',
            'starts_at' => now()->addDay(),
            'duration_minutes' => 90,
        ]);
        DB::table('game_participants')->insert([
            ['game_id' => 'game-one', 'user_id' => self::HOST, 'status' => 'confirmed', 'joined_at' => now(), 'status_changed_at' => now()],
            ['game_id' => 'game-one', 'user_id' => self::PLAYER_ONE, 'status' => 'confirmed', 'joined_at' => now(), 'status_changed_at' => now()],
        ]);

        $this->controller = app(GamesController::class);
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('notifications');
        Schema::dropIfExists('match_scores');
        Schema::dropIfExists('game_participants');
        Schema::dropIfExists('games');
        Schema::dropIfExists('users');

        parent::tearDown();
    }

    public function test_leave_rejects_non_participant_without_flipping_status_or_notifying(): void
    {
        try {
            $this->controller->leave($this->requestFor(self::OUTSIDER), 'game-one');
            $this->fail('Expected a non-participant leave to be rejected.');
        } catch (ApiException $e) {
            $this->assertSame(409, $e->getStatusCode());
        }

        // The full game must NOT have been downgraded to open by a non-participant.
        $this->assertSame('full', DB::table('games')->where('id', 'game-one')->value('status'));
        // And no bogus "Player left" notification was sent to the host.
        $this->assertSame(0, DB::table('notifications')->count());
    }

    public function test_leave_is_idempotent_for_already_left_player(): void
    {
        DB::table('game_participants')
            ->where('game_id', 'game-one')->where('user_id', self::PLAYER_ONE)
            ->update(['status' => 'cancelled']);
        DB::table('games')->where('id', 'game-one')->update(['status' => 'open']);

        // Already-cancelled participant leaving again is a no-op: it reaches the
        // showResponse() call (Postgres-only on sqlite) only after deciding NOT
        // to mutate, so we assert no extra notification was produced.
        try {
            $this->controller->leave($this->requestFor(self::PLAYER_ONE), 'game-one');
        } catch (\Throwable $e) {
            // showResponse() runs Postgres-only SQL under sqlite; ignore that.
        }

        $this->assertSame(0, DB::table('notifications')->count());
        $this->assertSame('cancelled', DB::table('game_participants')
            ->where('game_id', 'game-one')->where('user_id', self::PLAYER_ONE)->value('status'));
    }

    public function test_host_cannot_leave_own_game(): void
    {
        try {
            $this->controller->leave($this->requestFor(self::HOST), 'game-one');
            $this->fail('Expected host leave to be rejected.');
        } catch (ApiException $e) {
            $this->assertSame(422, $e->getStatusCode());
        }
    }

    public function test_leave_blocked_when_match_in_progress(): void
    {
        DB::table('match_scores')->insert(['game_id' => 'game-one', 'status' => 'in_progress']);

        try {
            $this->controller->leave($this->requestFor(self::PLAYER_ONE), 'game-one');
            $this->fail('Expected leave to be blocked for an in-progress match.');
        } catch (ApiException $e) {
            $this->assertSame(409, $e->getStatusCode());
        }
    }

    public function test_leave_missing_game_returns_404(): void
    {
        try {
            $this->controller->leave($this->requestFor(self::PLAYER_ONE), 'does-not-exist');
            $this->fail('Expected 404 for a missing game.');
        } catch (ApiException $e) {
            $this->assertSame(404, $e->getStatusCode());
        }
    }

    public function test_cancel_requires_host(): void
    {
        try {
            $this->controller->cancel($this->requestFor(self::PLAYER_ONE), 'game-one');
            $this->fail('Expected non-host cancel to be forbidden.');
        } catch (ApiException $e) {
            $this->assertSame(403, $e->getStatusCode());
        }

        $this->assertSame('full', DB::table('games')->where('id', 'game-one')->value('status'));
    }

    public function test_cancel_completed_game_is_blocked(): void
    {
        DB::table('games')->where('id', 'game-one')->update(['status' => 'completed']);

        try {
            $this->controller->cancel($this->requestFor(self::HOST), 'game-one');
            $this->fail('Expected cancelling a completed game to be blocked.');
        } catch (ApiException $e) {
            $this->assertSame(409, $e->getStatusCode());
        }

        // The completed status (and its locked result) must be preserved.
        $this->assertSame('completed', DB::table('games')->where('id', 'game-one')->value('status'));
    }

    public function test_host_cancel_marks_cancelled_and_notifies_only_other_players(): void
    {
        $response = $this->controller->cancel($this->requestFor(self::HOST), 'game-one');

        $this->assertSame(204, $response->getStatusCode());
        $this->assertSame('cancelled', DB::table('games')->where('id', 'game-one')->value('status'));
        // Exactly one confirmed non-host participant (PLAYER_ONE) is notified;
        // the host is never notified about their own cancellation.
        $this->assertSame(1, DB::table('notifications')->count());
        $this->assertSame(self::PLAYER_ONE, DB::table('notifications')->value('user_id'));
        $this->assertSame(0, DB::table('notifications')->where('user_id', self::HOST)->count());
    }

    public function test_update_requires_host(): void
    {
        try {
            $this->controller->update($this->requestFor(self::PLAYER_ONE, ['notes' => 'x']), 'game-one');
            $this->fail('Expected non-host update to be forbidden.');
        } catch (ApiException $e) {
            $this->assertSame(403, $e->getStatusCode());
        }
    }

    public function test_update_completed_game_is_blocked(): void
    {
        DB::table('games')->where('id', 'game-one')->update(['status' => 'completed']);

        try {
            $this->controller->update($this->requestFor(self::HOST, ['notes' => 'late edit']), 'game-one');
            $this->fail('Expected updating a completed game to be blocked.');
        } catch (ApiException $e) {
            $this->assertSame(409, $e->getStatusCode());
        }
    }

    public function test_update_rejects_past_start_time(): void
    {
        try {
            $this->controller->update(
                $this->requestFor(self::HOST, ['starts_at' => now()->subDay()->toIso8601String()]),
                'game-one',
            );
            $this->fail('Expected a past starts_at to be rejected.');
        } catch (ApiException $e) {
            $this->assertSame(422, $e->getStatusCode());
        }
    }

    public function test_update_rejects_inverted_elo_window(): void
    {
        try {
            $this->controller->update(
                $this->requestFor(self::HOST, ['skill_min_elo' => 2000, 'skill_max_elo' => 1000]),
                'game-one',
            );
            $this->fail('Expected an inverted ELO window to be rejected.');
        } catch (ApiException $e) {
            $this->assertSame(422, $e->getStatusCode());
        }
    }

    public function test_update_requires_at_least_one_field(): void
    {
        try {
            $this->controller->update($this->requestFor(self::HOST, []), 'game-one');
            $this->fail('Expected an empty update body to be rejected.');
        } catch (ApiException $e) {
            $this->assertSame(422, $e->getStatusCode());
        }
    }

    public function test_destroy_requires_host(): void
    {
        try {
            $this->controller->destroy($this->requestFor(self::PLAYER_ONE), 'game-one');
            $this->fail('Expected non-host destroy to be forbidden.');
        } catch (ApiException $e) {
            $this->assertSame(403, $e->getStatusCode());
        }

        $this->assertNull(DB::table('games')->where('id', 'game-one')->value('deleted_at'));
    }

    public function test_host_destroy_soft_deletes_game(): void
    {
        $response = $this->controller->destroy($this->requestFor(self::HOST), 'game-one');

        $this->assertSame(204, $response->getStatusCode());
        $this->assertNotNull(DB::table('games')->where('id', 'game-one')->value('deleted_at'));
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
