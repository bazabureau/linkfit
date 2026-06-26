<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\PartnerOpsController;
use App\Models\User;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Hardening coverage for partner booking refunds + authorization. The DB enforces
 * refund_amount_minor <= total_minor (CHECK bookings_refund_le_total); the
 * single refund/cancel/update controller paths must surface an over-refund as a
 * clean 422 rather than letting it become a constraint-violation 500. Also covers
 * the 'bookings' permission gate and cross-venue (IDOR) scoping.
 *
 * Drives the controller directly with a synthetic Request (mirrors
 * LessonStaffCancelTest) so in-controller authz/validation runs without the JWT
 * stack. The over-refund assertions short-circuit before any DB write or mail.
 */
class PartnerOpsHardeningTest extends TestCase
{
    private const OWNER_A = '00000000-0000-4000-8000-0000000000a1';

    private const STAFF_A = '00000000-0000-4000-8000-0000000000a2';

    private const OWNER_B = '00000000-0000-4000-8000-0000000000b1';

    private const VENUE_A = '00000000-0000-4000-8000-0000000000aa';

    private const VENUE_B = '00000000-0000-4000-8000-0000000000bb';

    private const COURT_A = '00000000-0000-4000-8000-0000000000ac';

    private const COURT_B = '00000000-0000-4000-8000-0000000000bc';

    private const BOOKING_A = '00000000-0000-4000-8000-0000000000ad';

    private const BOOKING_B = '00000000-0000-4000-8000-0000000000bd';

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
        DB::purge('sqlite');
        DB::reconnect('sqlite');

