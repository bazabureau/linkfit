<?php

namespace App\Console\Commands;

use App\Services\Mail\TransactionalMailService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * One-off campaign: email the launch-waitlist leads that LinkFit is now LIVE on
 * the App Store, ask for feedback to info@linkfit.az, and tease what's coming.
 *
 *   php artisan waitlist:announce-launch --dry-run            # list, send nothing
 *   php artisan waitlist:announce-launch --only=info@linkfit.az  # single test send
 *   php artisan waitlist:announce-launch                      # send to everyone
 *
 * Sends synchronously (LinkfitTransactionalMail is not queued) and pauses
 * briefly between messages so the Gmail API isn't hammered. Per-recipient send
 * failures are logged inside TransactionalMailService::send() and never abort
 * the run, so one bad address can't stop the campaign.
 */
class AnnounceLaunchToWaitlist extends Command
{
    protected $signature = 'waitlist:announce-launch
        {--dry-run : List the recipients and exit without sending anything}
        {--only= : Send to only this single email address that IS on the waitlist}
        {--test= : Send one announcement to an arbitrary address (not from the waitlist) and exit}
        {--locale=az : Locale for --test sends (az|en|ru)}
        {--sleep=1 : Seconds to pause between sends}';

    protected $description = 'Email the "LinkFit is live on the App Store" announcement to launch-waitlist leads';

    public function handle(TransactionalMailService $mail): int
    {
        // One-off test send to any address (e.g. info@linkfit.az), independent of
        // the waitlist table — lets us preview the real rendered email first.
        $test = trim((string) $this->option('test'));
        if ($test !== '') {
            $locale = in_array($this->option('locale'), ['az', 'en', 'ru'], true) ? (string) $this->option('locale') : 'az';
            $mail->launchAnnouncement($test, 'Komanda', $locale);
            $this->info('Test announcement dispatched to '.$test.' (locale='.$locale.'). Check the inbox.');

            return self::SUCCESS;
        }

        $query = DB::table('launch_waitlist_entries')
            ->whereNotNull('email')
            ->orderBy('created_at');

        $only = trim((string) $this->option('only'));
        if ($only !== '') {
            $query->whereRaw('LOWER(email) = ?', [mb_strtolower($only)]);
        }

        $rows = $query->get(['email', 'name', 'locale']);
        $this->info('Recipients matched: '.$rows->count());

        if ($this->option('dry-run')) {
            foreach ($rows as $r) {
                $this->line('  '.$r->email.'  ['.($r->locale ?: 'az').']  '.$r->name);
            }
            $this->warn('Dry run — no emails sent.');

            return self::SUCCESS;
        }

        if ($rows->isEmpty()) {
            $this->error('No recipients matched — nothing sent.');

            return self::FAILURE;
        }

        $sleep = max(0, (int) $this->option('sleep'));
        $sent = 0;
        $bar = $this->output->createProgressBar($rows->count());
        $bar->start();

        foreach ($rows as $r) {
            $mail->launchAnnouncement(
                (string) $r->email,
                (string) $r->name,
                (string) ($r->locale ?: 'az'),
            );
            $sent++;
            $bar->advance();
            if ($sleep > 0) {
                sleep($sleep);
            }
        }

        $bar->finish();
        $this->newLine(2);
        $this->info('Done. Dispatched '.$sent.' announcement email(s). Per-address failures (if any) are in the Laravel log.');

        return self::SUCCESS;
    }
}
