<?php

namespace App\Services\Membership;

use App\Support\ApiException;
use Illuminate\Support\Facades\DB;

/**
 * Single source of truth for a user's effective membership tier and premium
 * status. A paid tier whose billing period has ended is treated as `free`, so
 * "premium" everywhere means *actively* premium.
 */
class MembershipService
{
    /**
     * Resolve a user's effective membership. Pass $createdAt (the user's
     * registration timestamp) when the caller already has it to skip a query.
     *
     * Effective premium = an active paid tier OR a free-access window. Free
     * access can be global (launch promo for every account) or per-user
     * (FREE_TRIAL_DAYS from registration). `tier` stays honest (the real paid
     * tier, else free); `is_premium` is the effective access used by gates.
     *
     * @return object{tier:string,is_premium:bool,is_plus:bool,on_trial:bool,trial_ends_at:?string,global_full_access:bool,current_period_end:?string,cancel_at_period_end:bool}
     */
    public function resolve(string $userId, ?string $createdAt = null): object
    {
        $row = DB::table('memberships')->where('user_id', $userId)->first();

        $rawTier = ($row && in_array($row->tier, ['free', 'plus', 'premium'], true)) ? $row->tier : 'free';
        $periodEnd = $row->current_period_end ?? null;

        // Active PAID subscription (not past its billing period)?
        $paidActive = $rawTier !== 'free'
            && ($periodEnd === null || strtotime((string) $periodEnd) > time());

        $onTrial = false;
        $trialEndsAt = null;
        $globalFullAccess = false;
        if (! $paidActive) {
            $globalUntil = $this->parseFutureTimestamp(config('membership.global_full_access_until'));
            if ($globalUntil !== null) {
                $globalFullAccess = true;
                $onTrial = true;
                $trialEndsAt = gmdate('Y-m-d\TH:i:s\Z', $globalUntil);
            }

            // config() — survives `php artisan config:cache` (env() would return
            // null when cached and silently disable trials for everyone).
            $trialDays = (int) config('membership.free_trial_days', 50);
            if ($trialDays > 0) {
                $created = $createdAt ?? DB::table('users')->where('id', $userId)->value('created_at');
                if ($created !== null) {
                    $end = strtotime((string) $created) + $trialDays * 86400;
                    if (time() < $end) {
                        $onTrial = true;
                        $trialEndsAt = gmdate('Y-m-d\TH:i:s\Z', max($end, $this->timestampOrZero($trialEndsAt)));
                    }
                }
            }
        }

        $tier = $paidActive ? $rawTier : 'free';
        $isPremium = $paidActive || $onTrial;

        return (object) [
            'tier' => $tier,
            'is_premium' => $isPremium,
            'is_plus' => $tier === 'plus',
            'on_trial' => $onTrial,
            'trial_ends_at' => $trialEndsAt,
            'global_full_access' => $globalFullAccess,
            'current_period_end' => $periodEnd,
            'cancel_at_period_end' => (bool) ($row->cancel_at_period_end ?? false),
        ];
    }

    public function isPremium(string $userId): bool
    {
        return $this->resolve($userId)->is_premium;
    }

    public function tier(string $userId): string
    {
        return $this->resolve($userId)->tier;
    }

    /** @return array<int,string> */
    public function featuresForTier(string $tier): array
    {
        $plans = (array) config('membership.plans', []);
        $tier = in_array($tier, ['free', 'premium'], true) ? $tier : 'free';

        return array_values(array_unique(array_map(
            'strval',
            (array) data_get($plans, "{$tier}.features", [])
        )));
    }

    /** @return array<int,string> */
    public function featuresForUser(string $userId): array
    {
        return $this->featuresForTier($this->resolve($userId)->is_premium ? 'premium' : 'free');
    }

    public function canUseFeature(string $userId, string $feature): bool
    {
        return in_array($feature, $this->featuresForUser($userId), true);
    }

    public function ensureFeature(string $userId, string $feature): void
    {
        if ($this->canUseFeature($userId, $feature)) {
            return;
        }

        throw new ApiException(
            403,
            'PREMIUM_REQUIRED',
            'This feature requires Premium.',
            ['feature' => $feature, 'upgrade' => true]
        );
    }

    // ---- Free-tier limits ("who can do what") ----------------------------
    // Premium = unlimited. Free has a generous, env-tunable monthly cap so the
    // freemium model is enforced without hurting normal usage / club bookings.

