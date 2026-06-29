<?php

namespace App\Services\Mail;

use App\Mail\LinkfitTransactionalMail;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

class TransactionalMailService
{
    public function emailVerification(string $email, string $name, string $code): void
    {
        $url = $this->verifyEmailUrl($email);
        $this->send($email, 'Verify your Linkfit email', $this->layout(
            'Verify your email',
            '<p>Hi '.$this->e($name).', enter this 6-digit code to confirm your email address. It expires in 10 minutes.</p>'
                .'<p style="font-size:28px;letter-spacing:0.18em;font-weight:700;margin:18px 0;color:#101418">'.$this->e($code).'</p>',
            'Enter code',
            $url,
        ));
    }

    public function passwordReset(string $email, string $name, string $code): void
    {
        $url = $this->resetUrl($email);
        $this->send($email, 'Reset your Linkfit password', $this->layout(
            'Reset your password',
            '<p>Hi '.$this->e($name).', enter this 6-digit code to choose a new password. It expires in 10 minutes.</p>'
                .'<p style="font-size:28px;letter-spacing:0.18em;font-weight:700;margin:18px 0;color:#101418">'.$this->e($code).'</p>',
            'Enter code',
            $url,
        ));
    }

    public function waitlistWelcome(string $email, string $name, string $locale = 'az'): void
    {
        $first = $this->e(trim(explode(' ', trim($name))[0]) ?: ($locale === 'ru' ? 'друг' : ($locale === 'en' ? 'there' : 'dostum')));

        $copy = [
            'az' => [
                'subject' => 'LinkFit gözləmə siyahısına xoş gəldin 🎾',
                'headline' => 'Siyahıdasan, '.$first.'!',
                'body' => '<p>Salam, '.$first.'! LinkFit <strong>gözləmə siyahısına</strong> qoşulduğun üçün təşəkkür edirik. 🎾</p>'
                    .'<p>Biz Bakıda <strong>padel və tennisin yeni evini</strong> qururuq — oyunçu tap, kort rezerv et, ELO reytinqini izlə, dostlarınla yazış və turnirlərdə (Americano) yarış. Hamısı bir yerdə.</p>'
                    .'<p>Platforma hazır olan kimi <strong>ilk xəbər alanlardan</strong> sən olacaqsan. Çox yaxındayıq — formada qal!</p>',
            ],
            'en' => [
                'subject' => 'Welcome to the LinkFit waitlist 🎾',
                'headline' => "You're on the list, ".$first.'!',
                'body' => '<p>Hi '.$first.'! Thanks for joining the LinkFit <strong>waitlist</strong>. 🎾</p>'
                    .'<p>We\'re building <strong>Baku\'s home for padel &amp; tennis</strong> — find players, book courts, track your ELO, chat with friends and compete in tournaments (Americano). All in one place.</p>'
                    .'<p>You\'ll be among the <strong>first to know</strong> the moment we\'re ready. Almost there — stay in shape!</p>',
            ],
            'ru' => [
                'subject' => 'Добро пожаловать в лист ожидания LinkFit 🎾',
                'headline' => 'Вы в списке, '.$first.'!',
                'body' => '<p>Привет, '.$first.'! Спасибо, что записались в <strong>лист ожидания</strong> LinkFit. 🎾</p>'
                    .'<p>Мы создаём <strong>дом падела и тенниса в Баку</strong> — находите игроков, бронируйте корты, следите за рейтингом ELO, общайтесь с друзьями и участвуйте в турнирах (Americano). Всё в одном месте.</p>'
                    .'<p>Вы узнаете <strong>одними из первых</strong>, как только мы будем готовы. Уже скоро — будьте в форме!</p>',
            ],
        ];

        $c = $copy[$locale] ?? $copy['az'];
        // No CTA button — pass only headline + body to the layout.
        $this->send($email, $c['subject'], $this->layout($c['headline'], $c['body']));
    }

