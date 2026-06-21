<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\BookingsController;
use App\Models\User;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Guards the markPaid() status machine: a booking may only be marked paid from
 * pending_payment/partially_paid; terminal states (cancelled/refunded/failed)
 * must not be resurrectable, and re-marking an already-paid booking is an
 * idempotent no-op that does not double-fire the "payment confirmed" side-effect.
 */
class BookingMarkPaidGuardTest extends TestCase
{
    private const ADMIN = '00000000-0000-4000-8000-000000000401';

    private const BOOKER = '00000000-0000-4000-8000-000000000402';

    private const SPORT = '00000000-0000-4000-8000-000000000403';

    private const VENUE = '00000000-0000-4000-8000-000000000404';

    private const COURT = '00000000-0000-4000-8000-000000000405';

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
        foreach (['notifications', 'payment_splits', 'bookings', 'courts', 'venues', 'sports'] as $table) {
            Schema::dropIfExists($table);
        }

        parent::tearDown();
    }

    public function test_marking_cancelled_booking_as_paid_is_rejected(): void
    {
        $id = $this->seedBooking('cancelled');

        $threw = false;
        try {
            app(BookingsController::class)->markPaid($this->adminRequest(), $id);
        } catch (ApiException $e) {
            $threw = true;
            $this->assertSame(409, $e->getStatusCode());
        }

        $this->assertTrue($threw, 'Expected a 409 conflict when marking a cancelled booking paid');
        $this->assertSame('cancelled', DB::table('bookings')->where('id', $id)->value('status'));
        $this->assertNull(DB::table('bookings')->where('id', $id)->value('paid_at'));
        $this->assertSame(0, DB::table('notifications')->count());
    }

    public function test_marking_pending_payment_booking_as_paid_succeeds(): void
    {
        $id = $this->seedBooking('pending_payment');

        $response = app(BookingsController::class)->markPaid($this->adminRequest(['payment_method' => 'cash']), $id);

        $this->assertSame(200, $response->getStatusCode());
        $row = DB::table('bookings')->where('id', $id)->first();
        $this->assertSame('paid', $row->status);
        $this->assertNotNull($row->paid_at);
        $this->assertSame('cash', $row->payment_method);
        // Booker received exactly one "payment confirmed" notification.
        $this->assertSame(1, DB::table('notifications')->where('user_id', self::BOOKER)->count());
    }

    public function test_marking_already_paid_booking_is_idempotent(): void
    {
        $id = $this->seedBooking('paid');
        DB::table('bookings')->where('id', $id)->update(['paid_at' => now()->subDay(), 'payment_method' => 'manual']);
        $paidAtBefore = DB::table('bookings')->where('id', $id)->value('paid_at');

        $response = app(BookingsController::class)->markPaid($this->adminRequest(), $id);

        $this->assertSame(200, $response->getStatusCode());
        $row = DB::table('bookings')->where('id', $id)->first();
        $this->assertSame('paid', $row->status);
        // No-op: paid_at untouched and no duplicate notification fired.
        $this->assertSame($paidAtBefore, $row->paid_at);
        $this->assertSame(0, DB::table('notifications')->count());
    }

    private function seedBooking(string $status): string
    {
        $id = (string) \Illuminate\Support\Str::uuid();
        DB::table('bookings')->insert([
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
        ]);

        return $id;
    }

    private function adminRequest(array $body = []): Request
    {
        $request = Request::create('/api/v1/bookings/x/mark-paid', 'POST', $body);
        $user = new User;
        $user->forceFill([
            'id' => self::ADMIN,
            'admin_role' => 'admin',
            'display_name' => 'Admin',
            'email' => 'admin@example.com',
        ]);
        $request->attributes->set('auth_user', $user);

        return $request;
    }
}
