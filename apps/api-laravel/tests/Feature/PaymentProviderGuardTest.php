<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\PaymentsController;
use App\Models\User;
use App\Support\ApiException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class PaymentProviderGuardTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');
        DB::purge('sqlite');
        DB::reconnect('sqlite');

        Schema::create('bookings', function ($table): void {
            $table->string('id')->primary();
            $table->string('user_id');
            $table->integer('total_minor');
            $table->string('currency', 3)->default('AZN');
            $table->string('status')->default('pending');
            $table->timestamp('paid_at')->nullable();
            $table->string('external_ref')->nullable();
            $table->timestamp('updated_at')->nullable();
        });
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('bookings');

        parent::tearDown();
    }

    public function test_booking_payment_intent_does_not_issue_fake_secret_when_payments_are_disabled(): void
    {
        config()->set('membership.payments_enabled', false);
        config()->set('membership.payment_provider', null);
        $this->insertBooking();

        try {
            app(PaymentsController::class)->bookingIntent($this->requestForUser('user-1'), 'booking-1');
            $this->fail('Expected disabled payments to reject checkout intent creation.');
        } catch (ApiException $exception) {
            $this->assertSame('PAYMENTS_DISABLED', $exception->wireCode());
            $this->assertSame(409, $exception->getStatusCode());
            $this->assertSame('Online checkout is not available yet.', $exception->getMessage());
            $this->assertStringNotContainsString('launch', strtolower($exception->getMessage()));
            $this->assertFalse($exception->getDetails()['checkout_available'] ?? true);
        }

        $this->assertNull(DB::table('bookings')->where('id', 'booking-1')->value('external_ref'));
    }

    public function test_booking_payment_intent_waits_for_real_provider_adapter(): void
    {
        config()->set('membership.payments_enabled', true);
        config()->set('membership.public_subscriptions_enabled', true);
        config()->set('membership.payment_provider', 'azerbaijan-provider');
        $this->insertBooking();

        try {
            app(PaymentsController::class)->bookingIntent($this->requestForUser('user-1'), 'booking-1');
            $this->fail('Expected missing payment adapter to reject checkout intent creation.');
        } catch (ApiException $exception) {
            $this->assertSame('PAYMENT_ADAPTER_NOT_IMPLEMENTED', $exception->wireCode());
            $this->assertSame(501, $exception->getStatusCode());
            $this->assertSame('Online checkout is not available yet.', $exception->getMessage());
            $this->assertArrayNotHasKey('provider', $exception->getDetails() ?? []);
            $this->assertFalse($exception->getDetails()['checkout_available'] ?? true);
        }

        $this->assertNull(DB::table('bookings')->where('id', 'booking-1')->value('external_ref'));
    }

    public function test_booking_payment_intent_is_hidden_when_subscriptions_are_private_even_if_payments_are_enabled(): void
    {
        config()->set('membership.payments_enabled', true);
        config()->set('membership.public_subscriptions_enabled', false);
        config()->set('membership.payment_provider', 'azerbaijan-provider');
        $this->insertBooking();

        try {
            app(PaymentsController::class)->bookingIntent($this->requestForUser('user-1'), 'booking-1');
            $this->fail('Expected private launch subscriptions to reject checkout intent creation.');
        } catch (ApiException $exception) {
            $this->assertSame('PAYMENTS_DISABLED', $exception->wireCode());
            $this->assertSame(409, $exception->getStatusCode());
            $this->assertFalse($exception->getDetails()['checkout_available'] ?? true);
        }

        $this->assertNull(DB::table('bookings')->where('id', 'booking-1')->value('external_ref'));
    }

    public function test_payment_history_is_hidden_while_payments_are_disabled(): void
    {
        config()->set('membership.payments_enabled', false);

        try {
            app(PaymentsController::class)->history($this->requestForUser('user-1'));
            $this->fail('Expected disabled payments to hide payment history.');
        } catch (ApiException $exception) {
            $this->assertSame('PAYMENTS_NOT_AVAILABLE', $exception->wireCode());
            $this->assertSame(404, $exception->getStatusCode());
            $this->assertSame('This feature is not available yet.', $exception->getMessage());
        }
    }

    public function test_payment_summary_is_hidden_while_payments_are_disabled(): void
    {
        config()->set('membership.payments_enabled', false);

        try {
            app(PaymentsController::class)->summary($this->requestForUser('user-1'));
            $this->fail('Expected disabled payments to hide payment summary.');
        } catch (ApiException $exception) {
            $this->assertSame('PAYMENTS_NOT_AVAILABLE', $exception->wireCode());
            $this->assertSame(404, $exception->getStatusCode());
            $this->assertSame('This feature is not available yet.', $exception->getMessage());
        }
    }

    public function test_booking_payment_status_is_hidden_while_payments_are_disabled(): void
    {
        config()->set('membership.payments_enabled', false);
        config()->set('membership.public_subscriptions_enabled', false);
        $this->insertBooking(['status' => 'paid', 'paid_at' => now()]);

        try {
            app(PaymentsController::class)->bookingStatus($this->requestForUser('user-1'), 'booking-1');
            $this->fail('Expected disabled payments to hide booking payment status.');
        } catch (ApiException $exception) {
            $this->assertSame('PAYMENTS_NOT_AVAILABLE', $exception->wireCode());
            $this->assertSame(404, $exception->getStatusCode());
            $this->assertSame('This feature is not available yet.', $exception->getMessage());
        }
    }

    public function test_booking_payment_status_is_available_when_public_payments_are_enabled(): void
    {
        config()->set('membership.payments_enabled', true);
        config()->set('membership.public_subscriptions_enabled', true);
        $this->insertBooking(['status' => 'paid', 'paid_at' => '2026-06-20 10:00:00']);

        $response = app(PaymentsController::class)->bookingStatus($this->requestForUser('user-1'), 'booking-1');
        $payload = $response->getData(true);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame('succeeded', $payload['status']);
        $this->assertNotNull($payload['paid_at']);
    }

    private function insertBooking(array $overrides = []): void
    {
        DB::table('bookings')->insert(array_merge([
            'id' => 'booking-1',
            'user_id' => 'user-1',
            'total_minor' => 2500,
            'currency' => 'AZN',
            'status' => 'pending',
            'paid_at' => null,
            'external_ref' => null,
            'updated_at' => now(),
        ], $overrides));
    }

    private function requestForUser(string $userId): Request
    {
        $request = Request::create('/api/v1/payments/booking/booking-1/intent', 'POST');
        $user = new User();
        $user->forceFill(['id' => $userId]);
        $request->attributes->set('auth_user', $user);

        return $request;
    }
}
