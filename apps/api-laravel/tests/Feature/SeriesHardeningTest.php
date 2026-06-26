<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\SeriesController;
use App\Models\User;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Hardening coverage for SeriesController show / cancel. Mirrors the project's
 * sqlite-in-memory, direct-controller harness (see GamesHardeningTest). store()
 * is intentionally not exercised here: like GamesController::store it runs the
 * Postgres-only pending-result guard (interval / now() SQL) that cannot execute
 * on sqlite. The security-critical surface is the read/cancel authorization:
 *  - show() is host-or-confirmed-participant gated, returning 404 otherwise;
 *  - cancel() is host-only (403 otherwise) and only flips FUTURE occurrences.
 */
class SeriesHardeningTest extends TestCase
{
    private const HOST = '00000000-0000-4000-8000-000000000001';

    private const PARTICIPANT = '00000000-0000-4000-8000-000000000002';

    private const STRANGER = '00000000-0000-4000-8000-000000000003';

    private const SPORT = '44444444-4444-4444-8444-444444444444';

    private const SERIES = '22222222-2222-4222-8222-222222222222';

    private SeriesController $controller;

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

        Schema::create('sports', function ($table): void {
            $table->string('id')->primary();
            $table->string('slug');
        });

        Schema::create('venues', function ($table): void {
            $table->string('id')->primary();
            $table->string('name');
        });

        Schema::create('courts', function ($table): void {
            $table->string('id')->primary();
            $table->string('venue_id')->nullable();
        });

        Schema::create('game_series', function ($table): void {
            $table->string('id')->primary();
            $table->string('host_user_id');
            $table->string('sport_id');
            $table->string('court_id')->nullable();
            $table->float('lat');
            $table->float('lng');
            $table->integer('day_of_week');
            $table->string('time_of_day');
            $table->integer('duration_minutes');
            $table->integer('capacity');
            $table->integer('occurrences')->default(1);
            $table->string('starts_on');
            $table->string('ends_on');
            $table->string('status')->default('active');
            $table->text('notes')->nullable();
            $table->timestamp('created_at')->nullable();
        });

        Schema::create('games', function ($table): void {
            $table->string('id')->primary();
            $table->string('series_id')->nullable();
            $table->integer('occurrence_number')->default(1);
            $table->timestamp('starts_at')->nullable();
            $table->string('status')->default('open');
            $table->integer('capacity')->default(4);
            $table->timestamp('updated_at')->nullable();
        });

        Schema::create('game_participants', function ($table): void {
            $table->string('game_id');
            $table->string('user_id');
            $table->string('status')->default('confirmed');
        });

        DB::table('users')->insert([
            ['id' => self::HOST, 'display_name' => 'Host', 'created_at' => now()],
            ['id' => self::PARTICIPANT, 'display_name' => 'Participant', 'created_at' => now()],
            ['id' => self::STRANGER, 'display_name' => 'Stranger', 'created_at' => now()],
        ]);
        DB::table('sports')->insert(['id' => self::SPORT, 'slug' => 'padel']);

        $this->controller = app(SeriesController::class);
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('game_participants');
        Schema::dropIfExists('games');
        Schema::dropIfExists('game_series');
        Schema::dropIfExists('courts');
        Schema::dropIfExists('venues');
        Schema::dropIfExists('sports');
        Schema::dropIfExists('users');

