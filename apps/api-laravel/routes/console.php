<?php

use App\Services\Feed\FeedService;
use App\Services\Notifications\PushDispatcher;
use App\Services\Notifications\ReminderDispatcher;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schedule;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('security:make-api-key {--internal : Generate a server-to-server internal key}', function () {
    $prefix = $this->option('internal') ? 'lf_internal_' : 'lf_public_';
    $key = $prefix.bin2hex(random_bytes(32));

    $this->line('key: '.$key);
    $this->line('sha256: '.hash('sha256', $key));
    $this->line($this->option('internal')
        ? 'Set INTERNAL_API_KEY_HASHES to the sha256 value. Never ship the key to browser/mobile clients.'
        : 'Set APP_PUBLIC_API_KEY_HASHES only if REQUIRE_API_KEY=true. Public client keys are optional and are not secrets.');
})->purpose('Generate a LinkFit API key and its SHA-256 hash');

Artisan::command('push:process {--limit=100} {--dry-run}', function () {
    $dispatcher = app(PushDispatcher::class);
    $stats = $dispatcher->process((int) $this->option('limit'), (bool) $this->option('dry-run'));
    foreach ($stats as $key => $value) {
        $this->line($key.': '.$value);
    }
})->purpose('Process pending Linkfit push notification jobs');

Artisan::command('ops:send-reminders {--window=120} {--lookahead=150}', function () {
    $stats = app(ReminderDispatcher::class)->process((int) $this->option('window'), (int) $this->option('lookahead'));
    foreach ($stats as $key => $value) {
        $this->line($key.': '.$value);
    }
})->purpose('Create game and booking reminder notifications');

Artisan::command('ops:release-expired-booking-holds', function () {
    if (! Schema::hasTable('booking_holds')) {
        $this->line('deleted: 0');

        return;
    }
    $deleted = DB::table('booking_holds')->where('expires_at', '<=', now())->delete();
    $this->line('deleted: '.$deleted);
})->purpose('Release expired booking holds');

Artisan::command('ops:cleanup-media {--days=7} {--limit=500} {--dry-run}', function () {
    $cutoff = now()->subDays((int) $this->option('days'));
    $limit = min(max((int) $this->option('limit'), 1), 1000);
    $dryRun = (bool) $this->option('dry-run');
    $assets = DB::table('media_assets')
        ->whereNotNull('deleted_at')
        ->whereNull('cleanup_reason')
        ->where('deleted_at', '<=', $cutoff)
        ->orderBy('deleted_at')
        ->limit($limit)
        ->get(['id', 'disk', 'path']);

    $deleted = 0;
    $failed = 0;
    if (! $dryRun) {
        foreach ($assets as $asset) {
            try {
                Storage::disk($asset->disk)->delete($asset->path);
                DB::table('media_assets')->where('id', $asset->id)->update([
                    'cleanup_reason' => 'scheduled_cleanup',
                    'updated_at' => now(),
                ]);
                $deleted++;
            } catch (Throwable $e) {
                $failed++;
                $this->error($asset->id.': '.$e->getMessage());
            }
        }
    }

    $this->line('selected: '.$assets->count());
    $this->line('deleted: '.$deleted);
    $this->line('failed: '.$failed);
    $this->line('dry_run: '.($dryRun ? '1' : ''));
})->purpose('Prune storage files for media assets already soft-deleted');

Artisan::command('push:prune {--days=7} {--limit=1000}', function () {
    $scrubbed = app(PushDispatcher::class)->prune((int) $this->option('days'), (int) $this->option('limit'));
    $this->line('scrubbed: '.$scrubbed);
})->purpose('Scrub cleartext content from terminal push notification jobs (PII retention)');

Artisan::command('notifications:prune {--days=30} {--limit=1000}', function () {
    // PII retention: NULL/blank the cleartext chat-message content retained on
    // message_received notifications past the window. notifications.body is NOT
    // NULL (→ '') and notifications.payload is NOT NULL jsonb DEFAULT '{}' (→
    // '{}'), so the row stays for unread/badge accounting but no longer holds the
    // message text. Bounded UPDATE only — no schema change.
    $days = max((int) $this->option('days'), 0);
    $limit = min(max((int) $this->option('limit'), 1), 5000);
    $cutoff = now()->subDays($days);

    // CAST(payload AS text) keeps the "already blanked?" guard portable: on
    // Postgres a bare `payload <> '{}'` text bind raises "operator does not exist:
    // jsonb <> text" (same gotcha PushDispatcher::pushPolicy works around), while
    // the cast compares the rendered jsonb on Postgres and the raw text on SQLite.
    $ids = DB::table('notifications')
        ->where('type', 'message_received')
        ->where('created_at', '<=', $cutoff)
        ->where(fn ($q) => $q->where('body', '!=', '')->orWhereRaw('CAST(payload AS text) <> ?', ['{}']))
        ->orderBy('created_at')
        ->limit($limit)
        ->pluck('id')
        ->all();

    if ($ids === []) {
        $this->line('scrubbed: 0');

        return;
    }

    $scrubbed = DB::table('notifications')
        ->whereIn('id', $ids)
        ->update([
            'body' => '',
            'payload' => '{}',
        ]);

    $this->line('scrubbed: '.$scrubbed);
})->purpose('Scrub message_received notification body/payload past the retention window (PII)');

