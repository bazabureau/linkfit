<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\SeriesController;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * SeriesController::store materialization (the dead-feature fix): creating a
 * series must INSERT one real playable games row per scheduled occurrence
 * (series_id + sequential occurrence_number), with the slot resolved in
 * Asia/Baku then stored as UTC, so the normal /games endpoints + show()/cancel()
 * reflect the actual occurrences.
 *
 * store() runs the Postgres-only pending-result guard (interval/now() SQL that
 * cannot execute on sqlite), so — like the rest of the sqlite harness — the test
 * controller overrides that one guard to a no-op. Everything else (validation,
 * the transaction, the games INSERTs, seriesPayload) runs for real.
 */
class SeriesMaterializationTest extends TestCase
{
    private const HOST = '00000000-0000-4000-8000-000000000001';

    private const SPORT = '44444444-4444-4444-8444-444444444444';

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

        // Full games shape the materialization writes (mirrors the production
        // columns SeriesController::store fills).
        Schema::create('games', function ($table): void {
            $table->string('id')->primary();
            $table->string('sport_id');
            $table->string('court_id')->nullable();
            $table->string('host_user_id');
            $table->float('lat');
            $table->float('lng');
            $table->timestamp('starts_at')->nullable();
            $table->integer('duration_minutes');
            $table->integer('capacity');
            $table->string('visibility')->default('public');
            $table->string('match_type')->default('casual');
            $table->string('status')->default('open');
            $table->text('notes')->nullable();
            $table->string('series_id')->nullable();
            $table->integer('occurrence_number')->nullable();
            $table->timestamp('created_at')->nullable();
            $table->timestamp('updated_at')->nullable();
        });

        Schema::create('game_participants', function ($table): void {
            $table->string('game_id');
            $table->string('user_id');
            $table->string('status')->default('confirmed');
        });

        DB::table('users')->insert([
            'id' => self::HOST, 'display_name' => 'Host', 'created_at' => now(),
        ]);
        DB::table('sports')->insert(['id' => self::SPORT, 'slug' => 'padel']);

        // The real pending-result guard runs Postgres-only interval SQL; no-op it
        // for the sqlite harness so store()'s materialization can be exercised.
        $this->controller = new class extends SeriesController
        {
            protected function ensureNoPendingGameResult(string $userId): void {}
        };
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

    public function test_store_materializes_one_game_per_weekly_occurrence(): void
    {
        // A weekly slot two days out, four occurrences, comfortably inside the
        // window — so exactly four games should be created.
        $start = CarbonImmutable::now('Asia/Baku')->addDays(2)->startOfDay();
        $dow = $start->dayOfWeek;

        $response = $this->controller->store($this->requestFor(self::HOST, [
            'sport_id' => self::SPORT,
            'lat' => 40.4,
            'lng' => 49.8,
            'day_of_week' => $dow,
            'time_of_day' => '18:00',
            'duration_minutes' => 90,
            'capacity' => 4,
            'occurrences' => 4,
            'starts_on' => $start->toDateString(),
            'ends_on' => $start->addWeeks(8)->toDateString(),
        ]));
        $payload = $response->getData(true);

        $this->assertSame(201, $response->getStatusCode());

        $games = DB::table('games')->where('series_id', $payload['id'])->orderBy('occurrence_number')->get();
        $this->assertCount(4, $games);
        // The payload reflects the real occurrences too.
        $this->assertCount(4, $payload['games']);

        foreach ($games as $i => $game) {
            // Sequential occurrence numbering, host = creator, copied template cols.
            $this->assertSame($i + 1, (int) $game->occurrence_number);
            $this->assertSame(self::HOST, (string) $game->host_user_id);
            $this->assertSame(self::SPORT, (string) $game->sport_id);
            $this->assertSame(4, (int) $game->capacity);
            $this->assertSame(90, (int) $game->duration_minutes);
            $this->assertSame('open', $game->status);
            $this->assertSame('public', $game->visibility);

            // Slot resolved in Asia/Baku (18:00 on the requested weekday), stored
            // as UTC (Baku is UTC+4 → 14:00Z).
            $stored = CarbonImmutable::parse($game->starts_at, 'UTC');
            $this->assertSame('14:00', $stored->format('H:i'), 'stored instant is UTC (18:00 Baku → 14:00Z)');
            $baku = $stored->setTimezone('Asia/Baku');
            $this->assertSame('18:00', $baku->format('H:i'));
            $this->assertSame($dow, $baku->dayOfWeek);
            // One week apart: occurrence i lands on starts_on + i weeks.
            $this->assertSame($start->addWeeks($i)->toDateString(), $baku->toDateString());
        }
    }

    public function test_materialization_is_truncated_by_ends_on(): void
    {
        // Ten requested occurrences but a two-week window: only the slots that
        // fall on/before ends_on (weeks 0,1,2) are materialized.
        $start = CarbonImmutable::now('Asia/Baku')->addDays(2)->startOfDay();

        $response = $this->controller->store($this->requestFor(self::HOST, [
            'sport_id' => self::SPORT,
            'lat' => 40.4,
            'lng' => 49.8,
            'day_of_week' => $start->dayOfWeek,
            'time_of_day' => '09:30',
            'duration_minutes' => 60,
            'capacity' => 2,
            'occurrences' => 10,
            'starts_on' => $start->toDateString(),
            'ends_on' => $start->addWeeks(2)->toDateString(),
        ]));
        $payload = $response->getData(true);

        $this->assertSame(201, $response->getStatusCode());
        $this->assertSame(3, DB::table('games')->where('series_id', $payload['id'])->count());
    }

    public function test_cancel_after_store_flips_the_materialized_future_games(): void
    {
        $start = CarbonImmutable::now('Asia/Baku')->addDays(2)->startOfDay();
        $created = $this->controller->store($this->requestFor(self::HOST, [
            'sport_id' => self::SPORT,
            'lat' => 40.4,
            'lng' => 49.8,
            'day_of_week' => $start->dayOfWeek,
            'time_of_day' => '18:00',
            'duration_minutes' => 90,
            'capacity' => 4,
            'occurrences' => 3,
            'starts_on' => $start->toDateString(),
            'ends_on' => $start->addWeeks(8)->toDateString(),
        ]))->getData(true);

        $cancelled = $this->controller->cancel($this->requestFor(self::HOST), $created['id'])->getData(true);

        // All three materialized occurrences are in the future → all cancelled.
        $this->assertSame(3, $cancelled['cancelled_count']);
        $this->assertSame('cancelled', DB::table('game_series')->where('id', $created['id'])->value('status'));
        $this->assertSame(0, DB::table('games')->where('series_id', $created['id'])->where('status', '!=', 'cancelled')->count());
    }

    private function requestFor(string $userId, array $body = []): Request
    {
        $request = Request::create('/api/v1/test', 'POST', $body);
        $user = new User;
        $user->forceFill(['id' => $userId, 'display_name' => 'Host']);
        $request->attributes->set('auth_user', $user);

        return $request;
    }
}
