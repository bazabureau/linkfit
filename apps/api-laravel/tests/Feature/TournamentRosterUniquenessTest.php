<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\TournamentsController;
use App\Models\User;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Cross-squad roster uniqueness (TournamentsController::enter →
 * validatedPlayerIds): a user may not be rostered in two active squads of the
 * SAME tournament. A player already listed (as captain or player) in another
 * non-withdrawn entry is rejected (422); the captain's own entry is excluded so
 * re-submitting an unchanged roster on update is not a self-conflict.
 */
class TournamentRosterUniquenessTest extends TestCase
{
    private const CAP_A = '00000000-0000-4000-8000-00000000000a';

    private const CAP_B = '00000000-0000-4000-8000-00000000000b';

    private const SHARED = '00000000-0000-4000-8000-00000000000c';

    private const FRESH = '00000000-0000-4000-8000-00000000000d';

    private const SPORT = '44444444-4444-4444-8444-444444444444';

    private const TOURNAMENT = '11111111-1111-4111-8111-111111111111';

    private TournamentsController $controller;

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
            $table->string('photo_url')->nullable();
            $table->timestamp('deleted_at')->nullable();
            $table->timestamp('created_at')->nullable();
        });

        Schema::create('sports', function ($table): void {
            $table->string('id')->primary();
            $table->string('slug');
        });

        Schema::create('tournaments', function ($table): void {
            $table->string('id')->primary();
            $table->string('name');
            $table->string('description')->nullable();
            $table->string('sport_id');
            $table->string('venue_id')->nullable();
            $table->timestamp('starts_at')->nullable();
            $table->timestamp('ends_at')->nullable();
            $table->timestamp('registration_deadline')->nullable();
            $table->integer('max_squads')->default(8);
            $table->integer('squad_size')->default(3);
            $table->integer('entry_fee_minor')->default(0);
            $table->string('currency')->default('AZN');
            $table->string('status')->default('registration_open');
            $table->boolean('requires_waiver')->default(false);
            $table->timestamp('created_at')->nullable();
        });

        Schema::create('tournament_entries', function ($table): void {
            $table->string('id')->primary();
            $table->string('tournament_id');
            $table->string('captain_user_id');
            $table->string('squad_name');
            $table->text('player_ids')->nullable();
            $table->string('status')->default('pending');
            $table->timestamp('created_at')->nullable();
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

        Schema::create('notifications', function ($table): void {
            $table->string('id')->primary();
            $table->string('user_id');
            $table->string('type');
            $table->string('title');
            $table->text('body')->nullable();
            $table->text('payload')->nullable();
            $table->timestamp('created_at')->nullable();
        });

        DB::table('users')->insert([
            ['id' => self::CAP_A, 'display_name' => 'Captain A', 'created_at' => now()],
            ['id' => self::CAP_B, 'display_name' => 'Captain B', 'created_at' => now()],
            ['id' => self::SHARED, 'display_name' => 'Shared Player', 'created_at' => now()],
            ['id' => self::FRESH, 'display_name' => 'Fresh Player', 'created_at' => now()],
        ]);
        DB::table('sports')->insert(['id' => self::SPORT, 'slug' => 'padel']);
        DB::table('tournaments')->insert([
            'id' => self::TOURNAMENT,
            'name' => 'Padel Open',
            'sport_id' => self::SPORT,
            'starts_at' => now()->addDays(7),
            'ends_at' => now()->addDays(8),
            'registration_deadline' => now()->addDays(5),
            'max_squads' => 8,
            'squad_size' => 3,
            'status' => 'registration_open',
            'requires_waiver' => false,
            'created_at' => now(),
        ]);

        // Captain A's active entry already rosters the SHARED player.
        $this->controller = app(TournamentsController::class);
        $this->controller->enter(
            $this->requestFor(self::CAP_A, ['squad_name' => 'Alpha', 'player_ids' => [self::SHARED]]),
            self::TOURNAMENT,
        );
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('notifications');
        Schema::dropIfExists('audit_log');
        Schema::dropIfExists('tournament_entries');
        Schema::dropIfExists('tournaments');
        Schema::dropIfExists('sports');
        Schema::dropIfExists('users');

        parent::tearDown();
    }

    public function test_a_player_in_another_active_squad_cannot_be_rostered_again(): void
    {
        try {
            $this->controller->enter(
                $this->requestFor(self::CAP_B, ['squad_name' => 'Bravo', 'player_ids' => [self::SHARED]]),
                self::TOURNAMENT,
            );
            $this->fail('Expected rostering an already-registered player to be rejected.');
        } catch (ApiException $exception) {
            $this->assertSame(422, $exception->getStatusCode());
        }

        // Captain B's conflicting entry was not created.
        $this->assertSame(0, DB::table('tournament_entries')->where('captain_user_id', self::CAP_B)->count());
    }

    public function test_a_captain_of_another_active_squad_cannot_be_rostered_as_a_player(): void
    {
        // Captain A is themselves committed to the tournament as a captain, so
        // listing them as a player on another squad is also a duplicate.
        try {
            $this->controller->enter(
                $this->requestFor(self::CAP_B, ['squad_name' => 'Bravo', 'player_ids' => [self::CAP_A]]),
                self::TOURNAMENT,
            );
            $this->fail('Expected rostering another squad\'s captain to be rejected.');
        } catch (ApiException $exception) {
            $this->assertSame(422, $exception->getStatusCode());
        }
    }

    public function test_a_free_player_can_be_rostered(): void
    {
        $response = $this->controller->enter(
            $this->requestFor(self::CAP_B, ['squad_name' => 'Bravo', 'player_ids' => [self::FRESH]]),
            self::TOURNAMENT,
        );

        $this->assertSame(201, $response->getStatusCode());
        $this->assertContains(self::FRESH, $response->getData(true)['player_ids']);
    }

    public function test_captain_can_resubmit_their_own_unchanged_roster(): void
    {
        // Updating your own entry with the same player must NOT self-conflict
        // (the captain's own entry is excluded from the uniqueness scan).
        $response = $this->controller->enter(
            $this->requestFor(self::CAP_A, ['squad_name' => 'Alpha', 'player_ids' => [self::SHARED]]),
            self::TOURNAMENT,
        );

        $this->assertSame(201, $response->getStatusCode());
        $this->assertSame(1, DB::table('tournament_entries')->where('captain_user_id', self::CAP_A)->count());
    }

    private function requestFor(string $userId, array $body = []): Request
    {
        $request = Request::create('/api/v1/test', 'POST', $body);
        $user = new User;
        $user->forceFill(['id' => $userId, 'display_name' => 'User']);
        $request->attributes->set('auth_user', $user);

        return $request;
    }
}
