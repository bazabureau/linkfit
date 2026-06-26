<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\PaymentsController;
use App\Models\User;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Authorization (IDOR), input-validation, pagination and tournament-intent
 * guard coverage for the payments slice. Complements PaymentProviderGuardTest
 * (which proves the "no fake secret" / disabled-surface behaviour); this file
 * proves that, *with the payment surface enabled*, the per-action ownership and
 * validation checks reject unauthorized / malformed requests before any work.
 */
class MembershipPaymentsHardeningTest extends TestCase
{
    private const BOOKING_ID = '11111111-1111-4111-8111-111111111111';

    private const OTHER_BOOKING_ID = '22222222-2222-4222-8222-222222222222';

    private const TOURNAMENT_ID = '33333333-3333-4333-8333-333333333333';

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
        DB::purge('sqlite');
        DB::reconnect('sqlite');

        // Payment surface fully "on" so every test exercises the in-controller
        // authz/validation logic rather than the disabled-surface short-circuit.
        config()->set('membership.public_subscriptions_enabled', true);
        config()->set('membership.payments_enabled', true);
        config()->set('membership.payment_provider', null);

        Schema::create('users', function ($table): void {
            $table->string('id')->primary();
            $table->string('admin_role')->nullable();
            $table->string('venue_id')->nullable();
            $table->text('staff_permissions')->nullable();
            $table->timestamp('created_at')->nullable();
        });

        Schema::create('venues', function ($table): void {
            $table->string('id')->primary();
            $table->string('name')->nullable();
            $table->string('owner_user_id')->nullable();
        });

        Schema::create('courts', function ($table): void {
            $table->string('id')->primary();
            $table->string('venue_id');
            $table->string('name')->nullable();
        });

        Schema::create('bookings', function ($table): void {
            $table->string('id')->primary();
            $table->string('user_id');
            $table->string('court_id')->nullable();
            $table->integer('total_minor')->default(0);
            $table->string('currency', 3)->default('AZN');
            $table->string('status')->default('pending');
            $table->string('payment_method')->nullable();
            $table->string('external_ref')->nullable();
            $table->timestamp('paid_at')->nullable();
            $table->timestamp('created_at')->nullable();
            $table->timestamp('updated_at')->nullable();
        });

        Schema::create('sports', function ($table): void {
            $table->string('id')->primary();
            $table->string('slug');
        });

        Schema::create('tournaments', function ($table): void {
            $table->string('id')->primary();
            $table->string('sport_id');
            $table->string('venue_id')->nullable();
            $table->string('name')->nullable();
            $table->string('status')->default('registration_open');
            $table->timestamp('registration_deadline')->nullable();
            $table->timestamp('starts_at')->nullable();
            $table->integer('max_squads')->default(8);
            $table->integer('squad_size')->default(2);
            $table->integer('entry_fee_minor')->default(0);
            $table->string('currency', 3)->default('AZN');
        });

        Schema::create('tournament_entries', function ($table): void {
            $table->string('id')->primary();
            $table->string('tournament_id');
            $table->string('captain_user_id');
            $table->string('status')->default('confirmed');
            $table->string('squad_name')->nullable();
        });

        Schema::create('tournament_entry_payments', function ($table): void {
            $table->string('id')->primary();
            $table->string('tournament_id');
            $table->string('captain_user_id');
            $table->string('status')->default('pending');
            $table->integer('amount_minor')->default(0);
            $table->string('currency', 3)->default('AZN');
            $table->string('payment_intent_id')->nullable();
            $table->string('squad_name')->nullable();
            $table->timestamp('succeeded_at')->nullable();
            $table->timestamp('created_at')->nullable();
            $table->timestamp('updated_at')->nullable();
        });
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('tournament_entry_payments');
        Schema::dropIfExists('tournament_entries');
        Schema::dropIfExists('tournaments');
        Schema::dropIfExists('sports');
        Schema::dropIfExists('bookings');
        Schema::dropIfExists('courts');
        Schema::dropIfExists('venues');
        Schema::dropIfExists('users');

