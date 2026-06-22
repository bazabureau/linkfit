<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\BookingsController;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Waitlist promotion on cancellation: when a booking is cancelled and its slot
 * frees, the earliest (FIFO by created_at) ACTIVE waitlist entry overlapping
 * that slot is flipped to `notified` and that user is notified. With no
 * matching entry the cancel is unchanged (booker still notified). Only ONE
 * entry is promoted per freed slot.
 */
class WaitlistPromotionTest extends TestCase
{
    private const BOOKER = '00000000-0000-4000-8000-000000000501';

    private const WAITER_ONE = '00000000-0000-4000-8000-000000000502';

    private const WAITER_TWO = '00000000-0000-4000-8000-000000000503';

    private const SPORT = '00000000-0000-4000-8000-000000000504';

    private const VENUE = '00000000-0000-4000-8000-000000000505';

    private const COURT = '00000000-0000-4000-8000-000000000506';

    private const OTHER_COURT = '00000000-0000-4000-8000-000000000507';

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
        // The cancellation mail path (notifyBookingCancelled) joins users, so the
        // table must exist even though no email is actually delivered in tests.
        Schema::create('users', function ($table): void {
            $table->string('id')->primary();
            $table->string('email')->nullable();
            $table->string('display_name')->nullable();
            $table->string('admin_role')->nullable();
            $table->string('venue_id')->nullable();
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
        Schema::create('payment_splits', function ($table): void {
            $table->string('id')->primary();
            $table->string('booking_id');
            $table->string('user_id')->nullable();
            $table->integer('amount_minor')->default(0);
            $table->string('status')->nullable();
            $table->string('external_ref')->nullable();
        });
        Schema::create('booking_waitlist_entries', function ($table): void {
            $table->string('id')->primary();
            $table->string('user_id');
            $table->string('court_id');
            $table->timestamp('starts_at');
            $table->unsignedSmallInteger('duration_minutes');
            $table->string('status')->default('active');
            $table->timestamp('notified_at')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->timestamps();
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
        Schema::create('push_notification_jobs', function ($table): void {
            $table->string('id')->primary();
            $table->string('user_id');
            $table->string('type');
            $table->string('title');
            $table->text('body');
            $table->text('payload')->nullable();
            $table->string('status')->default('pending');
            $table->timestamp('available_at')->nullable();
            $table->timestamps();
        });

        DB::table('sports')->insert(['id' => self::SPORT, 'slug' => 'padel', 'name' => 'Padel']);
        DB::table('venues')->insert(['id' => self::VENUE, 'name' => 'Venue', 'status' => 'published', 'cancellation_window_minutes' => 120]);
        DB::table('courts')->insert([
            ['id' => self::COURT, 'venue_id' => self::VENUE, 'sport_id' => self::SPORT, 'name' => 'Court 1', 'status' => 'active'],
            ['id' => self::OTHER_COURT, 'venue_id' => self::VENUE, 'sport_id' => self::SPORT, 'name' => 'Court 2', 'status' => 'active'],
        ]);
        DB::table('users')->insert([
            ['id' => self::BOOKER, 'email' => 'booker@example.com', 'display_name' => 'Booker'],
            ['id' => self::WAITER_ONE, 'email' => 'waiter1@example.com', 'display_name' => 'Waiter One'],
            ['id' => self::WAITER_TWO, 'email' => 'waiter2@example.com', 'display_name' => 'Waiter Two'],
        ]);
    }

    protected function tearDown(): void
    {
        foreach ([
            'push_notification_jobs', 'notifications', 'booking_waitlist_entries',
            'payment_splits', 'bookings', 'users', 'courts', 'venues', 'sports',
        ] as $table) {
            Schema::dropIfExists($table);
        }

        parent::tearDown();
    }

    public function test_cancelling_promotes_active_waitlist_entry_and_notifies_user(): void
    {
        $startsAt = now()->addDay()->startOfHour();
        $bookingId = $this->seedBooking($startsAt);
        $entryId = $this->seedWaitlistEntry(self::WAITER_ONE, $startsAt, 60, 'active', now()->subMinutes(10));

        $response = app(BookingsController::class)->cancel($this->bookerRequest(), $bookingId);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame('cancelled', DB::table('bookings')->where('id', $bookingId)->value('status'));

        // Earliest active entry flipped to notified with notified_at stamped.
        $entry = DB::table('booking_waitlist_entries')->where('id', $entryId)->first();
        $this->assertSame('notified', $entry->status);
        $this->assertNotNull($entry->notified_at);

        // Booker notified of the cancellation AND the waiter notified of the slot.
        $this->assertSame(1, DB::table('notifications')->where('user_id', self::BOOKER)->count());
        $this->assertSame(1, DB::table('notifications')->where('user_id', self::WAITER_ONE)->count());
        $waiterNote = DB::table('notifications')->where('user_id', self::WAITER_ONE)->first();
        $this->assertStringContainsString('waitlisted is now available', $waiterNote->body);
        // Push fan-out mirrors the in-app notification.
        $this->assertSame(1, DB::table('push_notification_jobs')->where('user_id', self::WAITER_ONE)->count());
    }

    public function test_cancelling_with_no_matching_waitlist_entry_is_unchanged(): void
    {
        $startsAt = now()->addDay()->startOfHour();
        $bookingId = $this->seedBooking($startsAt);
        // An active entry on a DIFFERENT court must not be promoted.
        $otherEntryId = $this->seedWaitlistEntry(self::WAITER_ONE, $startsAt, 60, 'active', now()->subMinutes(10), self::OTHER_COURT);

        $response = app(BookingsController::class)->cancel($this->bookerRequest(), $bookingId);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame('cancelled', DB::table('bookings')->where('id', $bookingId)->value('status'));

        // Non-matching entry untouched.
        $other = DB::table('booking_waitlist_entries')->where('id', $otherEntryId)->first();
        $this->assertSame('active', $other->status);
        $this->assertNull($other->notified_at);

        // Booker still notified exactly as before; nobody else notified.
        $this->assertSame(1, DB::table('notifications')->where('user_id', self::BOOKER)->count());
        $this->assertSame(0, DB::table('notifications')->where('user_id', self::WAITER_ONE)->count());
        $this->assertSame(0, DB::table('push_notification_jobs')->where('user_id', self::WAITER_ONE)->count());
    }

    public function test_only_the_earliest_waitlist_entry_is_promoted(): void
    {
        $startsAt = now()->addDay()->startOfHour();
        $bookingId = $this->seedBooking($startsAt);
        // Two active entries for the same slot; WAITER_ONE joined first.
        $firstId = $this->seedWaitlistEntry(self::WAITER_ONE, $startsAt, 60, 'active', now()->subMinutes(30));
        $secondId = $this->seedWaitlistEntry(self::WAITER_TWO, $startsAt, 60, 'active', now()->subMinutes(5));

        app(BookingsController::class)->cancel($this->bookerRequest(), $bookingId);

        // Only the FIFO-first entry is promoted; the later one stays active.
        $this->assertSame('notified', DB::table('booking_waitlist_entries')->where('id', $firstId)->value('status'));
        $this->assertSame('active', DB::table('booking_waitlist_entries')->where('id', $secondId)->value('status'));

        // Exactly one waiter notified (the earliest); the later waiter gets none.
        $this->assertSame(1, DB::table('notifications')->where('user_id', self::WAITER_ONE)->count());
        $this->assertSame(0, DB::table('notifications')->where('user_id', self::WAITER_TWO)->count());
        $this->assertSame(1, DB::table('push_notification_jobs')->where('user_id', self::WAITER_ONE)->count());
        $this->assertSame(0, DB::table('push_notification_jobs')->where('user_id', self::WAITER_TWO)->count());
    }

    private function seedBooking($startsAt): string
    {
        $id = (string) Str::uuid();
        DB::table('bookings')->insert([
            'id' => $id,
            'court_id' => self::COURT,
            'user_id' => self::BOOKER,
            'starts_at' => $startsAt,
            'duration_minutes' => 60,
            'subtotal_minor' => 1000,
            'total_minor' => 1000,
            'currency' => 'AZN',
            'status' => 'pending_payment',
            'source' => 'app',
            'payment_method' => 'onsite',
            'idempotency_key' => 'booking-'.$id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $id;
    }

    private function seedWaitlistEntry(string $userId, $startsAt, int $duration, string $status, $createdAt, ?string $courtId = null): string
    {
        $id = (string) Str::uuid();
        DB::table('booking_waitlist_entries')->insert([
            'id' => $id,
            'user_id' => $userId,
            'court_id' => $courtId ?? self::COURT,
            'starts_at' => $startsAt,
            'duration_minutes' => $duration,
            'status' => $status,
            'created_at' => $createdAt,
            'updated_at' => $createdAt,
        ]);

        return $id;
    }

    private function bookerRequest(): Request
    {
        $request = Request::create('/api/v1/bookings/x/cancel', 'POST', []);
        $user = new User;
        $user->forceFill(['id' => self::BOOKER]);
        $request->attributes->set('auth_user', $user);

        return $request;
    }
}
