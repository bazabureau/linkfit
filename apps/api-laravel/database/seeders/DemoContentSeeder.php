<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * Demo content cleanup for production launch.
 *
 * The public player directory now uses real launch profiles only. Re-running
 * this seeder removes old demo.<slug>@linkfit.az accounts from public surfaces
 * without touching real user accounts. Run:
 *   php artisan db:seed --class=DemoContentSeeder --force
 */
class DemoContentSeeder extends Seeder
{
    public function run(): void
    {
        $now = now();
        $demoUserIds = DB::table('users')
            ->where('email', 'like', 'demo.%@linkfit.az')
            ->pluck('id')
            ->all();

        if ($demoUserIds !== []) {
            DB::table('follows')
                ->whereIn('follower_user_id', $demoUserIds)
                ->orWhereIn('followed_user_id', $demoUserIds)
                ->delete();

            DB::table('users')
                ->whereIn('id', $demoUserIds)
                ->update(['deleted_at' => $now, 'updated_at' => $now]);
        }

        $this->command?->info('Demo profile cleanup complete: '.count($demoUserIds).' demo accounts soft-deleted.');
    }
}