    /** @return array{games_per_month:int,bookings_per_month:int} */
    public function freeLimits(): array
    {
        return [
            'games_per_month' => (int) config('membership.free_games_per_month', 30),
            'bookings_per_month' => (int) config('membership.free_bookings_per_month', 30),
        ];
    }

    /** Current-month usage + the limits that apply to this user. */
    public function usage(string $userId): array
    {
        $start = now()->startOfMonth();
        $m = $this->resolve($userId);
        $isPremium = $m->is_premium;
        $limits = $this->freeLimits();

        return [
            'is_premium' => $isPremium,
            'on_trial' => $m->on_trial,
            'trial_ends_at' => $m->trial_ends_at,
            'global_full_access' => $m->global_full_access,
            'games_this_month' => $this->monthlyGames($userId, $start),
            'bookings_this_month' => $this->monthlyBookings($userId, $start),
            'games_limit' => $isPremium ? null : $limits['games_per_month'],
            'bookings_limit' => $isPremium ? null : $limits['bookings_per_month'],
        ];
    }

    /** Throw PREMIUM_REQUIRED if a free user is at their monthly hosted-game cap. */
    public function ensureCanHostGame(string $userId): void
    {
        if ($this->isPremium($userId)) {
            return;
        }
        $limit = $this->freeLimits()['games_per_month'];
        $used = $this->monthlyGames($userId, now()->startOfMonth());
        if ($used >= $limit) {
            throw new ApiException(403, 'PREMIUM_REQUIRED',
                "Free plan allows {$limit} hosted games per month. Upgrade to Premium for unlimited.",
                ['feature' => 'host_game', 'limit' => $limit, 'used' => $used, 'upgrade' => true]);
        }
    }

    /** Throw PREMIUM_REQUIRED if a free user is at their monthly booking cap. */
    public function ensureCanBook(string $userId): void
    {
        if ($this->isPremium($userId)) {
            return;
        }
        $limit = $this->freeLimits()['bookings_per_month'];
        $used = $this->monthlyBookings($userId, now()->startOfMonth());
        if ($used >= $limit) {
            throw new ApiException(403, 'PREMIUM_REQUIRED',
                "Free plan allows {$limit} bookings per month. Upgrade to Premium for unlimited.",
                ['feature' => 'booking', 'limit' => $limit, 'used' => $used, 'upgrade' => true]);
        }
    }

    private function monthlyGames(string $userId, \DateTimeInterface $since): int
    {
        return (int) DB::table('games')->where('host_user_id', $userId)
            ->whereNull('deleted_at')->where('created_at', '>=', $since)->count();
    }

    private function monthlyBookings(string $userId, \DateTimeInterface $since): int
    {
        // Only bookings the user actually holds consume quota — exclude
        // cancelled / failed / refunded.
        return (int) DB::table('bookings')->where('user_id', $userId)
            ->whereNotIn('status', ['cancelled', 'failed', 'refunded'])
            ->where('created_at', '>=', $since)->count();
    }

    public function featureMatrix(): array
    {
        $limits = $this->freeLimits();
        $plans = (array) config('membership.plans', []);

        return [
            'free' => [
                'name' => (string) data_get($plans, 'free.name', 'Free'),
                'price_minor' => 0,
                'currency' => (string) config('membership.currency', 'AZN'),
                'games_per_month' => $limits['games_per_month'],
                'bookings_per_month' => $limits['bookings_per_month'],
                'features' => $this->featuresForTier('free'),
            ],
            'premium' => [
                'name' => (string) data_get($plans, 'premium.name', 'Premium'),
                'price_minor' => (int) config('membership.premium_price_minor', 0),
                'currency' => (string) config('membership.currency', 'AZN'),
                'games_per_month' => null,
                'bookings_per_month' => null,
                'features' => $this->featuresForTier('premium'),
            ],
        ];
    }

    private function parseFutureTimestamp(mixed $value): ?int
    {
        $raw = trim((string) $value);
        if ($raw === '') {
            return null;
        }

        $ts = strtotime($raw);
        if ($ts === false || $ts <= time()) {
            return null;
        }

        return $ts;
    }

    private function timestampOrZero(?string $value): int
    {
        if ($value === null || $value === '') {
            return 0;
        }

        $ts = strtotime($value);

        return $ts === false ? 0 : $ts;
    }
}
