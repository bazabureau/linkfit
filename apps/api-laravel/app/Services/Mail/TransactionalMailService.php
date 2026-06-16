<?php

namespace App\Services\Mail;

use App\Mail\LinkfitTransactionalMail;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

class TransactionalMailService
{
    public function emailVerification(string $email, string $name, string $token): void
    {
        $url = rtrim($this->webUrl(), '/').'/verify-email?token='.urlencode($token);
        $this->send($email, 'Verify your Linkfit email', $this->layout(
            'Verify your email',
            'Hi '.$this->e($name).', confirm your email address to finish setting up your Linkfit account.',
            'Verify email',
            $url,
        ));
    }

    public function passwordReset(string $email, string $name, string $token): void
    {
        $url = rtrim($this->webUrl(), '/').'/reset-password?token='.urlencode($token);
        $this->send($email, 'Reset your Linkfit password', $this->layout(
            'Reset your password',
            'Hi '.$this->e($name).', use this secure link to choose a new password. The link expires soon.',
            'Reset password',
            $url,
        ));
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
            rtrim($this->webUrl(), '/').'/bookings/'.$bookingId,
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
            rtrim($this->webUrl(), '/').'/bookings/'.$bookingId,
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
            rtrim($this->webUrl(), '/').'/bookings/'.$bookingId,
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
                rtrim($this->ownerUrl(), '/').'/bookings/'.$bookingId,
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

    private function layout(string $headline, string $bodyHtml, string $buttonLabel, string $url): string
    {
        return '<div style="font-family:Arial,sans-serif;color:#101418;line-height:1.5;max-width:560px;margin:0 auto;padding:24px">'
            .'<h1 style="font-size:24px;margin:0 0 16px">Linkfit</h1>'
            .'<h2 style="font-size:20px;margin:0 0 16px">'.$this->e($headline).'</h2>'
            .$bodyHtml
            .'<p style="margin:24px 0"><a href="'.$this->e($url).'" style="background:#b8ff00;color:#101418;text-decoration:none;padding:12px 16px;border-radius:6px;font-weight:700">'.$this->e($buttonLabel).'</a></p>'
            .'<p style="font-size:12px;color:#667085">If the button does not work, open this link: '.$this->e($url).'</p>'
            .'</div>';
    }

    private function webUrl(): string
    {
        return (string) config('services.linkfit.web_url', config('app.url'));
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
