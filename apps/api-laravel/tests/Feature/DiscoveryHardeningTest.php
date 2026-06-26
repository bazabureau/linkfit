<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\DiscoveryController;
use App\Models\User;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Hardening coverage for the discovery slice (agenda / activity / challenges).
 *
 * Drives the controller directly with a synthetic Request whose `auth_user`
 * attribute is set (mirrors SocialBlockEnforcementTest), exercising the
 * in-controller authorization + validation without the JWT/HTTP stack. The
 * schema is the minimal set of tables each query touches; methods that rely on
 * Postgres-only operators (uuid[] @>, distinct on) are intentionally not
 * exercised under the in-memory SQLite DB.
 */
class DiscoveryHardeningTest extends TestCase
{
    private const ALICE = '00000000-0000-4000-8000-0000000000a1';

    private const BOB = '00000000-0000-4000-8000-0000000000b2';

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
        config()->set('broadcasting.default', 'log');
        DB::purge('sqlite');
        DB::reconnect('sqlite');

        Schema::create('users', function ($table): void {
            $table->string('id')->primary();
            $table->string('display_name')->nullable();
            $table->timestamp('deleted_at')->nullable();
        });
        Schema::create('sports', function ($table): void {
            $table->string('id')->primary();
            $table->string('slug')->unique();
        });
        Schema::create('venues', function ($table): void {
            $table->string('id')->primary();
            $table->string('name');
        });
        Schema::create('courts', function ($table): void {
            $table->string('id')->primary();
            $table->string('name')->nullable();
            $table->string('venue_id')->nullable();
            $table->string('sport_id')->nullable();
        });
        Schema::create('games', function ($table): void {
            $table->string('id')->primary();
            $table->string('sport_id');
            $table->string('court_id')->nullable();
            $table->string('status')->nullable();
            $table->integer('duration_minutes')->default(60);
            $table->integer('capacity')->default(4);
            $table->timestamp('starts_at')->nullable();
            $table->timestamp('deleted_at')->nullable();
        });
        Schema::create('game_participants', function ($table): void {
            $table->string('game_id');
            $table->string('user_id');
            $table->string('status')->nullable();
            $table->primary(['game_id', 'user_id']);
        });
        Schema::create('bookings', function ($table): void {
            $table->string('id')->primary();
            $table->string('user_id');
            $table->string('court_id')->nullable();
            $table->string('status')->nullable();
            $table->integer('duration_minutes')->default(60);
            $table->integer('total_minor')->default(0);
            $table->string('currency')->default('AZN');
            $table->timestamp('starts_at')->nullable();
        });
        Schema::create('user_challenges', function ($table): void {
            $table->string('user_id');
            $table->string('challenge_code');
            $table->string('date');
            $table->timestamp('completed_at')->nullable();
            $table->timestamp('created_at')->nullable();
            $table->primary(['user_id', 'challenge_code', 'date']);
        });

        DB::table('users')->insert([
            ['id' => self::ALICE, 'display_name' => 'Alice'],
            ['id' => self::BOB, 'display_name' => 'Bob'],
        ]);
        DB::table('sports')->insert(['id' => 'sport-padel', 'slug' => 'padel']);
        DB::table('venues')->insert(['id' => 'venue-1', 'name' => 'Central Court']);
        DB::table('courts')->insert([
            'id' => 'court-1', 'name' => 'Court 1', 'venue_id' => 'venue-1', 'sport_id' => 'sport-padel',
        ]);
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('user_challenges');
        Schema::dropIfExists('bookings');
        Schema::dropIfExists('game_participants');
        Schema::dropIfExists('games');
        Schema::dropIfExists('courts');
        Schema::dropIfExists('venues');
        Schema::dropIfExists('sports');
        Schema::dropIfExists('users');

