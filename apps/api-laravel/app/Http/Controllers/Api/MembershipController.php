<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use App\Services\Membership\MembershipService;
use App\Support\ApiException;

class MembershipController extends ApiController
{
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
            $svc = app(MembershipService::class);
            $m = $svc->resolve($user->id);

            return response()->json([
                'mode' => 'provider_pending',
                'checkout_url' => null,
                'tier' => $tier,
                'message' => 'Premium payments are not enabled yet. Full access is currently free during the launch period.',
                'membership' => [
                    ...$this->statePayload($this->membershipForUser($user->id)),
                    'is_premium' => $m->is_premium,
                    'on_trial' => $m->on_trial,
                    'trial_ends_at' => $m->trial_ends_at,
                    'global_full_access' => $m->global_full_access,
                ],
                'payments' => $this->paymentState(),
            ], 202);
        }

        throw new ApiException(
            501,
            'PAYMENT_PROVIDER_NOT_CONFIGURED',
            'Membership payments are enabled, but no payment provider adapter is configured yet.'
        );
    }

    public function portal(Request $request): JsonResponse
    {
        $user = $this->authUser($request);

        return response()->json([
            'mode' => (bool) config('membership.payments_enabled') ? 'provider_pending' : 'disabled',
            'portal_url' => null,
            'membership' => $this->statePayload($this->membershipForUser($user->id)),
            'payments' => $this->paymentState(),
        ]);
    }

    public function cancel(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $this->membershipForUser($user->id);

        DB::table('memberships')->where('user_id', $user->id)->update([
            'cancel_at_period_end' => true,
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
            'updated_at' => $this->iso($row->updated_at),
        ];
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
        return [
            'enabled' => (bool) config('membership.payments_enabled'),
            'provider' => config('membership.payment_provider'),
            'status' => (bool) config('membership.payments_enabled') ? 'provider_pending' : 'free_launch',
            'launch_free_access_until' => config('membership.global_full_access_until') ?: null,
            'free_trial_days' => (int) config('membership.free_trial_days', 50),
        ];
    }
}
