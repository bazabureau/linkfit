<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\HealthController;
use App\Http\Controllers\Api\InternalController;
use App\Http\Controllers\Api\OgController;
use App\Http\Controllers\Api\WebController;
use App\Models\User;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Hardening coverage for the web + og + health/internal slice.
 *
 * Drives the controllers directly with synthetic Requests (mirrors
 * CatalogHardeningTest) so in-controller authorization and input validation are
 * exercised without the JWT/HTTP stack. The schema is the minimal set of tables
 * each query touches. Postgres-only query paths (the dashboard
 * `player_ids @> ARRAY[?]::uuid[]` tournament-entries aggregate) are NOT
 * exercised under in-memory SQLite — only dashboard's auth gate is covered here.
 */
class WebOgHardeningTest extends TestCase
{
    private const ALICE = '00000000-0000-4000-8000-0000000000a1';

    private const BOB = '00000000-0000-4000-8000-0000000000b2';

    private const VENUE_PUB = '11111111-1111-4111-8111-111111111111';

    private const COURT_PADEL = '33333333-3333-4333-8333-333333333333';

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
            $table->string('photo_url')->nullable();
            $table->timestamp('deleted_at')->nullable();
        });
        Schema::create('sports', function ($table): void {
            $table->string('id')->primary();
            $table->string('slug')->unique();
            $table->string('name')->nullable();
            $table->integer('min_players')->nullable();
            $table->integer('max_players')->nullable();
        });
        Schema::create('venues', function ($table): void {
            $table->string('id')->primary();
            $table->string('name');
            $table->string('address')->nullable();
            $table->float('lat')->nullable();
            $table->float('lng')->nullable();
            $table->string('photo_url')->nullable();
            $table->text('photo_urls')->nullable();
            $table->float('rating_avg')->nullable();
            $table->integer('rating_count')->default(0);
            $table->string('status')->nullable();
            $table->text('opening_hours')->nullable();
            $table->integer('booking_slot_minutes')->nullable();
            $table->integer('min_booking_minutes')->nullable();
            $table->integer('max_booking_minutes')->nullable();
            $table->integer('cancellation_window_minutes')->nullable();
        });
        Schema::create('courts', function ($table): void {
            $table->string('id')->primary();
            $table->string('venue_id');
            $table->string('sport_id');
            $table->string('name')->nullable();
            $table->integer('hourly_price_minor')->default(0);
            $table->string('currency')->default('AZN');
            $table->string('status')->nullable();
            $table->string('photo_url')->nullable();
            $table->text('photo_urls')->nullable();
        });
        Schema::create('games', function ($table): void {
            $table->string('id')->primary();
            $table->string('host_user_id');
            $table->string('sport_id');
            $table->string('court_id')->nullable();
            $table->string('status')->nullable();
            $table->string('visibility')->nullable();
            $table->timestamp('starts_at')->nullable();
            $table->integer('duration_minutes')->nullable();
            $table->integer('capacity')->default(0);
            $table->timestamp('deleted_at')->nullable();
        });
        Schema::create('game_participants', function ($table): void {
            $table->string('game_id');
            $table->string('user_id');
            $table->string('status')->nullable();
            $table->timestamp('joined_at')->nullable();
        });
        Schema::create('player_sport_stats', function ($table): void {
            $table->string('user_id');
            $table->string('sport_id');
            $table->integer('elo_rating')->nullable();
        });
        Schema::create('tournaments', function ($table): void {
            $table->string('id')->primary();
            $table->string('name');
            $table->string('sport_id');
            $table->string('venue_id')->nullable();
            $table->string('status')->nullable();
            $table->timestamp('starts_at')->nullable();
            $table->integer('entry_fee_minor')->nullable();
            $table->string('currency')->nullable();
        });

        DB::table('users')->insert([
            ['id' => self::ALICE, 'display_name' => 'Alice'],
            ['id' => self::BOB, 'display_name' => 'Bob'],
        ]);
        DB::table('sports')->insert([
            ['id' => 'sport-padel', 'slug' => 'padel', 'name' => 'Padel', 'min_players' => 2, 'max_players' => 4],
            ['id' => 'sport-tennis', 'slug' => 'tennis', 'name' => 'Tennis', 'min_players' => 2, 'max_players' => 4],
        ]);
        DB::table('venues')->insert([
            [
                'id' => self::VENUE_PUB, 'name' => 'Toppadel', 'address' => 'Baku', 'lat' => 40.4, 'lng' => 49.8,
                'rating_avg' => 4.5, 'rating_count' => 10, 'status' => 'published',
                'opening_hours' => null, 'booking_slot_minutes' => 30,
                'min_booking_minutes' => 60, 'max_booking_minutes' => 120, 'cancellation_window_minutes' => 120,
            ],
        ]);
        DB::table('courts')->insert([
            [
                'id' => self::COURT_PADEL, 'venue_id' => self::VENUE_PUB, 'sport_id' => 'sport-padel',
                'name' => 'Court A', 'hourly_price_minor' => 5000, 'currency' => 'AZN', 'status' => 'active',
            ],
        ]);
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('tournaments');
        Schema::dropIfExists('player_sport_stats');
        Schema::dropIfExists('game_participants');
        Schema::dropIfExists('games');
        Schema::dropIfExists('courts');
        Schema::dropIfExists('venues');
        Schema::dropIfExists('sports');
        Schema::dropIfExists('users');

        parent::tearDown();
    }

    // ---- checkout ------------------------------------------------------------

    public function test_checkout_returns_court_venue_and_policy(): void
    {
        $data = app(WebController::class)
            ->checkout($this->request(null, '/api/v1/web/checkout/courts/x', ['date' => '2026-06-26']), self::COURT_PADEL)
            ->getData(true);

        $this->assertSame(self::COURT_PADEL, $data['court']['id']);
        $this->assertSame('padel', $data['court']['sport_slug']);
        $this->assertSame(5000, $data['court']['hourly_price_minor']);
        $this->assertSame(self::VENUE_PUB, $data['venue']['id']);
        $this->assertSame('2026-06-26', $data['policy']['date']);
        // Null opening_hours falls back to the default open window, not closed.
        $this->assertSame('07:00', $data['policy']['opening_hours']['open']);
        $this->assertContains('onsite', $data['policy']['payment_methods']);
    }

    public function test_checkout_defaults_date_when_absent(): void
    {
        $data = app(WebController::class)
            ->checkout($this->request(null, '/api/v1/web/checkout/courts/x'), self::COURT_PADEL)
            ->getData(true);

        $this->assertMatchesRegularExpression('/^\d{4}-\d{2}-\d{2}$/', $data['policy']['date']);
    }

    public function test_checkout_rejects_impossible_calendar_date_with_422(): void
    {
        try {
            app(WebController::class)->checkout(
                $this->request(null, '/api/v1/web/checkout/courts/x', ['date' => '2026-13-45']),
                self::COURT_PADEL,
            );
            $this->fail('Expected 422 for an impossible calendar date.');
        } catch (ApiException $e) {
            $this->assertSame(422, $e->getStatusCode());
        }
    }

    public function test_checkout_rejects_malformed_court_id_without_500(): void
    {
        try {
            app(WebController::class)->checkout(
                $this->request(null, '/api/v1/web/checkout/courts/garbage'),
                'not-a-uuid',
            );
            $this->fail('Expected 404 for a malformed court id.');
        } catch (ApiException $e) {
            $this->assertSame(404, $e->getStatusCode());
        }
    }

    public function test_checkout_returns_404_for_unknown_court(): void
    {
        try {
            app(WebController::class)->checkout(
                $this->request(null, '/api/v1/web/checkout/courts/x'),
                '99999999-9999-4999-8999-999999999999',
            );
            $this->fail('Expected 404 for a non-existent court.');
        } catch (ApiException $e) {
            $this->assertSame(404, $e->getStatusCode());
        }
    }

    // ---- bootstrap / publicStats --------------------------------------------

    public function test_bootstrap_returns_public_payload_shape(): void
    {
        $data = app(WebController::class)->bootstrap()->getData(true);

        $this->assertCount(2, $data['sports']);
        $this->assertSame('padel', $data['sports'][0]['slug']);
        $this->assertCount(1, $data['venues']);
        $this->assertSame(1, $data['venues'][0]['courts_count']);
        $this->assertSame([], $data['games']);
        $this->assertSame([], $data['tournaments']);
        $this->assertSame(1, $data['stats']['venues']);
        $this->assertSame(1, $data['stats']['courts']);
        $this->assertSame(0, $data['stats']['open_games']);
    }

    public function test_public_stats_returns_real_counts(): void
    {
        $data = app(WebController::class)->publicStats()->getData(true);

        $this->assertSame(2, $data['active_players']);
        $this->assertSame(1, $data['partner_clubs']);
        $this->assertSame(0, $data['weekly_matches']);
        $this->assertSame(0, $data['tournaments']);
    }

    // ---- dashboard auth gate -------------------------------------------------

    public function test_dashboard_requires_authentication(): void
    {
        try {
            app(WebController::class)->dashboard($this->request(null, '/api/v1/web/dashboard'));
            $this->fail('Expected an authentication error.');
        } catch (ApiException $e) {
            $this->assertSame(401, $e->getStatusCode());
        }
    }

    // ---- og / health / internal ---------------------------------------------

    public function test_og_returns_png_image(): void
    {
        $response = app(OgController::class)->image();

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame('image/png', $response->headers->get('Content-Type'));
        $this->assertNotSame('', $response->getContent());
    }

    public function test_health_and_ready_report_ok(): void
    {
        $health = app(HealthController::class)->health()->getData(true);
        $this->assertTrue($health['ok']);

        $ready = app(HealthController::class)->ready()->getData(true);
        $this->assertTrue($ready['ok']);
        $this->assertSame('ok', $ready['checks']['db']);
    }

    public function test_internal_capabilities_echoes_key_type_and_flags(): void
    {
        $request = $this->request(null, '/api/v1/internal/capabilities');
        $request->attributes->set('linkfit_api_key_type', 'internal');

        $data = app(InternalController::class)->capabilities($request)->getData(true);

        $this->assertTrue($data['ok']);
        $this->assertSame('internal', $data['mode']);
        $this->assertSame('internal', $data['api_key_type']);
        $this->assertArrayHasKey('server_to_server', $data['features']);
    }

    private function request(?string $userId, string $uri, array $params = [], string $method = 'GET'): Request
    {
        $request = Request::create($uri, $method, $params);
        if ($userId !== null) {
            $user = new User;
            $user->forceFill(['id' => $userId]);
            $request->attributes->set('auth_user', $user);
        }

        return $request;
    }
}
