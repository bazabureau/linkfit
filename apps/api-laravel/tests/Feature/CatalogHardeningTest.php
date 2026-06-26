<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\CatalogController;
use App\Models\User;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Hardening coverage for the catalog slice (venues / courts / saved / availability).
 *
 * Drives the controller directly with a synthetic Request (mirrors
 * DiscoveryHardeningTest) so the in-controller authorization, status scoping and
 * input validation are exercised without the JWT/HTTP stack. The schema is the
 * minimal set of tables each query touches. Query paths that rely on
 * Postgres-only operators (earth_distance/ll_to_earth `::float8`, the
 * `null::text` distance projection, `(... || ' minutes')::interval`) are NOT
 * exercised under the in-memory SQLite DB — so the open-window slot computation
 * and the geo-sorted venues() list are intentionally out of scope here.
 */
class CatalogHardeningTest extends TestCase
{
    private const ALICE = '00000000-0000-4000-8000-0000000000a1';

    private const BOB = '00000000-0000-4000-8000-0000000000b2';

    private const VENUE_PUB = '11111111-1111-4111-8111-111111111111';

    private const VENUE_SUSPENDED = '22222222-2222-4222-8222-222222222222';

    private const COURT_PADEL = '33333333-3333-4333-8333-333333333333';

    private const COURT_INACTIVE = '44444444-4444-4444-8444-444444444444';

    private const COURT_IN_SUSPENDED = '55555555-5555-4555-8555-555555555555';

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
            $table->integer('is_partner')->default(0);
            $table->string('phone')->nullable();
            $table->text('description')->nullable();
            $table->text('description_i18n')->nullable();
            $table->string('logo_url')->nullable();
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
        Schema::create('user_saved_venues', function ($table): void {
            $table->string('user_id');
            $table->string('venue_id');
            $table->timestamp('created_at')->nullable();
            $table->primary(['user_id', 'venue_id']);
        });
        Schema::create('user_saved_courts', function ($table): void {
            $table->string('user_id');
            $table->string('court_id');
            $table->timestamp('created_at')->nullable();
            $table->primary(['user_id', 'court_id']);
        });

        DB::table('users')->insert([
            ['id' => self::ALICE, 'display_name' => 'Alice'],
            ['id' => self::BOB, 'display_name' => 'Bob'],
        ]);
        DB::table('sports')->insert([
            ['id' => 'sport-padel', 'slug' => 'padel', 'name' => 'Padel', 'min_players' => 2, 'max_players' => 4],
            ['id' => 'sport-tennis', 'slug' => 'tennis', 'name' => 'Tennis', 'min_players' => 2, 'max_players' => 4],
        ]);
        // Every weekday closed → openingWindowForDate() returns null, so the
        // availability endpoint takes the early-return branch and never touches
        // the Postgres-only interval queries.
        $allClosed = json_encode([
            '1' => ['closed' => true], '2' => ['closed' => true], '3' => ['closed' => true],
            '4' => ['closed' => true], '5' => ['closed' => true], '6' => ['closed' => true],
            '7' => ['closed' => true],
        ]);
        DB::table('venues')->insert([
            [
                'id' => self::VENUE_PUB, 'name' => 'Toppadel', 'address' => 'Baku', 'lat' => 40.4, 'lng' => 49.8,
                'is_partner' => 1, 'rating_avg' => 4.5, 'rating_count' => 10, 'status' => 'published',
                'opening_hours' => $allClosed, 'booking_slot_minutes' => 30,
            ],
            [
                'id' => self::VENUE_SUSPENDED, 'name' => 'Hidden Club', 'address' => 'Ganja', 'lat' => 40.6, 'lng' => 46.3,
                'is_partner' => 0, 'rating_avg' => null, 'rating_count' => 0, 'status' => 'suspended',
                'opening_hours' => $allClosed, 'booking_slot_minutes' => 30,
            ],
        ]);
        DB::table('courts')->insert([
            [
                'id' => self::COURT_PADEL, 'venue_id' => self::VENUE_PUB, 'sport_id' => 'sport-padel',
                'name' => 'Court A', 'hourly_price_minor' => 5000, 'currency' => 'AZN', 'status' => 'active',
            ],
            [
                'id' => self::COURT_INACTIVE, 'venue_id' => self::VENUE_PUB, 'sport_id' => 'sport-padel',
                'name' => 'Court B', 'hourly_price_minor' => 6000, 'currency' => 'AZN', 'status' => 'maintenance',
            ],
            [
                'id' => self::COURT_IN_SUSPENDED, 'venue_id' => self::VENUE_SUSPENDED, 'sport_id' => 'sport-tennis',
                'name' => 'Court C', 'hourly_price_minor' => 7000, 'currency' => 'AZN', 'status' => 'active',
            ],
        ]);
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('user_saved_courts');
        Schema::dropIfExists('user_saved_venues');
        Schema::dropIfExists('courts');
        Schema::dropIfExists('venues');
        Schema::dropIfExists('sports');
        Schema::dropIfExists('users');

