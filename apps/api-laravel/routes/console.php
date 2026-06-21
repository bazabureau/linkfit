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

Artisan::command('feed:fanout', function () {
    $stats = app(FeedService::class)->fanOut();
    foreach ($stats as $k => $v) {
        $this->line($k.': '.$v);
    }
})->purpose('Fan out activity-feed events from source tables');

Schedule::command('feed:fanout')
    ->everyMinute()
    ->withoutOverlapping(5);
