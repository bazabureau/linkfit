<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

/**
 * Assign a unique username to every active user that has none — historically
 * SSO (Apple/Google) sign-ups were created without one. A username is mandatory,
 * so derive a stable handle from the display name (same rule as registration).
 *
 *   php artisan users:backfill-usernames --dry-run   # preview
 *   php artisan users:backfill-usernames             # apply
 */
class BackfillUsernames extends Command
{
    protected $signature = 'users:backfill-usernames {--dry-run : List the assignments without saving}';

    protected $description = 'Give every active user without a username a unique one derived from their display name';

    public function handle(): int
    {
        $users = User::whereNull('deleted_at')
            ->where(fn ($q) => $q->whereNull('username')->orWhere('username', ''))
            ->get();

        $this->info('Users missing a username: '.$users->count());
        $dry = (bool) $this->option('dry-run');

        foreach ($users as $u) {
            $username = $this->uniqueUsernameFromDisplayName((string) $u->display_name);
            $this->line(($dry ? '[dry] ' : '').$u->display_name.' -> @'.$username);
            if (! $dry) {
                $u->username = $username;
                $u->save();
            }
        }

        $this->info($dry ? 'Dry run — nothing saved.' : 'Done.');

        return self::SUCCESS;
    }

    private function uniqueUsernameFromDisplayName(string $displayName): string
    {
        $base = Str::slug($displayName, '_');
        $base = preg_replace('/[^a-z0-9._]/', '', mb_strtolower($base)) ?: 'player';
        $base = substr($base, 0, 30);
        if (strlen($base) < 3) {
            $base = str_pad($base, 3, '0');
        }

        $candidate = $base;
        $suffix = 1;
        while (User::where('username', $candidate)->exists()) {
            $suffix++;
            $candidate = substr($base, 0, 40 - strlen((string) $suffix) - 1).'_'.$suffix;
        }

        return $candidate;
    }
}