        Schema::create('users', function ($table): void {
            $table->string('id')->primary();
            $table->string('email')->unique();
            $table->string('display_name');
            $table->string('admin_role')->nullable();
            $table->string('venue_id')->nullable();
            $table->string('staff_title')->nullable();
            $table->text('staff_permissions')->nullable();
            $table->timestamp('deleted_at')->nullable();
            $table->timestamps();
        });
        Schema::create('venues', function ($table): void {
            $table->string('id')->primary();
            $table->string('name');
            $table->string('owner_user_id')->nullable();
            $table->text('opening_hours')->nullable();
            $table->integer('booking_slot_minutes')->nullable();
            $table->integer('min_booking_minutes')->nullable();
            $table->integer('max_booking_minutes')->nullable();
        });
        Schema::create('courts', function ($table): void {
            $table->string('id')->primary();
            $table->string('venue_id');
            $table->string('name');
            $table->integer('hourly_price_minor')->default(0);
            $table->string('currency')->default('AZN');
        });
        Schema::create('bookings', function ($table): void {
            $table->string('id')->primary();
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
            $table->string('internal_note')->nullable();
            $table->string('refund_status')->nullable();
            $table->integer('refund_amount_minor')->nullable();
            $table->string('refund_note')->nullable();
            $table->dateTime('refunded_at')->nullable();
            $table->dateTime('paid_at')->nullable();
            $table->dateTime('cancelled_at')->nullable();
            $table->string('cancelled_by_user_id')->nullable();
            $table->string('cancellation_reason')->nullable();
            $table->dateTime('rescheduled_at')->nullable();
            $table->dateTime('no_show_at')->nullable();
            $table->string('no_show_marked_by_user_id')->nullable();
            $table->dateTime('checked_in_at')->nullable();
            $table->string('checked_in_by_user_id')->nullable();
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

        DB::table('users')->insert([
            ['id' => self::OWNER_A, 'email' => 'owner-a@linkfit.az', 'display_name' => 'Owner A', 'admin_role' => 'partner', 'venue_id' => self::VENUE_A, 'staff_permissions' => null, 'created_at' => now(), 'updated_at' => now()],
            ['id' => self::STAFF_A, 'email' => 'staff-a@linkfit.az', 'display_name' => 'Staff A', 'admin_role' => 'partner', 'venue_id' => self::VENUE_A, 'staff_permissions' => json_encode(['bookings' => false]), 'created_at' => now(), 'updated_at' => now()],
            ['id' => self::OWNER_B, 'email' => 'owner-b@linkfit.az', 'display_name' => 'Owner B', 'admin_role' => 'partner', 'venue_id' => self::VENUE_B, 'staff_permissions' => null, 'created_at' => now(), 'updated_at' => now()],
        ]);
        DB::table('venues')->insert([
            ['id' => self::VENUE_A, 'name' => 'Venue A', 'owner_user_id' => self::OWNER_A],
            ['id' => self::VENUE_B, 'name' => 'Venue B', 'owner_user_id' => self::OWNER_B],
        ]);
        DB::table('courts')->insert([
            ['id' => self::COURT_A, 'venue_id' => self::VENUE_A, 'name' => 'Court A1', 'hourly_price_minor' => 10000, 'currency' => 'AZN'],
            ['id' => self::COURT_B, 'venue_id' => self::VENUE_B, 'name' => 'Court B1', 'hourly_price_minor' => 10000, 'currency' => 'AZN'],
        ]);
        $this->seedBooking(self::BOOKING_A, self::COURT_A);
        $this->seedBooking(self::BOOKING_B, self::COURT_B);
    }

    protected function tearDown(): void
    {
        foreach (['audit_log', 'bookings', 'courts', 'venues', 'users'] as $table) {
            Schema::dropIfExists($table);
        }

        parent::tearDown();
    }

    // ---- refund cap (DB CHECK parity → 422 not 500) --------------------------

    public function test_refund_booking_rejects_amount_exceeding_total(): void
    {
        $this->expectStatus(422, fn () => app(PartnerOpsController::class)->refundBooking($this->request(self::OWNER_A, [
            'refund_amount_minor' => 20000,
        ]), self::BOOKING_A));

        // No write happened: the refund fields stay untouched.
        $this->assertNull(DB::table('bookings')->where('id', self::BOOKING_A)->value('refund_amount_minor'));
        $this->assertSame('paid', DB::table('bookings')->where('id', self::BOOKING_A)->value('status'));
    }

    public function test_cancel_booking_rejects_refund_exceeding_total(): void
    {
        $this->expectStatus(422, fn () => app(PartnerOpsController::class)->cancelBooking($this->request(self::OWNER_A, [
            'refund_amount_minor' => 20000,
        ]), self::BOOKING_A));

        $this->assertSame('paid', DB::table('bookings')->where('id', self::BOOKING_A)->value('status'));
    }

    public function test_update_booking_rejects_refund_exceeding_total(): void
    {
        $this->expectStatus(422, fn () => app(PartnerOpsController::class)->updateBooking($this->request(self::OWNER_A, [
            'refund_amount_minor' => 20000,
        ]), self::BOOKING_A));

        $this->assertNull(DB::table('bookings')->where('id', self::BOOKING_A)->value('refund_amount_minor'));
    }

    public function test_update_booking_allows_refund_within_total(): void
    {
        $response = app(PartnerOpsController::class)->updateBooking($this->request(self::OWNER_A, [
            'refund_amount_minor' => 5000,
        ]), self::BOOKING_A);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame(5000, (int) DB::table('bookings')->where('id', self::BOOKING_A)->value('refund_amount_minor'));
    }

    // ---- authorization -------------------------------------------------------

    public function test_refund_requires_bookings_permission(): void
    {
        // Staff A explicitly lacks the 'bookings' permission → 403.
        $this->expectStatus(403, fn () => app(PartnerOpsController::class)->refundBooking($this->request(self::STAFF_A, [
            'refund_amount_minor' => 1000,
        ]), self::BOOKING_A));
    }

    public function test_cancel_booking_from_other_venue_is_404(): void
    {
        // Owner A may not act on a booking that belongs to venue B (IDOR).
        $this->expectStatus(404, fn () => app(PartnerOpsController::class)->cancelBooking($this->request(self::OWNER_A, []), self::BOOKING_B));

        $this->assertSame('paid', DB::table('bookings')->where('id', self::BOOKING_B)->value('status'));
    }

    public function test_non_partner_user_is_forbidden(): void
    {
        DB::table('users')->insert([
            'id' => '00000000-0000-4000-8000-0000000000ff', 'email' => 'player@linkfit.az',
            'display_name' => 'Player', 'admin_role' => null, 'venue_id' => null,
            'created_at' => now(), 'updated_at' => now(),
        ]);

        $this->expectStatus(403, fn () => app(PartnerOpsController::class)->booking($this->request('00000000-0000-4000-8000-0000000000ff', []), self::BOOKING_A));
    }

    // ---- helpers -------------------------------------------------------------

    private function expectStatus(int $status, callable $fn): void
    {
        try {
            $fn();
            $this->fail("Expected ApiException with status {$status}.");
        } catch (ApiException $e) {
            $this->assertSame($status, $e->getStatusCode());
        }
    }

    private function seedBooking(string $id, string $courtId): void
    {
        DB::table('bookings')->insert([
            'id' => $id,
            'court_id' => $courtId,
            'user_id' => null,
            'starts_at' => now()->addDay(),
            'duration_minutes' => 60,
            'total_minor' => 10000,
            'currency' => 'AZN',
            'status' => 'paid',
            'source' => 'owner_manual',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function request(string $userId, array $body): Request
    {
        $request = Request::create('/api/v1/partner/bookings', 'POST', $body);
        $request->attributes->set('auth_user', User::query()->findOrFail($userId));

        return $request;
    }
}