// Phase 2 of GDPR/Apple account deletion: hard-purge accounts whose 30-day
// cancellation window has elapsed. We ANONYMIZE the users row (irreversible PII
// erasure) and hard-delete personal/sensitive child data, but keep shared
// records (games, messages, payments, tournaments) de-identified — this honors
// erasure without destroying other users' history, and sidesteps the RESTRICT
// FKs on host/sender/captain columns that would block deleting the users row.
Artisan::command('ops:purge-deleted-accounts {--limit=100} {--dry-run}', function () {
    if (! Schema::hasTable('account_deletion_requests') || ! Schema::hasTable('users')) {
        $this->line('purged: 0');

        return;
    }

    $limit = max(1, (int) $this->option('limit'));
    $dryRun = (bool) $this->option('dry-run');

    $due = DB::table('account_deletion_requests')
        ->where('status', 'scheduled')
        ->whereNotNull('hard_delete_at')
        ->where('hard_delete_at', '<=', now())
        ->orderBy('hard_delete_at')
        ->limit($limit)
        ->pluck('user_id');

    if ($due->isEmpty()) {
        $this->line(($dryRun ? 'would purge: ' : 'purged: ').'0');

        return;
    }

    // Personal/sensitive tables keyed by a single user column.
    $singleColumn = [
        'refresh_tokens' => 'user_id',
        'device_tokens' => 'user_id',
        'email_tokens' => 'user_id',
        'medical_profiles' => 'user_id',
        'tournament_waivers' => 'user_id',
        'notification_preferences' => 'user_id',
        'notifications' => 'user_id',
        'data_export_requests' => 'user_id',
        'feed_comments' => 'user_id',
        'feed_event_reactions' => 'user_id',
        'player_sport_stats' => 'user_id',
        'user_achievements' => 'user_id',
        'memberships' => 'user_id',
        'user_saved_places' => 'user_id',
    ];
    // Tables that reference the user from more than one column.
    $multiColumn = [
        'follows' => ['follower_user_id', 'followed_user_id'],
        'ratings' => ['rater_user_id', 'rated_user_id'],
        'user_blocks' => ['blocker_user_id', 'blocked_user_id'],
        'game_invitations' => ['inviter_user_id', 'invitee_user_id'],
    ];

    $purged = 0;
    foreach ($due as $userId) {
        if ($dryRun) {
            $purged++;
            continue;
        }

        DB::transaction(function () use ($userId, $singleColumn, $multiColumn): void {
            foreach ($singleColumn as $table => $col) {
                if (Schema::hasTable($table) && Schema::hasColumn($table, $col)) {
                    DB::table($table)->where($col, $userId)->delete();
                }
            }
            foreach ($multiColumn as $table => $cols) {
                if (! Schema::hasTable($table)) {
                    continue;
                }
                foreach ($cols as $col) {
                    if (Schema::hasColumn($table, $col)) {
                        DB::table($table)->where($col, $userId)->delete();
                    }
                }
            }

            // Anonymize the users row. password_hash is NOT NULL, so scrub it to
            // an unusable non-null value rather than null; email must stay a
            // valid, unique address (the format CHECK + UNIQUE still apply).
            $anon = [
                'email' => 'deleted-'.$userId.'@deleted.invalid',
                'password_hash' => 'account-deleted',
                'display_name' => 'Deleted user',
                'photo_url' => null,
                'home_lat' => null,
                'home_lng' => null,
                'deleted_at' => now(),
            ];
            foreach (['birth_date', 'apple_sub', 'google_sub'] as $c) {
                if (Schema::hasColumn('users', $c)) {
                    $anon[$c] = null;
                }
            }
            if (Schema::hasColumn('users', 'photo_urls')) {
                $anon['photo_urls'] = '{}';
            }
            if (Schema::hasColumn('users', 'email_verified_at')) {
                $anon['email_verified_at'] = null;
            }
            DB::table('users')->where('id', $userId)->update($anon);

            DB::table('account_deletion_requests')->where('user_id', $userId)->update([
                'status' => 'completed',
                'completed_at' => now(),
            ]);
        });

        $purged++;
    }

    $this->line(($dryRun ? 'would purge: ' : 'purged: ').$purged);
})->purpose('Hard-purge (anonymize + delete personal data of) accounts past their 30-day deletion grace window');

Schedule::command('push:process --limit=100')
    ->everyMinute()
    ->withoutOverlapping(5);

Schedule::command('ops:send-reminders --window=120 --lookahead=150')
    ->everyFiveMinutes()
    ->withoutOverlapping(10);

Schedule::command('ops:release-expired-booking-holds')
    ->everyMinute()
    ->withoutOverlapping(5);

Schedule::command('ops:cleanup-media --days=7 --limit=500')
    ->dailyAt('03:20')
    ->withoutOverlapping(60);

Schedule::command('push:prune --days=7 --limit=1000')
    ->dailyAt('03:30')
    ->withoutOverlapping(60);

Schedule::command('notifications:prune --days=30 --limit=1000')
    ->dailyAt('03:40')
    ->withoutOverlapping(60);

Schedule::command('ops:purge-deleted-accounts --limit=200')
    ->dailyAt('03:50')
    ->withoutOverlapping(120);

Artisan::command('feed:fanout', function () {
    $stats = app(FeedService::class)->fanOut();
    foreach ($stats as $k => $v) {
        $this->line($k.': '.$v);
    }
})->purpose('Fan out activity-feed events from source tables');

Schedule::command('feed:fanout')
    ->everyMinute()
    ->withoutOverlapping(5);