        parent::tearDown();
    }

    // --- bookingIntent authorization / input ------------------------------

    public function test_booking_intent_forbids_creating_intent_for_another_users_booking(): void
    {
        $this->seedVenueAndCourt();
        $this->insertBooking(self::OTHER_BOOKING_ID, 'user-2');

        try {
            app(PaymentsController::class)->bookingIntent($this->request('user-1'), self::OTHER_BOOKING_ID);
            $this->fail('Expected an IDOR attempt to be forbidden.');
        } catch (ApiException $exception) {
            $this->assertSame('FORBIDDEN', $exception->wireCode());
            $this->assertSame(403, $exception->getStatusCode());
        }

        // Never claimed an external_ref on a booking the caller does not own.
        $this->assertNull(DB::table('bookings')->where('id', self::OTHER_BOOKING_ID)->value('external_ref'));
    }

    public function test_booking_intent_treats_non_uuid_id_as_not_found(): void
    {
        try {
            app(PaymentsController::class)->bookingIntent($this->request('user-1'), 'not-a-uuid');
            $this->fail('Expected a malformed id to be a clean 404.');
        } catch (ApiException $exception) {
            $this->assertSame('NOT_FOUND', $exception->wireCode());
            $this->assertSame(404, $exception->getStatusCode());
        }
    }

    public function test_booking_intent_returns_not_found_for_missing_booking(): void
    {
        try {
            app(PaymentsController::class)->bookingIntent($this->request('user-1'), self::BOOKING_ID);
            $this->fail('Expected a missing booking to be a 404.');
        } catch (ApiException $exception) {
            $this->assertSame(404, $exception->getStatusCode());
        }
    }

    public function test_booking_intent_owner_passes_authz_and_stops_at_provider_stub(): void
    {
        $this->seedVenueAndCourt();
        $this->insertBooking(self::BOOKING_ID, 'user-1', ['total_minor' => 2500]);

        try {
            app(PaymentsController::class)->bookingIntent($this->request('user-1'), self::BOOKING_ID);
            $this->fail('Expected the provider stub to reject (no adapter yet).');
        } catch (ApiException $exception) {
            $this->assertSame('PAYMENT_PROVIDER_NOT_CONFIGURED', $exception->wireCode());
            $this->assertSame(501, $exception->getStatusCode());
            $this->assertFalse($exception->getDetails()['checkout_available'] ?? true);
        }

        // The owner cleared authorization, but with no provider no intent was
        // ever issued — external_ref must remain unclaimed.
        $this->assertNull(DB::table('bookings')->where('id', self::BOOKING_ID)->value('external_ref'));
    }

    // --- bookingStatus authorization / input ------------------------------

    public function test_booking_status_forbids_reading_another_users_booking(): void
    {
        $this->insertBooking(self::OTHER_BOOKING_ID, 'user-2', ['status' => 'paid', 'paid_at' => now()]);

        try {
            app(PaymentsController::class)->bookingStatus($this->request('user-1', 'GET'), self::OTHER_BOOKING_ID);
            $this->fail('Expected an IDOR read attempt to be forbidden.');
        } catch (ApiException $exception) {
            $this->assertSame('FORBIDDEN', $exception->wireCode());
            $this->assertSame(403, $exception->getStatusCode());
        }
    }

    public function test_booking_status_treats_non_uuid_id_as_not_found(): void
    {
        try {
            app(PaymentsController::class)->bookingStatus($this->request('user-1', 'GET'), 'not-a-uuid');
            $this->fail('Expected a malformed id to be a clean 404.');
        } catch (ApiException $exception) {
            $this->assertSame(404, $exception->getStatusCode());
        }
    }

    public function test_booking_status_owner_sees_pending_for_unpaid_booking_without_leaking_paid_at(): void
    {
        $this->insertBooking(self::BOOKING_ID, 'user-1', ['status' => 'pending', 'paid_at' => '2026-06-01 10:00:00']);

        $response = app(PaymentsController::class)->bookingStatus($this->request('user-1', 'GET'), self::BOOKING_ID);
        $payload = $response->getData(true);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame('pending', $payload['status']);
        // A stale paid_at must never be surfaced for an unpaid booking.
        $this->assertNull($payload['paid_at']);
    }

    // --- history scoping / pagination / validation ------------------------

    public function test_history_only_returns_callers_payments_with_accurate_summary(): void
    {
        $this->seedVenueAndCourt();
        $this->insertBooking('aaaaaaa1-0000-4000-8000-000000000001', 'user-1', ['status' => 'paid', 'total_minor' => 1000, 'created_at' => now()->subDays(3)]);
        $this->insertBooking('aaaaaaa1-0000-4000-8000-000000000002', 'user-1', ['status' => 'paid', 'total_minor' => 2000, 'created_at' => now()->subDays(2)]);
        $this->insertBooking('aaaaaaa1-0000-4000-8000-000000000003', 'user-1', ['status' => 'pending', 'total_minor' => 500, 'created_at' => now()->subDay()]);
        // Another user's payment must never appear.
        $this->insertBooking('bbbbbbb2-0000-4000-8000-000000000001', 'user-2', ['status' => 'paid', 'total_minor' => 9999]);

        $response = app(PaymentsController::class)->history($this->request('user-1', 'GET'));
        $payload = $response->getData(true);

        $this->assertCount(3, $payload['items']);
        foreach ($payload['items'] as $item) {
            $this->assertStringStartsWith('booking:aaaaaaa1', $item['id']);
        }
        $this->assertSame(3, $payload['pagination']['total']);
        $this->assertSame(2, $payload['summary']['paid_count']);
        $this->assertSame(1, $payload['summary']['pending_count']);
        $this->assertSame(3000, $payload['summary']['paid_total_minor']);
        $this->assertSame(500, $payload['summary']['pending_total_minor']);
    }

    public function test_history_pagination_slices_page_but_keeps_full_total(): void
    {
        $this->seedVenueAndCourt();
        $this->insertBooking('aaaaaaa1-0000-4000-8000-000000000001', 'user-1', ['created_at' => now()->subDays(3)]);
        $this->insertBooking('aaaaaaa1-0000-4000-8000-000000000002', 'user-1', ['created_at' => now()->subDays(2)]);
        $this->insertBooking('aaaaaaa1-0000-4000-8000-000000000003', 'user-1', ['created_at' => now()->subDay()]);

        $response = app(PaymentsController::class)->history(
            $this->request('user-1', 'GET', ['limit' => 2, 'offset' => 0, 'type' => 'booking'])
        );
        $payload = $response->getData(true);

        $this->assertCount(2, $payload['items']);
        $this->assertSame(2, $payload['pagination']['limit']);
        $this->assertSame(0, $payload['pagination']['offset']);
        $this->assertSame(3, $payload['pagination']['total']);
    }

    public function test_history_rejects_out_of_range_limit(): void
    {
        try {
            app(PaymentsController::class)->history($this->request('user-1', 'GET', ['limit' => 101]));
            $this->fail('Expected a limit above the cap to fail validation.');
        } catch (ApiException $exception) {
            $this->assertSame('VALIDATION_ERROR', $exception->wireCode());
            $this->assertSame(422, $exception->getStatusCode());
        }
    }

    // --- tournamentIntent validation / conflicts / authz ------------------

    public function test_tournament_intent_requires_squad_name(): void
    {
        try {
            app(PaymentsController::class)->tournamentIntent($this->request('user-1'), self::TOURNAMENT_ID);
            $this->fail('Expected missing squad_name to fail validation.');
        } catch (ApiException $exception) {
            $this->assertSame('VALIDATION_ERROR', $exception->wireCode());
            $this->assertSame(422, $exception->getStatusCode());
        }
    }

    public function test_tournament_intent_rejects_closed_registration(): void
    {
        $this->seedTournament(['status' => 'completed']);

        try {
            app(PaymentsController::class)->tournamentIntent(
                $this->request('user-1', 'POST', ['squad_name' => 'Aces']),
                self::TOURNAMENT_ID
            );
            $this->fail('Expected closed registration to conflict.');
        } catch (ApiException $exception) {
            $this->assertSame('CONFLICT', $exception->wireCode());
            $this->assertSame(409, $exception->getStatusCode());
        }
    }

    public function test_tournament_intent_rejects_duplicate_registration(): void
    {
        $this->seedTournament();
        DB::table('tournament_entries')->insert([
            'id' => 'entry-1',
            'tournament_id' => self::TOURNAMENT_ID,
            'captain_user_id' => 'user-1',
            'status' => 'confirmed',
            'squad_name' => 'Existing',
        ]);

        try {
            app(PaymentsController::class)->tournamentIntent(
                $this->request('user-1', 'POST', ['squad_name' => 'Aces']),
                self::TOURNAMENT_ID
            );
            $this->fail('Expected a duplicate captain registration to conflict.');
        } catch (ApiException $exception) {
            $this->assertSame('CONFLICT', $exception->wireCode());
            $this->assertSame(409, $exception->getStatusCode());
        }

        $this->assertSame(0, DB::table('tournament_entry_payments')->count());
    }

    public function test_tournament_intent_rejects_taken_squad_name(): void
    {
        $this->seedTournament();
        DB::table('tournament_entries')->insert([
            'id' => 'entry-other',
            'tournament_id' => self::TOURNAMENT_ID,
            'captain_user_id' => 'user-9',
            'status' => 'confirmed',
            'squad_name' => 'Aces',
        ]);

        try {
            app(PaymentsController::class)->tournamentIntent(
                $this->request('user-1', 'POST', ['squad_name' => 'Aces']),
                self::TOURNAMENT_ID
            );
            $this->fail('Expected a taken squad name to conflict.');
        } catch (ApiException $exception) {
            $this->assertSame('CONFLICT', $exception->wireCode());
            $this->assertSame(409, $exception->getStatusCode());
        }
    }

    public function test_tournament_intent_passes_all_guards_and_stops_at_provider_stub(): void
    {
        $this->seedTournament(['entry_fee_minor' => 5000]);

        try {
            app(PaymentsController::class)->tournamentIntent(
                $this->request('user-1', 'POST', ['squad_name' => 'Fresh Squad']),
                self::TOURNAMENT_ID
            );
            $this->fail('Expected the provider stub to reject (no adapter yet).');
        } catch (ApiException $exception) {
            $this->assertSame('PAYMENT_PROVIDER_NOT_CONFIGURED', $exception->wireCode());
            $this->assertSame(501, $exception->getStatusCode());
        }

        // Validation + conflict checks all passed, but with no provider no
        // payment row must be inserted.
        $this->assertSame(0, DB::table('tournament_entry_payments')->count());
    }

    // --- helpers ----------------------------------------------------------

    private function seedVenueAndCourt(): void
    {
        DB::table('venues')->insertOrIgnore(['id' => 'venue-1', 'name' => 'Top Padel', 'owner_user_id' => 'owner-1']);
        DB::table('courts')->insertOrIgnore(['id' => 'court-1', 'venue_id' => 'venue-1', 'name' => 'Court 1']);
    }

    private function seedTournament(array $overrides = []): void
    {
        DB::table('sports')->insertOrIgnore(['id' => 'sport-padel', 'slug' => 'padel']);
        DB::table('tournaments')->insert(array_merge([
            'id' => self::TOURNAMENT_ID,
            'sport_id' => 'sport-padel',
            'venue_id' => null,
            'name' => 'Spring Cup',
            'status' => 'registration_open',
            'registration_deadline' => now()->addDays(5),
            'starts_at' => now()->addDays(10),
            'max_squads' => 8,
            'squad_size' => 2,
            'entry_fee_minor' => 0,
            'currency' => 'AZN',
        ], $overrides));
    }

    private function insertBooking(string $id, string $userId, array $overrides = []): void
    {
        DB::table('bookings')->insert(array_merge([
            'id' => $id,
            'user_id' => $userId,
            'court_id' => 'court-1',
            'total_minor' => 2500,
            'currency' => 'AZN',
            'status' => 'pending',
            'payment_method' => 'local',
            'external_ref' => null,
            'paid_at' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }

    private function request(string $userId, string $method = 'POST', array $params = []): Request
    {
        $request = Request::create('/api/v1/payments', $method, $params);
        $user = new User;
        $user->forceFill(['id' => $userId]);
        $request->attributes->set('auth_user', $user);

        return $request;
    }
}
