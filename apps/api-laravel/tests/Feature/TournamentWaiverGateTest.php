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
 * Tournament waiver gate (TournamentsController::enter).
 *
 * A tournament flagged `requires_waiver = true` may only be entered by a captain
 * who has already signed the medical waiver for that tournament (a
 * tournament_waivers row keyed by tournament_id + user_id, written by
 * MedicalController::signWaiver). The flag defaults to false, so the gate is a
 * no-op for every existing tournament. Guards verified:
 *  - requires_waiver=true with no signed waiver → rejected (409);
 *  - requires_waiver=true after a waiver row exists → entry succeeds;
 *  - requires_waiver=false → entry succeeds without any waiver.
 */
class TournamentWaiverGateTest extends TestCase
{
    private const CAPTAIN = '00000000-0000-4000-8000-000000000001';

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
            $table->integer('squad_size')->default(2);
            $table->integer('entry_fee_minor')->default(0);
            $table->string('currency')->default('AZN');
            $table->string('status')->default('registration_open');
            // The column added by 2026_06_22_000003_add_requires_waiver_to_tournaments.
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

        Schema::create('tournament_waivers', function ($table): void {
            $table->string('tournament_id');
            $table->string('user_id');
            $table->timestamp('signed_at')->nullable();
            $table->string('ip')->nullable();
            $table->string('user_agent')->nullable();
        });

        // enter() audits every write; the notification enqueue (post-transaction)
        // is try/catch-wrapped but we provide the table so it stays a clean no-op.
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
            'id' => self::CAPTAIN,
            'display_name' => 'Captain',
            'created_at' => now(),
        ]);
        DB::table('sports')->insert([
            'id' => self::SPORT,
            'slug' => 'padel',
        ]);

        $this->controller = app(TournamentsController::class);
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('notifications');
        Schema::dropIfExists('audit_log');
        Schema::dropIfExists('tournament_waivers');
        Schema::dropIfExists('tournament_entries');
        Schema::dropIfExists('tournaments');
        Schema::dropIfExists('sports');
        Schema::dropIfExists('users');

        parent::tearDown();
    }

    public function test_entering_a_waiver_tournament_without_a_signed_waiver_is_rejected(): void
    {
        $this->seedTournament(requiresWaiver: true);

        try {
            $this->controller->enter($this->requestFor(self::CAPTAIN), self::TOURNAMENT);
            $this->fail('Expected entering a waiver-gated tournament without a waiver to be rejected.');
        } catch (ApiException $exception) {
            $this->assertSame(409, $exception->getStatusCode());
            $this->assertSame('Waiver must be signed before entering', $exception->getMessage());
        }

        // The rejected attempt must not have created an entry.
        $this->assertSame(0, DB::table('tournament_entries')->where('tournament_id', self::TOURNAMENT)->count());
    }

    public function test_entering_a_waiver_tournament_succeeds_after_the_waiver_is_signed(): void
    {
        $this->seedTournament(requiresWaiver: true);
        DB::table('tournament_waivers')->insert([
            'tournament_id' => self::TOURNAMENT,
            'user_id' => self::CAPTAIN,
            'signed_at' => now(),
        ]);

        $response = $this->controller->enter($this->requestFor(self::CAPTAIN), self::TOURNAMENT);
        $payload = $response->getData(true);

        $this->assertSame(201, $response->getStatusCode());
        $this->assertSame(self::CAPTAIN, $payload['captain_user_id']);
        $this->assertSame('pending', $payload['status']);
        $this->assertSame(1, DB::table('tournament_entries')->where('tournament_id', self::TOURNAMENT)->count());
    }

    public function test_entering_a_non_waiver_tournament_is_unaffected(): void
    {
        // requires_waiver=false (the default) → the gate is a no-op; entering
        // without any waiver row must still succeed.
        $this->seedTournament(requiresWaiver: false);

        $response = $this->controller->enter($this->requestFor(self::CAPTAIN), self::TOURNAMENT);
        $payload = $response->getData(true);

        $this->assertSame(201, $response->getStatusCode());
        $this->assertSame(self::CAPTAIN, $payload['captain_user_id']);
        $this->assertSame(1, DB::table('tournament_entries')->where('tournament_id', self::TOURNAMENT)->count());
        $this->assertSame(0, DB::table('tournament_waivers')->where('tournament_id', self::TOURNAMENT)->count());
    }

    private function seedTournament(bool $requiresWaiver): void
    {
        DB::table('tournaments')->insert([
            'id' => self::TOURNAMENT,
            'name' => 'Padel Open',
            'sport_id' => self::SPORT,
            'starts_at' => now()->addDays(7),
            'ends_at' => now()->addDays(8),
            'registration_deadline' => now()->addDays(5),
            'max_squads' => 8,
            'squad_size' => 2,
            'entry_fee_minor' => 0,
            'currency' => 'AZN',
            'status' => 'registration_open',
            'requires_waiver' => $requiresWaiver,
            'created_at' => now(),
        ]);
    }

    private function requestFor(string $userId, array $body = []): Request
    {
        $request = Request::create('/api/v1/test', 'POST', $body);
        $user = new User;
        $user->forceFill(['id' => $userId, 'display_name' => 'Captain']);
        $request->attributes->set('auth_user', $user);

        return $request;
    }
}