        parent::tearDown();
    }

    public function test_agenda_returns_only_the_viewers_own_games_and_bookings(): void
    {
        // Alice's upcoming game (confirmed participant) + booking.
        DB::table('games')->insert([
            'id' => 'game-alice', 'sport_id' => 'sport-padel', 'court_id' => 'court-1',
            'status' => 'open', 'starts_at' => now()->addDay()->toDateTimeString(),
        ]);
        DB::table('game_participants')->insert([
            'game_id' => 'game-alice', 'user_id' => self::ALICE, 'status' => 'confirmed',
        ]);
        DB::table('bookings')->insert([
            'id' => 'booking-alice', 'user_id' => self::ALICE, 'court_id' => 'court-1',
            'status' => 'confirmed', 'starts_at' => now()->addDay()->toDateTimeString(),
        ]);

        // Bob's parallel game + booking — must never appear in Alice's agenda.
        DB::table('games')->insert([
            'id' => 'game-bob', 'sport_id' => 'sport-padel', 'court_id' => 'court-1',
            'status' => 'open', 'starts_at' => now()->addDay()->toDateTimeString(),
        ]);
        DB::table('game_participants')->insert([
            'game_id' => 'game-bob', 'user_id' => self::BOB, 'status' => 'confirmed',
        ]);
        DB::table('bookings')->insert([
            'id' => 'booking-bob', 'user_id' => self::BOB, 'court_id' => 'court-1',
            'status' => 'confirmed', 'starts_at' => now()->addDay()->toDateTimeString(),
        ]);

        $data = app(DiscoveryController::class)
            ->agenda($this->request(self::ALICE, '/api/v1/me/agenda'))
            ->getData(true);

        $this->assertCount(1, $data['games']);
        $this->assertSame('game-alice', $data['games'][0]['id']);
        $this->assertCount(1, $data['bookings']);
        $this->assertSame('booking-alice', $data['bookings'][0]['id']);
        // The normalized stream is the union of the two, still scoped to Alice.
        $this->assertCount(2, $data['items']);
    }

    public function test_activity_scopes_bookings_to_the_viewer(): void
    {
        DB::table('bookings')->insert([
            'id' => 'booking-alice', 'user_id' => self::ALICE, 'court_id' => 'court-1',
            'status' => 'confirmed', 'total_minor' => 5000, 'currency' => 'AZN',
            'starts_at' => now()->subDay()->toDateTimeString(),
        ]);
        DB::table('bookings')->insert([
            'id' => 'booking-bob', 'user_id' => self::BOB, 'court_id' => 'court-1',
            'status' => 'confirmed', 'total_minor' => 9000, 'currency' => 'AZN',
            'starts_at' => now()->subDay()->toDateTimeString(),
        ]);

        $data = app(DiscoveryController::class)
            ->activity($this->request(self::ALICE, '/api/v1/me/activity', ['type' => 'booking']))
            ->getData(true);

        $this->assertSame(1, $data['pagination']['total']);
        $this->assertCount(1, $data['items']);
        $this->assertSame('booking:booking-alice', $data['items'][0]['id']);
        $this->assertSame(1, $data['summary']['bookings']);
    }

    public function test_activity_rejects_invalid_type_filter(): void
    {
        $this->expectException(ApiException::class);

        app(DiscoveryController::class)
            ->activity($this->request(self::ALICE, '/api/v1/me/activity', ['type' => 'bogus']));
    }

    public function test_challenges_seeds_todays_set_uncompleted(): void
    {
        $data = app(DiscoveryController::class)
            ->challenges($this->request(self::ALICE, '/api/v1/me/challenges/today'))
            ->getData(true);

        $this->assertCount(3, $data['items']);
        foreach ($data['items'] as $item) {
            $this->assertNull($item['completed_at']);
            $this->assertSame(self::ALICE, $item['user_id']);
        }
    }

    public function test_check_challenge_completes_only_the_named_code(): void
    {
        app(DiscoveryController::class)
            ->challenges($this->request(self::ALICE, '/api/v1/me/challenges/today'));

        $response = app(DiscoveryController::class)
            ->checkChallenge($this->request(self::ALICE, '/api/v1/me/challenges/follow_one/check', [], 'POST'), 'follow_one');

        $this->assertSame(200, $response->getStatusCode());
        $this->assertTrue($response->getData(true)['ok']);

        $today = now()->toDateString();
        $this->assertNotNull(
            DB::table('user_challenges')->where('user_id', self::ALICE)
                ->where('challenge_code', 'follow_one')->where('date', $today)->value('completed_at')
        );
        // Sibling challenges remain untouched.
        $this->assertSame(1, DB::table('user_challenges')->where('user_id', self::ALICE)
            ->where('date', $today)->whereNotNull('completed_at')->count());
    }

    public function test_check_challenge_rejects_unknown_code(): void
    {
        app(DiscoveryController::class)
            ->challenges($this->request(self::ALICE, '/api/v1/me/challenges/today'));

        try {
            app(DiscoveryController::class)
                ->checkChallenge($this->request(self::ALICE, '/api/v1/me/challenges/drop_table/check', [], 'POST'), 'drop_table');
            $this->fail('Expected ApiException for an unknown challenge code.');
        } catch (ApiException $e) {
            $this->assertSame(422, $e->getStatusCode());
        }

        // Nothing was marked complete by the invalid request.
        $this->assertSame(0, DB::table('user_challenges')->where('user_id', self::ALICE)
            ->whereNotNull('completed_at')->count());
    }

    private function request(string $userId, string $uri, array $params = [], string $method = 'GET'): Request
    {
        $request = Request::create($uri, $method, $params);
        $user = new User;
        $user->forceFill(['id' => $userId]);
        $request->attributes->set('auth_user', $user);

        return $request;
    }
}
