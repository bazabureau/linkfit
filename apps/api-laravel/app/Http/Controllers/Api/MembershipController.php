<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class MembershipController extends ApiController
{
    public function show(Request $request): JsonResponse
    {
        $user = $this->authUser($request);

        return response()->json($this->statePayload($this->membershipForUser($user->id)));
    }

    public function subscribe(Request $request): JsonResponse
    {
        $user = $this->authUser($request);
        $data = $this->validateBody($request, [
            'tier' => ['required', 'in:plus,premium'],
        ]);
        $periodEnd = now()->addMonth();

        $this->membershipForUser($user->id);
        DB::table('memberships')->where('user_id', $user->id)->update([
            'tier' => $data['tier'],
            'current_period_end' => $periodEnd,
            'cancel_at_period_end' => false,
            'updated_at' => now(),
        ]);

        return response()->json([
            'mode' => 'demo',
            'checkout_url' => null,
            'tier' => $data['tier'],
            'current_period_end' => $this->iso($periodEnd),
        ]);
    }

    public function portal(Request $request): JsonResponse
    {
        $user = $this->authUser($request);

        return response()->json([
            'mode' => 'local',
            'portal_url' => null,
            'membership' => $this->statePayload($this->membershipForUser($user->id)),
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

        return [
            'tier' => $tier,
            'current_period_end' => $this->iso($row->current_period_end),
            'cancel_at_period_end' => (bool) $row->cancel_at_period_end,
            'benefits' => $this->tierBenefits($tier),
            'price_minor' => $this->tierPrice($tier),
            'currency' => 'AZN',
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
            'premium' => 1999,
            default => 0,
        };
    }
}