    /**
     * One-off launch announcement to launch-waitlist leads: the app is now LIVE
     * on the App Store. Localized (az/en/ru), with an App Store CTA and an
     * explicit ask to send feedback to info@linkfit.az. Dispatched by the
     * `waitlist:announce-launch` console command (best-effort; see send()).
     */
    public function launchAnnouncement(string $email, string $name, string $locale = 'az'): void
    {
        $first = $this->e(trim(explode(' ', trim($name))[0]) ?: ($locale === 'ru' ? 'друг' : ($locale === 'en' ? 'there' : 'dostum')));
        $appStore = 'https://apps.apple.com/az/app/id6770729499';

        $copy = [
            'az' => [
                'subject' => 'LinkFit artıq App Store-da 🎾 — ilk sən yüklə!',
                'headline' => 'LinkFit App Store-da yayımdadır, '.$first.'! 🎾',
                'body' => '<p>Salam, '.$first.'! Gözləmə siyahısında olduğun üçün xəbəri <strong>ilk sənə</strong> veririk: <strong>LinkFit artıq App Store-da yayımdadır</strong> və indi iPhone-una yükləyə bilərsən. 🎾</p>'
                    .'<p>Oyunçu tap, kort rezerv et, nəticəni qeyd et və ELO reytinqi qazan — hamısı bir tətbiqdə.</p>'
                    .'<p>Tətbiqi yüklə, sına və <strong>fikrini bizimlə bölüş</strong>. Hər hansı problem, təklif və ya istəyin olsa, birbaşa <strong>info@linkfit.az</strong> ünvanına yaz — hər mesajı oxuyur və tətbiqi məhz sizin üçün daha yaxşı edirik.</p>'
                    .'<p>Bu, yalnız başlanğıcdır — qarşıda <strong>çoxlu yeniliklər, sürprizlər, turnirlər və mükafatlar</strong> var. İzləməkdə qal! 🎾</p>',
                'cta' => 'App Store-dan yüklə',
            ],
            'en' => [
                'subject' => 'LinkFit is live on the App Store 🎾 — be the first to download',
                'headline' => 'LinkFit is live on the App Store, '.$first.'! 🎾',
                'body' => '<p>Hi '.$first.'! Because you are on our waitlist, you are among the <strong>first to know</strong>: <strong>LinkFit is now live on the App Store</strong> and ready to download on your iPhone. 🎾</p>'
                    .'<p>Find players, book courts, log your results and earn an ELO rating — all in one app.</p>'
                    .'<p>Download it, try it, and <strong>tell us what you think</strong>. If you hit any problem or have a suggestion or request, email us directly at <strong>info@linkfit.az</strong> — we read every message and keep making the app better for you.</p>'
                    .'<p>This is only the beginning — <strong>lots of new features, surprises, tournaments and prizes</strong> are on the way. Stay tuned! 🎾</p>',
                'cta' => 'Download on the App Store',
            ],
            'ru' => [
                'subject' => 'LinkFit уже в App Store 🎾 — скачайте первыми',
                'headline' => 'LinkFit уже в App Store, '.$first.'! 🎾',
                'body' => '<p>Привет, '.$first.'! Вы в листе ожидания, поэтому узнаёте <strong>одними из первых</strong>: <strong>LinkFit теперь доступен в App Store</strong> — скачивайте на свой iPhone. 🎾</p>'
                    .'<p>Находите игроков, бронируйте корты, записывайте результаты и зарабатывайте рейтинг ELO — всё в одном приложении.</p>'
                    .'<p>Скачайте, попробуйте и <strong>поделитесь мнением</strong>. Если столкнётесь с проблемой или будет предложение — напишите нам напрямую на <strong>info@linkfit.az</strong>. Мы читаем каждое сообщение и делаем приложение лучше для вас.</p>'
                    .'<p>Это только начало — впереди <strong>много нового: сюрпризы, турниры и призы</strong>. Оставайтесь с нами! 🎾</p>',
                'cta' => 'Скачать в App Store',
            ],
        ];

        $c = $copy[$locale] ?? $copy['az'];
        $this->send($email, $c['subject'], $this->layout($c['headline'], $c['body'], $c['cta'], $appStore));
    }

    public function bookingConfirmed(string $bookingId): void
    {
        $booking = $this->booking($bookingId);
        if ($booking === null || empty($booking->user_email)) {
            return;
        }
        $this->send($booking->user_email, 'Your Linkfit booking is confirmed', $this->layout(
            'Booking confirmed',
            $this->bookingSummary($booking, 'Your court booking has been created.'),
            'View booking',
            $this->bookingUrl($bookingId),
        ));
    }

    public function bookingCancelled(string $bookingId, ?string $reason = null): void
    {
        $booking = $this->booking($bookingId);
        if ($booking === null || empty($booking->user_email)) {
            return;
        }
        $body = $this->bookingSummary($booking, 'Your booking was cancelled.');
        if ($reason !== null && trim($reason) !== '') {
            $body .= '<p><strong>Reason:</strong> '.$this->e($reason).'</p>';
        }
        $this->send($booking->user_email, 'Your Linkfit booking was cancelled', $this->layout(
            'Booking cancelled',
            $body,
            'View booking',
            $this->bookingUrl($bookingId),
        ));
    }

    public function bookingRefundUpdated(string $bookingId): void
    {
        $booking = $this->booking($bookingId);
        if ($booking === null || empty($booking->user_email)) {
            return;
        }
        $amount = $booking->refund_amount_minor !== null
            ? number_format(((int) $booking->refund_amount_minor) / 100, 2).' '.$booking->currency
            : 'Manual review';
        $this->send($booking->user_email, 'Your Linkfit refund was updated', $this->layout(
            'Refund updated',
            $this->bookingSummary($booking, 'Refund status: '.$this->e((string) ($booking->refund_status ?? 'updated')).'. Refund amount: '.$this->e($amount).'.'),
            'View booking',
            $this->bookingUrl($bookingId),
        ));
    }

    public function ownerNewBooking(string $bookingId, string $venueId): void
    {
        $booking = $this->booking($bookingId);
        if ($booking === null) {
            return;
        }
        $owners = DB::table('users')
            ->where('admin_role', 'partner')
            ->where('venue_id', $venueId)
            ->whereNull('deleted_at')
            ->whereNotNull('email')
            ->get(['email', 'display_name']);
        foreach ($owners as $owner) {
            $this->send($owner->email, 'New Linkfit booking', $this->layout(
                'New booking',
                $this->bookingSummary($booking, 'A new booking was created for your venue.'),
                'Open owner panel',
                $this->ownerBookingUrl($bookingId),
            ));
        }
    }

