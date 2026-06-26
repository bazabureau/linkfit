<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\BookingsController;
use App\Models\User;
use App\Services\Mail\TransactionalMailService;
use App\Services\Membership\MembershipService;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Hardening coverage for the bookings + holds + quote slice:
 *  - quote happy path + unknown-court validation
 *  - cancel() re-cancel guard (no refund_status wipe / no duplicate side-effects)
 *  - releaseHold() ownership (IDOR)
 *  - store() game_id authorisation (a booking may only reference a game the actor
 *    is part of)
 */
class BookingsHardeningTest extends TestCase
{
    private const BOOKER = '00000000-0000-4000-8000-000000000601';

    private const OTHER = '00000000-0000-4000-8000-000000000602';

    private const SPORT = '00000000-0000-4000-8000-000000000603';

    private const VENUE = '00000000-0000-4000-8000-000000000604';

    private const COURT = '00000000-0000-4000-8000-000000000605';

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
        DB::purge('sqlite');
        DB::reconnect('sqlite');

        Schema::create('sports', function ($table): void {
            $table->string('id')->primary();
            $table->string('slug');
            $table->string('name');
        });
        Schema::create('venues', function ($table): void {
            $table->string('id')->primary();
            $table->string('name');
            $table->string('status')->nullable();
            $table->text('opening_hours')->nullable();
            $table->unsignedSmallInteger('booking_slot_minutes')->default(30);
            $table->unsignedSmallInteger('min_booking_minutes')->default(60);
            $table->unsignedSmallInteger('max_booking_minutes')->default(120);
            $table->unsignedSmallInteger('cancellation_window_minutes')->default(120);
        });
        Schema::create('courts', function ($table): void {
            $table->string('id')->primary();
            $table->string('venue_id');
            $table->string('sport_id');
            $table->string('name');
            $table->string('status')->nullable();
            $table->integer('hourly_price_minor')->default(1000);
            $table->string('currency', 3)->default('AZN');
        });
        Schema::create('bookings', function ($table): void {
            $table->string('id')->primary();
            $table->string('game_id')->nullable();
            $table->string('court_id');
            $table->string('user_id')->nullable();
            $table->timestamp('starts_at');
            $table->unsignedSmallInteger('duration_minutes');
            $table->integer('subtotal_minor')->nullable();
            $table->integer('discount_minor')->nullable();
            $table->string('promo_code_id')->nullable();
            $table->integer('total_minor')->default(1000);
            $table->string('currency', 3)->default('AZN');
            $table->string('status');
            $table->string('source')->nullable();
            $table->string('payment_method')->nullable();
            $table->string('payment_note')->nullable();
            $table->string('customer_name')->nullable();
            $table->string('customer_email')->nullable();
            $table->string('created_by_user_id')->nullable();
            $table->string('idempotency_key')->nullable();
            $table->string('external_ref')->nullable();
            $table->timestamp('paid_at')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->string('cancelled_by_user_id')->nullable();
            $table->string('cancellation_reason')->nullable();
            $table->timestamp('rescheduled_at')->nullable();
            $table->timestamp('no_show_at')->nullable();
            $table->string('refund_status')->nullable();
            $table->integer('refund_amount_minor')->nullable();
            $table->string('refund_note')->nullable();
            $table->timestamp('refunded_at')->nullable();
            $table->timestamps();
        });
        Schema::create('booking_holds', function ($table): void {
            $table->string('id')->primary();
            $table->string('user_id');
            $table->string('court_id');
            $table->timestamp('starts_at');
            $table->unsignedSmallInteger('duration_minutes');
            $table->timestamp('expires_at');
            $table->string('source')->default('app');
            $table->string('idempotency_key')->nullable();
            $table->timestamps();
        });
        Schema::create('court_blocks', function ($table): void {
            $table->string('id')->primary();
            $table->string('court_id');
            $table->timestamp('starts_at');
            $table->timestamp('ends_at');
        });
        Schema::create('payment_splits', function ($table): void {
            $table->string('id')->primary();
            $table->string('booking_id');
            $table->string('user_id')->nullable();
            $table->integer('amount_minor')->default(0);
            $table->string('status')->nullable();
            $table->string('external_ref')->nullable();
        });
        Schema::create('notifications', function ($table): void {
            $table->string('id')->primary();
            $table->string('user_id');
            $table->string('type');
            $table->string('title');
            $table->text('body');
            $table->text('payload')->nullable();
            $table->timestamp('read_at')->nullable();
            $table->timestamp('created_at')->nullable();
        });
        Schema::create('users', function ($table): void {
            $table->string('id')->primary();
            $table->string('admin_role')->nullable();
            $table->string('venue_id')->nullable();
            $table->timestamp('deleted_at')->nullable();
        });
        Schema::create('games', function ($table): void {
            $table->string('id')->primary();
            $table->string('host_user_id');
            $table->string('status')->nullable();
        });
        Schema::create('game_participants', function ($table): void {
            $table->string('game_id');
            $table->string('user_id');
            $table->string('status')->nullable();
        });

