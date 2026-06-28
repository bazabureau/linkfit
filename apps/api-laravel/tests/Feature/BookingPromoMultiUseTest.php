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
 * A promo code with per_user_limit >= 2 must be redeemable that many times by the
 * SAME user. In prod a stray UNIQUE index (promo_code_id, user_id) — dropped by
 * migration 2026_06_29_000001 — capped every user at one redemption, so the 2nd
 * booking raised a 23505 that the store path misread as an idempotency replay
 * ("Duplicate booking request"). The per-user limit is enforced purely in code
 * (promoDiscount counts existing redemptions under a promo-row lock), so this
 * suite asserts the count logic alone allows up to the limit and blocks beyond it.
 *
 * The in-memory sqlite schema deliberately omits that unique index (mirroring the
 * post-migration prod state); the test therefore exercises the controller's own
 * per_user_limit enforcement.
 */
class BookingPromoMultiUseTest extends TestCase
{
    private const BOOKER = '00000000-0000-4000-8000-000000000701';

    private const SPORT = '00000000-0000-4000-8000-000000000703';

    private const VENUE = '00000000-0000-4000-8000-000000000704';

    private const COURT = '00000000-0000-4000-8000-000000000705';

    private const PROMO = '00000000-0000-4000-8000-000000000706';

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
        Schema::create('promo_codes', function ($table): void {
            $table->string('id')->primary();
            $table->string('code');
            $table->string('title')->nullable();
            $table->string('status')->default('active');
            $table->string('discount_type')->default('fixed');
            $table->integer('discount_value')->default(0);
            $table->string('currency', 3)->nullable();
            $table->integer('min_amount_minor')->default(0);
            $table->integer('max_discount_minor')->nullable();
            $table->integer('max_redemptions')->nullable();
            $table->integer('per_user_limit')->default(1);
            $table->timestamp('starts_at')->nullable();
            $table->timestamp('ends_at')->nullable();
            $table->timestamps();
        });
        // Mirrors prod AFTER migration 2026_06_29_000001: NO (promo_code_id, user_id)
        // unique index, so per_user_limit > 1 is allowed.
        Schema::create('booking_promo_redemptions', function ($table): void {
            $table->string('id')->primary();
            $table->string('promo_code_id');
            $table->string('booking_id')->unique();
            $table->string('user_id');
            $table->integer('discount_minor')->default(0);
            $table->timestamp('created_at')->nullable();
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
        DB::table('promo_codes')->insert([
            'id' => self::PROMO,
            'code' => 'MULTI2',
            'title' => 'Multi use',
            'status' => 'active',
            'discount_type' => 'fixed',
            'discount_value' => 100,
            'currency' => 'AZN',
            'min_amount_minor' => 0,
            'per_user_limit' => 2,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->mock(MembershipService::class, function ($m): void {
            $m->shouldReceive('ensureCanBook')->andReturnNull();
        });
        $this->mock(TransactionalMailService::class, function ($m): void {
            $m->shouldReceive('bookingConfirmed')->andReturnNull();
            $m->shouldReceive('ownerNewBooking')->andReturnNull();
        });
    }

    protected function tearDown(): void
    {
        foreach ([
            'booking_promo_redemptions', 'promo_codes', 'users', 'notifications', 'payment_splits',
            'court_blocks', 'booking_holds', 'bookings', 'courts', 'venues', 'sports',
        ] as $table) {
            Schema::dropIfExists($table);
        }

        parent::tearDown();
    }

    public function test_multi_use_promo_allows_two_redemptions_then_blocks_third(): void
    {
        // First redemption of a per_user_limit=2 code → succeeds.
        $first = $this->book($this->slotStart(10), 'promo-multi-1');
        $this->assertSame(201, $first->getStatusCode());

        // Second redemption by the SAME user → must also succeed (the dropped
        // unique index used to break this with a misleading 409).
        $second = $this->book($this->slotStart(12), 'promo-multi-2');
        $this->assertSame(201, $second->getStatusCode());

        $this->assertSame(2, DB::table('bookings')->count());
        $this->assertSame(2, DB::table('booking_promo_redemptions')
            ->where('promo_code_id', self::PROMO)->where('user_id', self::BOOKER)->count());
        // Each booking recorded the 100-minor discount.
        $this->assertSame(900, (int) DB::table('bookings')->orderBy('starts_at')->value('total_minor'));

        // Third redemption → now over per_user_limit → clean 409, no booking.
        $threw = false;
        try {
            $this->book($this->slotStart(14), 'promo-multi-3');
        } catch (ApiException $e) {
            $threw = true;
            $this->assertSame(409, $e->getStatusCode());
            $this->assertStringContainsStringIgnoringCase('already used', $e->getMessage());
        }
        $this->assertTrue($threw, 'Expected a 409 once per_user_limit is exhausted');
        $this->assertSame(2, DB::table('bookings')->count());
    }

    private function book(string $startsAt, string $idempotencyKey): \Illuminate\Http\JsonResponse
    {
        return app(BookingsController::class)->store($this->request([
            'court_id' => self::COURT,
            'starts_at' => $startsAt,
            'duration_minutes' => 60,
            'promo_code' => 'MULTI2',
            'idempotency_key' => $idempotencyKey,
        ], self::BOOKER));
    }

    private function slotStart(int $hour): string
    {
        return now('Asia/Baku')->addDay()->setTime($hour, 0)->utc()->toIso8601String();
    }

    private function request(array $body, string $userId): Request
    {
        $request = Request::create('/api/v1/bookings', 'POST', $body);
        $user = new User;
        $user->forceFill(['id' => $userId, 'admin_role' => null, 'venue_id' => null]);
        $request->attributes->set('auth_user', $user);

        return $request;
    }
}