        parent::tearDown();
    }

    public function test_host_can_view_series_with_games(): void
    {
        $this->seedSeries();
        $this->seedGame('game-future', 1, now()->addDays(1));

        $payload = $this->controller->show($this->requestFor(self::HOST), self::SERIES)->getData(true);

        $this->assertSame(self::SERIES, $payload['id']);
        $this->assertSame(self::HOST, $payload['host_user_id']);
        $this->assertSame('padel', $payload['sport_slug']);
        $this->assertCount(1, $payload['games']);
        $this->assertSame('game-future', $payload['games'][0]['id']);
    }

    public function test_confirmed_participant_can_view_series(): void
    {
        $this->seedSeries();
        $this->seedGame('game-future', 1, now()->addDays(1));
        DB::table('game_participants')->insert([
            'game_id' => 'game-future',
            'user_id' => self::PARTICIPANT,
            'status' => 'confirmed',
        ]);

        $payload = $this->controller->show($this->requestFor(self::PARTICIPANT), self::SERIES)->getData(true);

        $this->assertSame(self::SERIES, $payload['id']);
        $this->assertSame(1, $payload['games'][0]['participants_count']);
    }

    public function test_stranger_cannot_view_series(): void
    {
        $this->seedSeries();
        $this->seedGame('game-future', 1, now()->addDays(1));
        // A non-confirmed (invited) participant must not satisfy the gate.
        DB::table('game_participants')->insert([
            'game_id' => 'game-future',
            'user_id' => self::STRANGER,
            'status' => 'invited',
        ]);

        try {
            $this->controller->show($this->requestFor(self::STRANGER), self::SERIES);
            $this->fail('Expected a stranger to be denied (404).');
        } catch (ApiException $e) {
            // 404, not 403 — never confirm existence of someone else's series.
            $this->assertSame(404, $e->getStatusCode());
        }
    }

    public function test_show_missing_series_is_404(): void
    {
        try {
            $this->controller->show($this->requestFor(self::HOST), self::SERIES);
            $this->fail('Expected a 404 for an unknown series.');
        } catch (ApiException $e) {
            $this->assertSame(404, $e->getStatusCode());
        }
    }

    public function test_cancel_requires_host(): void
    {
        $this->seedSeries();

        try {
            $this->controller->cancel($this->requestFor(self::STRANGER), self::SERIES);
            $this->fail('Expected a non-host cancel to be forbidden.');
        } catch (ApiException $e) {
            $this->assertSame(403, $e->getStatusCode());
        }

        $this->assertSame('active', DB::table('game_series')->where('id', self::SERIES)->value('status'));
    }

    public function test_host_cancel_flips_series_and_only_future_games(): void
    {
        $this->seedSeries();
        $this->seedGame('game-past', 1, now()->subDays(2));
        $this->seedGame('game-future', 2, now()->addDays(2));

        $response = $this->controller->cancel($this->requestFor(self::HOST), self::SERIES);
        $payload = $response->getData(true);

        $this->assertSame(1, $payload['cancelled_count']);
        $this->assertSame('cancelled', DB::table('game_series')->where('id', self::SERIES)->value('status'));
        $this->assertSame('cancelled', DB::table('games')->where('id', 'game-future')->value('status'));
        // The already-played occurrence must be left untouched.
        $this->assertSame('open', DB::table('games')->where('id', 'game-past')->value('status'));
    }

    public function test_cancel_missing_series_is_404(): void
    {
        try {
            $this->controller->cancel($this->requestFor(self::HOST), self::SERIES);
            $this->fail('Expected a 404 for an unknown series.');
        } catch (ApiException $e) {
            $this->assertSame(404, $e->getStatusCode());
        }
    }

    private function seedSeries(array $overrides = []): void
    {
        DB::table('game_series')->insert(array_merge([
            'id' => self::SERIES,
            'host_user_id' => self::HOST,
            'sport_id' => self::SPORT,
            'court_id' => null,
            'lat' => 40.4,
            'lng' => 49.8,
            'day_of_week' => 1,
            'time_of_day' => '18:00:00',
            'duration_minutes' => 90,
            'capacity' => 4,
            'occurrences' => 4,
            'starts_on' => now()->toDateString(),
            'ends_on' => now()->addWeeks(4)->toDateString(),
            'status' => 'active',
            'notes' => null,
            'created_at' => now(),
        ], $overrides));
    }

    private function seedGame(string $id, int $occurrence, \Carbon\Carbon $startsAt): void
    {
        DB::table('games')->insert([
            'id' => $id,
            'series_id' => self::SERIES,
            'occurrence_number' => $occurrence,
            'starts_at' => $startsAt,
            'status' => 'open',
            'capacity' => 4,
            'updated_at' => now(),
        ]);
    }

    private function requestFor(string $userId): Request
    {
        $request = Request::create('/api/v1/test', 'POST');
        $user = new User;
        $user->forceFill(['id' => $userId, 'display_name' => 'User']);
        $request->attributes->set('auth_user', $user);

        return $request;
    }
}
