<?php

namespace App\Services\Launch;

use Carbon\CarbonImmutable;

class LaunchConfig
{
    public function active(): bool
    {
        $now = CarbonImmutable::now('UTC');
        $start = $this->startAt();
        $end = $this->endAt();

        return $start !== null && $end !== null && $now->greaterThanOrEqualTo($start) && $now->lessThanOrEqualTo($end);
    }

    public function monetizationEnabled(): bool
    {
        return (bool) config('launch.monetization_enabled', false);
    }

    public function premiumUnlockedForAll(): bool
    {
        return $this->active() && (bool) config('launch.premium_unlocked_for_all', true);
    }

    public function bookingFeeEnabled(): bool
    {
        return $this->monetizationEnabled() && (bool) config('launch.booking_fee_enabled', false);
    }

    public function bookingServiceFeeMinor(): int
    {
        if (! $this->bookingFeeEnabled()) {
            return 0;
        }

        return max(0, (int) config('launch.booking_service_fee_minor', 0));
    }

    public function onlinePaymentEnabled(): bool
    {
        return $this->monetizationEnabled() && (bool) config('launch.online_payment_enabled', false);
    }

    public function referralEnabled(): bool
    {
        return (bool) config('launch.referral_enabled', true);
    }

    public function promoEnabled(): bool
    {
        return (bool) config('launch.promo_enabled', true);
    }

    public function freeCancellationEnabled(): bool
    {
        return $this->active() && (bool) config('launch.free_cancellation_enabled', true);
    }

    public function startIso(): ?string
    {
        return $this->startAt()?->format('Y-m-d\TH:i:s\Z');
    }

    public function endIso(): ?string
    {
        return $this->endAt()?->format('Y-m-d\TH:i:s\Z');
    }

    public function flags(): array
    {
        return [
            'monetization_enabled' => $this->monetizationEnabled(),
            'premium_unlocked_for_all' => $this->premiumUnlockedForAll(),
            'booking_fee_enabled' => $this->bookingFeeEnabled(),
            'service_fee_minor' => $this->bookingServiceFeeMinor(),
            'online_payment_enabled' => $this->onlinePaymentEnabled(),
            'referral_enabled' => $this->referralEnabled(),
            'promo_enabled' => $this->promoEnabled(),
            'free_cancellation_enabled' => $this->freeCancellationEnabled(),
        ];
    }

    public function publicPayload(): array
    {
        return [
            'active' => $this->active(),
            'start_at' => $this->startIso(),
            'end_at' => $this->endIso(),
            'window_days' => (int) config('launch.window_days', 50),
            'targets' => (array) config('launch.targets', []),
            ...$this->flags(),
        ];
    }

    private function startAt(): ?CarbonImmutable
    {
        return $this->parse(config('launch.start_at'));
    }

    private function endAt(): ?CarbonImmutable
    {
        return $this->parse(config('launch.end_at') ?: config('membership.global_full_access_until'));
    }

    private function parse(mixed $value): ?CarbonImmutable
    {
        $raw = trim((string) $value);
        if ($raw === '') {
            return null;
        }

        try {
            return CarbonImmutable::parse($raw)->utc();
        } catch (\Throwable) {
            return null;
        }
    }
}
