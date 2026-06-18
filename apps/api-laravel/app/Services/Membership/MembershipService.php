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
     * Effective premium = an active PAID tier OR an active 1-month free trial
     * (every new user gets full premium access for `FREE_TRIAL_DAYS` from
     * registration). `tier` stays honest (the real paid tier, else free);
     * `is_premium` is the effective access used by all gates.
     *
     * @return object{tier:string,is_premium:bool,is_plus:bool,on_trial:bool,trial_ends_at:?string,current_period_end:?string,cancel_at_period_end:bool}
     */
    public function resolve(string $userId, ?string $createdAt = null): object
    {
        $row = DB::table('memberships')->where('user_id', $userId)->first();

        $rawTier = ($row && in_array($row->tier, ['free', 'plus', 'premium'], true)) ? $row->tier : 'free';
        $periodEnd = $row->current_period_end ?? null;

        // Active PAID subscription (not past its billing period)?
        $paidActive = $rawTier !== 'free'
            && ($periodEnd === null || strtotime((string) $periodEnd) > time());

        // 1-month free trial from registration — full premium while it lasts.
        $onTrial = false;
        $trialEndsAt = null;
        if (! $paidActive) {
            // config() — survives `php artisan config:cache` (env() would return
            // null when cached and silently disable trials for everyone).
            $trialDays = (int) config('membership.free_trial_days', 30);
            if ($trialDays > 0) {
                $created = $createdAt ?? DB::table('users')->where('id', $userId)->value('created_at');
                if ($created !== null) {
                    $end = strtotime((string) $created) + $trialDays * 86400;
                    if (time() < $end) {
                        $onTrial = true;
                        $trialEndsAt = gmdate('Y-m-d\TH:i:s\Z', $end);
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
}