        DB::table('sports')->insert(['id' => self::SPORT, 'slug' => 'padel', 'name' => 'Padel']);
        DB::table('venues')->insert(['id' => self::VENUE, 'name' => 'Venue', 'status' => 'published']);
        DB::table('courts')->insert([
            'id' => self::COURT,
            'venue_id' => self::VENUE,
            'sport_id' => self::SPORT,
            'name' => 'Court 1',
            'status' => 'active',
            'hourly_price_minor' => 1000,
            'currency' => 'AZN',
        ]);
    }

    protected function tearDown(): void
    {
        foreach ([
            'game_participants', 'games', 'users', 'notifications', 'payment_splits',
            'court_blocks', 'booking_holds', 'bookings', 'courts', 'venues', 'sports',
        ] as $table) {
            Schema::dropIfExists($table);
        }

        parent::tearDown();
    }

    // ---- quote -----------------------------------------------------------

    public function test_quote_returns_totals_for_valid_request(): void
    {
        $response = app(BookingsController::class)->quote($this->request([
            'court_id' => self::COURT,
            'starts_at' => $this->slotStart(),
            'duration_minutes' => 60,
        ]));

        $this->assertSame(200, $response->getStatusCode());
        $body = $response->getData(true);
        $this->assertSame(1000, $body['subtotal_minor']);
        $this->assertSame(self::COURT, $body['court_id']);
        $this->assertTrue($body['available']);
        $this->assertSame($body['subtotal_minor'] - $body['discount_minor'] + $body['service_fee_minor'], $body['total_minor']);
    }

    public function test_quote_rejects_unknown_court(): void
    {
        $threw = false;
        try {
            app(BookingsController::class)->quote($this->request([
                'court_id' => (string) Str::uuid(),
                'starts_at' => $this->slotStart(),
                'duration_minutes' => 60,
            ]));
        } catch (ApiException $e) {
            $threw = true;
            $this->assertSame(422, $e->getStatusCode());
        }
        $this->assertTrue($threw, 'Expected a 422 for an unknown court_id');
    }

    // ---- cancel re-cancel guard -----------------------------------------

    public function test_recancelling_refunded_booking_is_rejected_and_preserves_refund(): void
    {
        $id = $this->seedBooking('refunded', [
            'refund_status' => 'completed',
            'refund_amount_minor' => 1000,
        ]);

        $threw = false;
        try {
            app(BookingsController::class)->cancel($this->request([], self::BOOKER), $id);
        } catch (ApiException $e) {
            $threw = true;
            $this->assertSame(409, $e->getStatusCode());
        }

        $this->assertTrue($threw, 'Expected a 409 when cancelling a refunded booking');
        $row = DB::table('bookings')->where('id', $id)->first();
        $this->assertSame('refunded', $row->status);
        // The refund record must NOT have been wiped to null.
        $this->assertSame('completed', $row->refund_status);
        $this->assertSame(1000, (int) $row->refund_amount_minor);
        $this->assertSame(0, DB::table('notifications')->count());
    }

    public function test_recancelling_cancelled_booking_is_idempotent_noop(): void
    {
        $id = $this->seedBooking('cancelled', [
            'cancelled_at' => now()->subHour(),
            'refund_status' => 'pending_manual_review',
        ]);

        $response = app(BookingsController::class)->cancel($this->request([], self::BOOKER), $id);

        $this->assertSame(200, $response->getStatusCode());
        $row = DB::table('bookings')->where('id', $id)->first();
        $this->assertSame('cancelled', $row->status);
        // Idempotent no-op: refund_status preserved, no fresh side-effects.
        $this->assertSame('pending_manual_review', $row->refund_status);
        $this->assertSame(0, DB::table('notifications')->count());
    }

    // ---- releaseHold ownership (IDOR) -----------------------------------

    public function test_user_cannot_release_another_users_hold(): void
    {
        $holdId = (string) Str::uuid();
        DB::table('booking_holds')->insert([
            'id' => $holdId,
            'user_id' => self::OTHER,
            'court_id' => self::COURT,
            'starts_at' => now()->addDay(),
            'duration_minutes' => 60,
            'expires_at' => now()->addMinutes(5),
            'source' => 'app',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $threw = false;
        try {
            app(BookingsController::class)->releaseHold($this->request([], self::BOOKER), $holdId);
        } catch (ApiException $e) {
            $threw = true;
            $this->assertSame(404, $e->getStatusCode());
        }

        $this->assertTrue($threw, 'Expected a 404 when releasing a foreign hold');
        $this->assertTrue(DB::table('booking_holds')->where('id', $holdId)->exists());
    }

    // ---- store game_id authorisation ------------------------------------

    public function test_booking_cannot_be_attached_to_foreign_game(): void
    {
        $this->fakeBookingServices();
        $gameId = (string) Str::uuid();
        DB::table('games')->insert(['id' => $gameId, 'host_user_id' => self::OTHER, 'status' => 'open']);

        $threw = false;
        try {
            app(BookingsController::class)->store($this->request([
                'court_id' => self::COURT,
                'starts_at' => $this->slotStart(),
                'duration_minutes' => 60,
                'game_id' => $gameId,
                'idempotency_key' => 'book-foreign-game-1',
            ], self::BOOKER));
        } catch (ApiException $e) {
            $threw = true;
            $this->assertSame(403, $e->getStatusCode());
        }

        $this->assertTrue($threw, 'Expected a 403 booking for a game the user is not part of');
        $this->assertSame(0, DB::table('bookings')->count());
    }

    public function test_booking_can_be_attached_to_own_game(): void
    {
        $this->fakeBookingServices();
        $gameId = (string) Str::uuid();
        DB::table('games')->insert(['id' => $gameId, 'host_user_id' => self::BOOKER, 'status' => 'open']);

        $response = app(BookingsController::class)->store($this->request([
            'court_id' => self::COURT,
            'starts_at' => $this->slotStart(),
            'duration_minutes' => 60,
            'game_id' => $gameId,
            'idempotency_key' => 'book-own-game-1',
        ], self::BOOKER));

        $this->assertSame(201, $response->getStatusCode());
        $row = DB::table('bookings')->where('user_id', self::BOOKER)->first();
        $this->assertNotNull($row);
        $this->assertSame($gameId, $row->game_id);
    }

    // ---- helpers ---------------------------------------------------------

    private function fakeBookingServices(): void
    {
        $this->mock(MembershipService::class, function ($m): void {
            $m->shouldReceive('ensureCanBook')->andReturnNull();
        });
        $this->mock(TransactionalMailService::class, function ($m): void {
            $m->shouldReceive('bookingConfirmed')->andReturnNull();
            $m->shouldReceive('ownerNewBooking')->andReturnNull();
        });
    }

    private function slotStart(): string
    {
        return now('Asia/Baku')->addDay()->setTime(10, 0)->utc()->toIso8601String();
    }

    private function seedBooking(string $status, array $extra = []): string
    {
        $id = (string) Str::uuid();
        DB::table('bookings')->insert(array_merge([
            'id' => $id,
            'court_id' => self::COURT,
            'user_id' => self::BOOKER,
            'starts_at' => now()->addDay(),
            'duration_minutes' => 60,
            'subtotal_minor' => 1000,
            'total_minor' => 1000,
            'currency' => 'AZN',
            'status' => $status,
            'source' => 'app',
            'payment_method' => 'onsite',
            'idempotency_key' => 'booking-'.$id,
            'created_at' => now(),
            'updated_at' => now(),
        ], $extra));

        return $id;
    }

    private function request(array $body, ?string $userId = null): Request
    {
        $request = Request::create('/api/v1/bookings', 'POST', $body);
        if ($userId !== null) {
            $user = new User;
            $user->forceFill(['id' => $userId, 'admin_role' => null, 'venue_id' => null]);
            $request->attributes->set('auth_user', $user);
        }

        return $request;
    }
}
