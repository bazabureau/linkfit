<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\BookingsController;
use App\Models\User;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class BookingHoldAtomicityTest extends TestCase
{
    private const USER_ONE = '00000000-0000-4000-8000-000000000301';

    private const USER_TWO = '00000000-0000-4000-8000-000000000302';

    private const SPORT = '00000000-0000-4000-8000-000000000303';

    private const VENUE = '00000000-0000-4000-8000-000000000304';

    private const COURT = '00000000-0000-4000-8000-000000000305';

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
            $table->string('court_id');
            $table->string('user_id')->nullable();
            $table->timestamp('starts_at');
            $table->unsignedSmallInteger('duration_minutes');
            $table->string('status');
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

        DB::table('sports')->insert(['id' => self::SPORT, 'slug' => 'padel', 'name' => 'Padel']);
        DB::table('venues')->insert(['id' => self::VENUE, 'name' => 'Venue', 'status' => 'published']);
        DB::table('courts')->insert([
            'id' => self::COURT,
            'venue_id' => self::VENUE,
            'sport_id' => self::SPORT,
            'name' => 'Court 1',
            'status' => 'active',
        ]);
    }

    protected function tearDown(): void
    {
        foreach (['court_blocks', 'booking_holds', 'bookings', 'courts', 'venues', 'sports'] as $table) {
            Schema::dropIfExists($table);
        }

        parent::tearDown();
    }

    public function test_second_hold_for_same_court_slot_conflicts(): void
    {
        $controller = app(BookingsController::class);
        $startsAt = now('Asia/Baku')->addDay()->setTime(10, 0)->utc()->toIso8601String();

        $first = $controller->createHold($this->requestFor(self::USER_ONE, [
            'court_id' => self::COURT,
            'starts_at' => $startsAt,
            'duration_minutes' => 60,
            'idempotency_key' => 'hold-key-1',
        ]));

        $this->assertSame(201, $first->getStatusCode());

        $this->expectException(ApiException::class);
        $this->expectExceptionMessage('Court is temporarily held for this time');

        $controller->createHold($this->requestFor(self::USER_TWO, [
            'court_id' => self::COURT,
            'starts_at' => $startsAt,
            'duration_minutes' => 60,
            'idempotency_key' => 'hold-key-2',
        ]));
    }

    private function requestFor(string $userId, array $body): Request
    {
        $request = Request::create('/api/v1/booking-holds', 'POST', $body);
        $user = new User;
        $user->forceFill(['id' => $userId]);
        $request->attributes->set('auth_user', $user);

        return $request;
    }
}
