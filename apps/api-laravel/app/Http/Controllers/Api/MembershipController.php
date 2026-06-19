<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use App\Services\Membership\MembershipService;
use App\Support\ApiException;

class MembershipController extends ApiController
{
    public function plans(): JsonResponse
    {
        $svc = app(MembershipService::class);

        return response()->json([
            'plans' => $svc->featureMatrix(),
            'payments' => $this->paymentState(),
        ]);
    }

    public function show(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $svc = app(MembershipService::class);
        $m = $svc->resolve($user->id);

        $state = $this->statePayload($this->membershipForUser($user->id));
        // Reflect EFFECTIVE access (incl. the free trial) so the client gates correctly.
        $state['is_premium'] = $m->is_premium;
        $state['on_trial'] = $m->on_trial;
        $state['trial_ends_at'] = $m->trial_ends_at;
        $state['global_full_access'] = $m->global_full_access;
        if ($m->is_premium) {
            $state['benefits'] = $this->tierBenefits('premium');
        }
        $state['features'] = $svc->featuresForUser($user->id);
        $state['usage'] = $svc->usage($user->id);
        $state['plans'] = $svc->featureMatrix();
        $state['payments'] = $this->paymentState();

        return response()->json($state);
    }

    public function subscribe(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $data = $this->validateBody($request, [
            'tier' => ['sometimes', 'in:premium'],
        ]);
        $tier = $data['tier'] ?? 'premium';

        if (! (bool) config('membership.payments_enabled')) {
            return response()->json([
                'mode' => 'free_launch',
                'checkout_url' => null,
                'tier' => $tier,
                'message' => 'Premium payments are not enabled yet. Full access is currently free during the launch period.',
                'membership' => $this->effectiveStatePayload($user->id),
                'payments' => $this->paymentState(),
            ], 202);
        }

        if (! $this->paymentProviderConfigured()) {
            throw new ApiException(
                501,
                'PAYMENT_PROVIDER_NOT_CONFIGURED',
                'Membership payments are enabled, but no payment provider is configured yet.',
                ['payments' => $this->paymentState()]
            );
        }

        throw new ApiException(
            501,
            'PAYMENT_ADAPTER_NOT_IMPLEMENTED',
            'Membership payment provider is configured, but its checkout adapter is not implemented yet.',
            ['payments' => $this->paymentState()]
        );
    }

    public function portal(Request $request): JsonResponse
    {
        $user = $this->authUser($request);

        $payments = $this->paymentState();

        return response()->json([
            'mode' => $payments['status'],
            'portal_url' => null,
            'membership' => $this->effectiveStatePayload($user->id),
            'payments' => $payments,
            'message' => $payments['enabled']
                ? 'Billing portal is not available until the payment provider adapter is connected.'
                : 'Billing is disabled during the free launch access period.',
        ], $payments['checkout_available'] ? 200 : 202);
    }

    public function cancel(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $row = $this->membershipForUser($user->id);

        if (! $this->hasActivePaidSubscription($row)) {
            throw new ApiException(
                409,
                'NO_ACTIVE_SUBSCRIPTION',
                'There is no active paid subscription to cancel.',
                ['membership' => $this->effectiveStatePayload($user->id), 'payments' => $this->paymentState()]
            );
        }

        DB::table('memberships')->where('user_id', $user->id)->update([
            'cancel_at_period_end' => true,
            'subscription_status' => 'cancel_at_period_end',
            'updated_at' => now(),
        ]);
        $row = $this->membershipForUser($user->id);

        return response()->json([
            'tier' => $row->tier,
            'cancel_at_period_end' => (bool) $row->cancel_at_period_end,
            'current_period_end' => $this->iso($row->current_period_end),
        ]);
    }

    private function membershipForUser(string $userId): object
    {
        DB::table('memberships')->insertOrIgnore([
            'user_id' => $userId,
            'tier' => 'free',
            'updated_at' => now(),
        ]);

        return DB::table('memberships')->where('user_id', $userId)->first();
    }

