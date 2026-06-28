<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\AdminOpsController;
use App\Models\User;
use App\Services\Mail\TransactionalMailService;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Hardening for the admin booking refund/cancel paths. The DB enforces
 * refund_amount_minor <= total_minor (CHECK bookings_refund_le_total), so an
 * over-refund must surface as a clean 422 rather than a constraint-violation 500
 * (parity with the partner path). cancelBooking must also 404 — not 500 — when the
 * target booking does not exist.
 */
class AdminOpsBookingRefundTest extends TestCase
{
    private const ADMIN = '00000000-0000-4000-8000-0000000000c1';

    private const VENUE = '00000000-0000-4000-8000-0000000000ca';

    private const COURT = '00000000-0000-4000-8000-0000000000cc';

    private const BOOKING = '00000000-0000-4000-8000-0000000000cd';

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
        DB::purge('sqlite');
        DB::reconnect('sqlite');

        Schema::create('users', function ($table): void {
            $table->string('id')->primary();
            $table->string('email')->nullable();
            $table->string('display_name')->nullable();
            $table->string('admin_role')->nullable();
            $table->string('venue_id')->nullable();
            $table->text('staff_permissions')->nullable();
            $table->timestamp('deleted_at')->nullable();
            $table->timestamps();
        });
        Schema::create('venues', function ($table): void {
            $table->string('id')->primary();
            $table->string('name');
        });
        Schema::create('courts', function ($table): void {
            $table->string('id')->primary();
            $table->string('venue_id');
            $table->string('name');
            $table->string('currency')->default('AZN');
        });
        Schema::create('bookings', function ($table): void {
            $table->string('id')->primary();
            $table->string('game_id')->nullable();
            $table->string('court_id');
            $table->string('user_id')->nullable();
            $table->dateTime('starts_at');
            $table->integer('duration_minutes');
            $table->integer('total_minor')->default(0);
            $table->string('currency')->default('AZN');
            $table->string('status');
            $table->string('source')->nullable();
            $table->string('payment_method')->nullable();
            $table->string('payment_note')->nullable();
            $table->string('customer_name')->nullable();
            $table->string('customer_email')->nullable();
            $table->string('idempotency_key')->nullable();
            $table->string('external_ref')->nullable();
            $table->string('internal_note')->nullable();
            $table->dateTime('paid_at')->nullable();
            $table->dateTime('cancelled_at')->nullable();
            $table->string('cancelled_by_user_id')->nullable();
            $table->string('cancellation_reason')->nullable();
            $table->dateTime('rescheduled_at')->nullable();
            $table->dateTime('no_show_at')->nullable();
            $table->string('no_show_marked_by_user_id')->nullable();
            $table->dateTime('checked_in_at')->nullable();
            $table->string('checked_in_by_user_id')->nullable();
            $table->string('refund_status')->nullable();
            $table->integer('refund_amount_minor')->nullable();
            $table->string('refund_note')->nullable();
            $table->dateTime('refunded_at')->nullable();
            $table->timestamps();
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
            $table->text('body');
            $table->text('payload')->nullable();
            $table->timestamp('read_at')->nullable();
            $table->timestamp('created_at')->nullable();
        });

        DB::table('users')->insert([
            'id' => self::ADMIN, 'email' => 'admin@linkfit.az', 'display_name' => 'Admin',
            'admin_role' => 'admin', 'venue_id' => null, 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('venues')->insert(['id' => self::VENUE, 'name' => 'Venue']);
        DB::table('courts')->insert(['id' => self::COURT, 'venue_id' => self::VENUE, 'name' => 'Court 1', 'currency' => 'AZN']);
        DB::table('bookings')->insert([
            'id' => self::BOOKING,
            'court_id' => self::COURT,
            'user_id' => null,
            'starts_at' => now()->addDay(),
            'duration_minutes' => 60,
            'total_minor' => 10000,
            'currency' => 'AZN',
            'status' => 'paid',
            'source' => 'owner_manual',
            'idempotency_key' => 'admin-refund-booking',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->mock(TransactionalMailService::class, function ($m): void {
            $m->shouldReceive('bookingRefundUpdated')->andReturnNull();
            $m->shouldReceive('bookingCancelled')->andReturnNull();
        });
    }

    protected function tearDown(): void
    {
        foreach (['notifications', 'audit_log', 'bookings', 'courts', 'venues', 'users'] as $table) {
            Schema::dropIfExists($table);
        }

        parent::tearDown();
    }

    public function test_admin_refund_rejects_amount_exceeding_total(): void
    {
        $this->expectStatus(422, fn () => app(AdminOpsController::class)->refundBooking($this->request([
            'refund_amount_minor' => 20000,
        ]), self::BOOKING));

        // Short-circuited before any write.
        $this->assertNull(DB::table('bookings')->where('id', self::BOOKING)->value('refund_amount_minor'));
        $this->assertSame('paid', DB::table('bookings')->where('id', self::BOOKING)->value('status'));
    }

    public function test_admin_cancel_rejects_refund_exceeding_total(): void
    {
        $this->expectStatus(422, fn () => app(AdminOpsController::class)->cancelBooking($this->request([
            'refund_amount_minor' => 20000,
        ]), self::BOOKING));

        $this->assertSame('paid', DB::table('bookings')->where('id', self::BOOKING)->value('status'));
    }

    public function test_admin_cancel_missing_booking_returns_404(): void
    {
        $this->expectStatus(404, fn () => app(AdminOpsController::class)->cancelBooking($this->request([
            'reason' => 'no-op',
        ]), '00000000-0000-4000-8000-0000000000ee'));
    }

    public function test_admin_refund_allows_amount_within_total(): void
    {
        $response = app(AdminOpsController::class)->refundBooking($this->request([
            'refund_amount_minor' => 5000,
        ]), self::BOOKING);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame(5000, (int) DB::table('bookings')->where('id', self::BOOKING)->value('refund_amount_minor'));
        $this->assertSame('refunded', DB::table('bookings')->where('id', self::BOOKING)->value('status'));
    }

    private function expectStatus(int $status, callable $fn): void
    {
        try {
            $fn();
            $this->fail("Expected ApiException with status {$status}.");
        } catch (ApiException $e) {
            $this->assertSame($status, $e->getStatusCode());
        }
    }

    private function request(array $body): Request
    {
        $request = Request::create('/api/v1/admin/bookings', 'POST', $body);
        $request->attributes->set('auth_user', User::query()->findOrFail(self::ADMIN));

        return $request;
    }
}