        parent::tearDown();
    }

    // ---- sports / courts list ------------------------------------------------

    public function test_sports_lists_padel_then_tennis(): void
    {
        $data = app(CatalogController::class)->sports()->getData(true);

        $this->assertCount(2, $data['items']);
        $this->assertSame('padel', $data['items'][0]['slug']);
        $this->assertSame('tennis', $data['items'][1]['slug']);
    }

    public function test_courts_list_only_exposes_active_courts_in_published_venues(): void
    {
        $data = app(CatalogController::class)
            ->courts($this->request(null, '/api/v1/courts'))
            ->getData(true);

        $ids = array_column($data['items'], 'id');
        $this->assertContains(self::COURT_PADEL, $ids);
        // Inactive court and the court in a suspended venue must be hidden.
        $this->assertNotContains(self::COURT_INACTIVE, $ids);
        $this->assertNotContains(self::COURT_IN_SUSPENDED, $ids);
        $this->assertSame(1, $data['pagination']['total']);
    }

    // ---- single venue / court lookups ---------------------------------------

    public function test_venue_lookup_hides_unpublished_venue(): void
    {
        try {
            app(CatalogController::class)->venue(self::VENUE_SUSPENDED);
            $this->fail('Expected 404 for a suspended venue.');
        } catch (ApiException $e) {
            $this->assertSame(404, $e->getStatusCode());
        }
    }

    public function test_venue_lookup_rejects_malformed_id_without_500(): void
    {
        try {
            app(CatalogController::class)->venue('not-a-uuid');
            $this->fail('Expected 404 for a malformed venue id.');
        } catch (ApiException $e) {
            $this->assertSame(404, $e->getStatusCode());
        }
    }

    public function test_court_lookup_rejects_malformed_id_without_500(): void
    {
        try {
            app(CatalogController::class)->court('garbage');
            $this->fail('Expected 404 for a malformed court id.');
        } catch (ApiException $e) {
            $this->assertSame(404, $e->getStatusCode());
        }
    }

    public function test_court_lookup_hides_inactive_court(): void
    {
        try {
            app(CatalogController::class)->court(self::COURT_INACTIVE);
            $this->fail('Expected 404 for an inactive court.');
        } catch (ApiException $e) {
            $this->assertSame(404, $e->getStatusCode());
        }
    }

    // ---- availability --------------------------------------------------------

    public function test_availability_rejects_invalid_calendar_date(): void
    {
        try {
            app(CatalogController::class)->venueAvailability(
                $this->request(null, '/api/v1/venues/'.self::VENUE_PUB.'/availability', ['date' => '2026-13-45']),
                self::VENUE_PUB,
            );
            $this->fail('Expected 422 for an impossible calendar date.');
        } catch (ApiException $e) {
            $this->assertSame(422, $e->getStatusCode());
        }
    }

    public function test_availability_rejects_malformed_venue_id(): void
    {
        try {
            app(CatalogController::class)->venueAvailability(
                $this->request(null, '/api/v1/venues/x/availability', ['date' => '2026-06-26']),
                'not-a-uuid',
            );
            $this->fail('Expected 404 for a malformed venue id.');
        } catch (ApiException $e) {
            $this->assertSame(404, $e->getStatusCode());
        }
    }

    public function test_availability_hides_unpublished_venue(): void
    {
        try {
            app(CatalogController::class)->venueAvailability(
                $this->request(null, '/api/v1/venues/'.self::VENUE_SUSPENDED.'/availability', ['date' => '2026-06-26']),
                self::VENUE_SUSPENDED,
            );
            $this->fail('Expected 404 for a suspended venue.');
        } catch (ApiException $e) {
            $this->assertSame(404, $e->getStatusCode());
        }
    }

    public function test_availability_closed_day_returns_empty_slots(): void
    {
        $data = app(CatalogController::class)->venueAvailability(
            $this->request(null, '/api/v1/venues/'.self::VENUE_PUB.'/availability', ['date' => '2026-06-26']),
            self::VENUE_PUB,
        )->getData(true);

        $this->assertNull($data['open_hour']);
        $this->assertNull($data['close_hour']);
        $this->assertSame(self::VENUE_PUB, $data['venue']['id']);
        // Only padel/tennis active courts of the published venue are listed, each
        // with an empty slot set on a closed day.
        $this->assertCount(1, $data['courts']);
        $this->assertSame(self::COURT_PADEL, $data['courts'][0]['id']);
        $this->assertSame([], $data['courts'][0]['slots']);
        $this->assertSame(0, $data['courts'][0]['free_slots_count']);
    }

    // ---- saved venues --------------------------------------------------------

    public function test_save_venue_requires_authentication(): void
    {
        try {
            app(CatalogController::class)->saveVenue($this->request(null, '/api/v1/venues/x/save', [], 'POST'), self::VENUE_PUB);
            $this->fail('Expected an authentication error.');
        } catch (ApiException $e) {
            $this->assertSame(401, $e->getStatusCode());
        }
    }

    public function test_save_and_list_saved_venue_is_scoped_to_the_user(): void
    {
        $response = app(CatalogController::class)->saveVenue(
            $this->request(self::ALICE, '/api/v1/venues/x/save', [], 'POST'),
            self::VENUE_PUB,
        );
        $this->assertSame(201, $response->getStatusCode());
        $this->assertTrue($response->getData(true)['is_saved']);

        $alice = app(CatalogController::class)
            ->savedVenues($this->request(self::ALICE, '/api/v1/me/saved-venues'))
            ->getData(true);
        $this->assertCount(1, $alice['items']);
        $this->assertSame(self::VENUE_PUB, $alice['items'][0]['id']);
        $this->assertTrue($alice['items'][0]['is_saved']);

        // Bob never saved it — his list is empty (no cross-user leakage).
        $bob = app(CatalogController::class)
            ->savedVenues($this->request(self::BOB, '/api/v1/me/saved-venues'))
            ->getData(true);
        $this->assertCount(0, $bob['items']);
    }

    public function test_save_venue_rejects_unpublished_venue(): void
    {
        try {
            app(CatalogController::class)->saveVenue(
                $this->request(self::ALICE, '/api/v1/venues/x/save', [], 'POST'),
                self::VENUE_SUSPENDED,
            );
            $this->fail('Expected 404 saving a suspended venue.');
        } catch (ApiException $e) {
            $this->assertSame(404, $e->getStatusCode());
        }

        $this->assertSame(0, DB::table('user_saved_venues')->where('venue_id', self::VENUE_SUSPENDED)->count());
    }

    public function test_save_venue_rejects_malformed_id_without_500(): void
    {
        try {
            app(CatalogController::class)->saveVenue(
                $this->request(self::ALICE, '/api/v1/venues/x/save', [], 'POST'),
                'not-a-uuid',
            );
            $this->fail('Expected 404 for a malformed venue id.');
        } catch (ApiException $e) {
            $this->assertSame(404, $e->getStatusCode());
        }
    }

    public function test_unsave_venue_only_removes_the_callers_own_row(): void
    {
        DB::table('user_saved_venues')->insert([
            ['user_id' => self::ALICE, 'venue_id' => self::VENUE_PUB, 'created_at' => now()],
            ['user_id' => self::BOB, 'venue_id' => self::VENUE_PUB, 'created_at' => now()],
        ]);

        $response = app(CatalogController::class)->unsaveVenue(
            $this->request(self::ALICE, '/api/v1/venues/x/save', [], 'DELETE'),
            self::VENUE_PUB,
        );
        $this->assertTrue($response->getData(true)['ok']);

        // Alice's row gone, Bob's untouched.
        $this->assertSame(0, DB::table('user_saved_venues')->where('user_id', self::ALICE)->count());
        $this->assertSame(1, DB::table('user_saved_venues')->where('user_id', self::BOB)->count());
    }

    public function test_unsave_venue_is_idempotent_on_malformed_id(): void
    {
        $response = app(CatalogController::class)->unsaveVenue(
            $this->request(self::ALICE, '/api/v1/venues/x/save', [], 'DELETE'),
            'not-a-uuid',
        );
        $this->assertTrue($response->getData(true)['ok']);
    }

    // ---- saved courts --------------------------------------------------------

    public function test_save_court_rejects_court_in_unpublished_venue(): void
    {
        try {
            app(CatalogController::class)->saveCourt(
                $this->request(self::ALICE, '/api/v1/courts/x/save', [], 'POST'),
                self::COURT_IN_SUSPENDED,
            );
            $this->fail('Expected 404 saving a court in a suspended venue.');
        } catch (ApiException $e) {
            $this->assertSame(404, $e->getStatusCode());
        }

        $this->assertSame(0, DB::table('user_saved_courts')->count());
    }

    public function test_save_court_rejects_inactive_court(): void
    {
        try {
            app(CatalogController::class)->saveCourt(
                $this->request(self::ALICE, '/api/v1/courts/x/save', [], 'POST'),
                self::COURT_INACTIVE,
            );
            $this->fail('Expected 404 saving an inactive court.');
        } catch (ApiException $e) {
            $this->assertSame(404, $e->getStatusCode());
        }
    }

    public function test_save_and_list_saved_court_roundtrip(): void
    {
        $response = app(CatalogController::class)->saveCourt(
            $this->request(self::ALICE, '/api/v1/courts/x/save', [], 'POST'),
            self::COURT_PADEL,
        );
        $this->assertSame(201, $response->getStatusCode());

        $alice = app(CatalogController::class)
            ->savedCourts($this->request(self::ALICE, '/api/v1/me/saved-courts'))
            ->getData(true);
        $this->assertCount(1, $alice['items']);
        $this->assertSame(self::COURT_PADEL, $alice['items'][0]['id']);
        $this->assertTrue($alice['items'][0]['is_saved']);

        // Unsave is scoped + idempotent.
        $response = app(CatalogController::class)->unsaveCourt(
            $this->request(self::ALICE, '/api/v1/courts/x/save', [], 'DELETE'),
            self::COURT_PADEL,
        );
        $this->assertTrue($response->getData(true)['ok']);
        $this->assertSame(0, DB::table('user_saved_courts')->where('user_id', self::ALICE)->count());
    }

    public function test_unsave_court_is_idempotent_on_malformed_id(): void
    {
        $response = app(CatalogController::class)->unsaveCourt(
            $this->request(self::ALICE, '/api/v1/courts/x/save', [], 'DELETE'),
            'garbage',
        );
        $this->assertTrue($response->getData(true)['ok']);
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