    private function statePayload(object $row): array
    {
        $tier = in_array($row->tier, ['free', 'plus', 'premium'], true) ? $row->tier : 'free';

        // A paid tier past its billing period is no longer active → free.
        if ($tier !== 'free' && $row->current_period_end !== null && strtotime((string) $row->current_period_end) <= time()) {
            $tier = 'free';
        }

        return [
            'tier' => $tier,
            'is_premium' => $tier !== 'free',
            'current_period_end' => $this->iso($row->current_period_end),
            'cancel_at_period_end' => (bool) $row->cancel_at_period_end,
            'benefits' => $this->tierBenefits($tier),
            'price_minor' => $this->tierPrice($tier),
            'currency' => (string) config('membership.currency', 'AZN'),
            'billing' => [
                'provider' => $row->payment_provider ?? null,
                'customer_id' => $row->provider_customer_id ?? null,
                'subscription_id' => $row->provider_subscription_id ?? null,
                'status' => $row->subscription_status ?? null,
                'trial_ends_at' => $this->iso($row->trial_ends_at ?? null),
                'subscribed_at' => $this->iso($row->subscribed_at ?? null),
            ],
            'updated_at' => $this->iso($row->updated_at),
        ];
    }

    private function effectiveStatePayload(string $userId): array
    {
        $svc = app(MembershipService::class);
        $m = $svc->resolve($userId);
        $state = $this->statePayload($this->membershipForUser($userId));
        $state['is_premium'] = $m->is_premium;
        $state['on_trial'] = $m->on_trial;
        $state['trial_ends_at'] = $m->trial_ends_at;
        $state['global_full_access'] = $m->global_full_access;
        if ($m->is_premium) {
            $state['benefits'] = $this->tierBenefits('premium');
        }
        $state['features'] = $svc->featuresForUser($userId);

        return $state;
    }

    private function hasActivePaidSubscription(object $row): bool
    {
        $tier = in_array($row->tier, ['plus', 'premium'], true) ? $row->tier : 'free';
        if ($tier === 'free') {
            return false;
        }
        if (($row->provider_subscription_id ?? null) === null && ($row->current_period_end ?? null) === null) {
            return false;
        }

        return $row->current_period_end === null || strtotime((string) $row->current_period_end) > time();
    }

    private function tierBenefits(string $tier): array
    {
        $benefits = [
            ['key' => 'basic_booking', 'label' => 'Basic booking'],
            ['key' => 'join_games', 'label' => 'Join public games'],
        ];

        if (in_array($tier, ['plus', 'premium'], true)) {
            $benefits = [
                ...$benefits,
                ['key' => 'unlimited_bookings', 'label' => 'Unlimited bookings'],
                ['key' => 'ad_free', 'label' => 'Ad-free experience'],
                ['key' => 'early_tournament_access', 'label' => 'Early tournament access'],
            ];
        }

        if ($tier === 'premium') {
            $benefits = [
                ...$benefits,
                ['key' => 'coach_on_demand', 'label' => 'Coach on demand'],
                ['key' => 'custom_badge', 'label' => 'Custom badge'],
            ];
        }

        return $benefits;
    }

    private function tierPrice(string $tier): int
    {
        return match ($tier) {
            'plus' => 999,
            'premium' => (int) config('membership.premium_price_minor', 0),
            default => 0,
        };
    }

    private function paymentState(): array
    {
        $enabled = (bool) config('membership.payments_enabled');
        $provider = trim((string) config('membership.payment_provider', ''));
        $providerConfigured = $provider !== '';

        return [
            'enabled' => $enabled,
            'provider' => $providerConfigured ? $provider : null,
            'provider_configured' => $providerConfigured,
            'checkout_available' => false,
            'status' => ! $enabled ? 'free_launch' : ($providerConfigured ? 'adapter_pending' : 'provider_missing'),
            'launch_free_access_until' => config('membership.global_full_access_until') ?: null,
            'free_trial_days' => (int) config('membership.free_trial_days', 50),
        ];
    }

    private function paymentProviderConfigured(): bool
    {
        return trim((string) config('membership.payment_provider', '')) !== '';
    }
}