    public function criticalAlert(string $title, string $body, iterable $emails, bool $ownerPanel = false): void
    {
        foreach ($emails as $email) {
            $this->send((string) $email, $title, $this->layout(
                $title,
                '<p>'.$this->e($body).'</p>',
                $ownerPanel ? 'Open owner panel' : 'Open admin panel',
                $ownerPanel ? $this->ownerUrl() : $this->adminUrl(),
            ));
        }
    }

    private function send(string $email, string $subject, string $html): void
    {
        if (! filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return;
        }
        try {
            Mail::to($email)->send(new LinkfitTransactionalMail($subject, $html));
        } catch (\Throwable $e) {
            Log::warning('Transactional email failed', [
                'email' => $email,
                'subject' => $subject,
                'error' => $e->getMessage(),
            ]);
        }
    }

    private function booking(string $bookingId): ?object
    {
        return DB::table('bookings as b')
            ->leftJoin('users as u', 'u.id', '=', 'b.user_id')
            ->join('courts as c', 'c.id', '=', 'b.court_id')
            ->join('venues as v', 'v.id', '=', 'c.venue_id')
            ->where('b.id', $bookingId)
            ->first([
                'b.*',
                'u.email as user_email',
                'u.display_name as user_name',
                'c.name as court_name',
                'v.name as venue_name',
            ]);
    }

    private function bookingSummary(object $booking, string $intro): string
    {
        $startsAt = $booking->starts_at ? date('d M Y H:i', strtotime((string) $booking->starts_at)) : '';
        $amount = number_format(((int) $booking->total_minor) / 100, 2).' '.$booking->currency;

        return '<p>'.$this->e($intro).'</p>'
            .'<p><strong>Venue:</strong> '.$this->e((string) $booking->venue_name).'<br>'
            .'<strong>Court:</strong> '.$this->e((string) $booking->court_name).'<br>'
            .'<strong>Time:</strong> '.$this->e($startsAt).'<br>'
            .'<strong>Amount:</strong> '.$this->e($amount).'</p>';
    }

    private function layout(string $headline, string $bodyHtml, ?string $buttonLabel = null, ?string $url = null): string
    {
        // Button + fallback link are optional — e.g. the waitlist welcome email
        // has no CTA button. Render them only when a url is supplied.
        $button = ($buttonLabel !== null && $url !== null && $url !== '')
            ? '<p style="margin:24px 0"><a href="'.$this->e($url).'" style="background:#b8ff00;color:#101418;text-decoration:none;padding:12px 16px;border-radius:6px;font-weight:700">'.$this->e($buttonLabel).'</a></p>'
                .'<p style="font-size:12px;color:#667085">If the button does not work, open this link: '.$this->e($url).'</p>'
            : '';

        return '<div style="font-family:Arial,sans-serif;color:#101418;line-height:1.5;max-width:560px;margin:0 auto;padding:24px">'
            .'<div style="margin:0 0 20px"><img src="'.$this->e($this->logoUrl()).'" alt="Linkfit" width="150" style="display:block;width:150px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none"></div>'
            .'<h2 style="font-size:20px;margin:0 0 16px">'.$this->e($headline).'</h2>'
            .$bodyHtml
            .$button
            .'</div>';
    }

    private function webUrl(): string
    {
        return (string) config('services.linkfit.web_url', config('app.url'));
    }

    private function bookingUrl(string $bookingId): string
    {
        return rtrim($this->webUrl(), '/').'/bookings/my?booking_id='.rawurlencode($bookingId);
    }

    private function ownerBookingUrl(string $bookingId): string
    {
        return rtrim($this->ownerUrl(), '/').'/bookings?booking_id='.rawurlencode($bookingId);
    }

    private function logoUrl(): string
    {
        $configured = (string) config('services.linkfit.logo_url', '');

        return $configured !== ''
            ? $configured
            : rtrim($this->webUrl(), '/').'/brand/logolinkfit-dark.png';
    }

    private function verifyEmailUrl(string $email): string
    {
        $locale = trim((string) config('services.linkfit.web_locale', 'az'), '/');
        $prefix = $locale !== '' ? '/'.$locale : '';

        return rtrim($this->webUrl(), '/').$prefix.'/verify-email?step=code&email='.urlencode($email);
    }

    private function resetUrl(string $email): string
    {
        $locale = trim((string) config('services.linkfit.web_locale', 'az'), '/');
        $prefix = $locale !== '' ? '/'.$locale : '';

        return rtrim($this->webUrl(), '/').$prefix.'/reset-password?step=code&email='.urlencode($email);
    }

    private function adminUrl(): string
    {
        return (string) config('services.linkfit.admin_url', $this->webUrl());
    }

    private function ownerUrl(): string
    {
        return (string) config('services.linkfit.owner_url', $this->webUrl());
    }

    private function e(string $value): string
    {
        return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}
