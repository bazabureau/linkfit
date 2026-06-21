<?php

namespace Tests\Unit;

use App\Services\Launch\LaunchConfig;
use Tests\TestCase;

class LaunchConfigTest extends TestCase
{
    public function test_launch_defaults_keep_monetization_off_and_premium_unlocked(): void
    {
        config()->set('launch.start_at', now('UTC')->subDay()->toIso8601String());
        config()->set('launch.end_at', now('UTC')->addDays(49)->toIso8601String());
        config()->set('launch.monetization_enabled', false);
        config()->set('launch.premium_unlocked_for_all', true);
        config()->set('launch.booking_fee_enabled', true);
        config()->set('launch.booking_service_fee_minor', 250);
        config()->set('launch.online_payment_enabled', true);

        $launch = app(LaunchConfig::class);

        $this->assertTrue($launch->active());
        $this->assertFalse($launch->monetizationEnabled());
        $this->assertTrue($launch->premiumUnlockedForAll());
        $this->assertFalse($launch->bookingFeeEnabled());
        $this->assertSame(0, $launch->bookingServiceFeeMinor());
        $this->assertFalse($launch->onlinePaymentEnabled());
    }

    public function test_monetization_can_be_reenabled_by_flags_without_code_changes(): void
    {
        config()->set('launch.start_at', now('UTC')->subDays(60)->toIso8601String());
        config()->set('launch.end_at', now('UTC')->subDay()->toIso8601String());
        config()->set('launch.monetization_enabled', true);
        config()->set('launch.booking_fee_enabled', true);
        config()->set('launch.booking_service_fee_minor', 250);
        config()->set('launch.online_payment_enabled', true);

        $launch = app(LaunchConfig::class);

        $this->assertFalse($launch->active());
        $this->assertTrue($launch->monetizationEnabled());
        $this->assertFalse($launch->premiumUnlockedForAll());
        $this->assertTrue($launch->bookingFeeEnabled());
        $this->assertSame(250, $launch->bookingServiceFeeMinor());
        $this->assertTrue($launch->onlinePaymentEnabled());
    }
}
